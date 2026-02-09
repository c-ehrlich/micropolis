import { getCoreBridgeV1SnapshotTileIndex } from '../../../../../packages/core-bridge/src/types.ts';
import type { SequencedHostEnvelope } from './protocol.ts';

const EMPTY_DIRTY_TILE_INDEXES = new Uint32Array(0);

/**
 * Last map draw mode emitted by one authoritative envelope.
 * Mirrors `DoUpdateMap` full redraw vs changed-region intent from
 * `ref/micropolis/src/sim/w_map.c`; difference: Stage 2 exposes this
 * explicitly for the React canvas renderer.
 */
export type RuntimeMapDrawMode = 'none' | 'snapshot' | 'patch';

/**
 * Runtime map projection consumed by the Stage 2 canvas renderer.
 * Mirrors `MemDrawMap` map-buffer ownership in `ref/micropolis/src/sim/g_map.c`.
 * Difference: this stores one explicit typed tile buffer instead of the C
 * global map memory macros.
 */
export interface RuntimeMapState {
  hasSnapshot: boolean;
  width: number;
  height: number;
  tiles: Uint16Array;
  dirtyTileIndexes: Uint32Array;
  drawMode: RuntimeMapDrawMode;
  renderEpoch: number;
}

/**
 * Creates the initial map projection state before any authoritative snapshot.
 * Mirrors pre-initialization map-view state in `ref/micropolis/src/sim/w_map.c`.
 */
export function createInitialRuntimeMapState(): RuntimeMapState {
  return {
    hasSnapshot: false,
    width: 0,
    height: 0,
    tiles: new Uint16Array(0),
    dirtyTileIndexes: EMPTY_DIRTY_TILE_INDEXES,
    drawMode: 'none',
    renderEpoch: 0,
  };
}

/**
 * Projects snapshot/patch host envelopes into the runtime map projection.
 * Mirrors ordered map baseline + incremental application behavior across
 * `ref/micropolis/src/sim/w_map.c` and `ref/micropolis/src/sim/g_map.c`.
 * Difference: this consumes bridge payloads instead of direct C globals.
 */
export function projectRuntimeMapState(
  state: RuntimeMapState,
  envelope: SequencedHostEnvelope,
): RuntimeMapState {
  if (envelope.kind === 'snapshot') {
    return applySnapshotPayload(state, envelope.payload);
  }

  if (envelope.kind === 'patch') {
    return applyPatchPayload(state, envelope.payload);
  }

  return resetMapDrawMarkers(state);
}

interface SnapshotPayload {
  width: number;
  height: number;
  tiles: Uint16Array;
}

interface PatchTileDelta {
  index: number;
  tileWord: number;
}

function applySnapshotPayload(state: RuntimeMapState, payload: unknown): RuntimeMapState {
  const parsed = parseSnapshotPayload(payload);
  if (parsed === null) {
    return resetMapDrawMarkers(state);
  }

  return {
    hasSnapshot: true,
    width: parsed.width,
    height: parsed.height,
    tiles: parsed.tiles,
    dirtyTileIndexes: EMPTY_DIRTY_TILE_INDEXES,
    drawMode: 'snapshot',
    renderEpoch: state.renderEpoch + 1,
  };
}

function applyPatchPayload(state: RuntimeMapState, payload: unknown): RuntimeMapState {
  if (!state.hasSnapshot) {
    return resetMapDrawMarkers(state);
  }

  const deltas = parsePatchPayload(payload, state.width, state.height);
  if (deltas === null || deltas.length === 0) {
    return resetMapDrawMarkers(state);
  }

  let nextTiles: Uint16Array | null = null;
  const dirty: number[] = [];
  for (const delta of deltas) {
    if (delta.index < 0 || delta.index >= state.tiles.length) {
      continue;
    }

    const current = state.tiles[delta.index];
    if (current === delta.tileWord) {
      continue;
    }

    if (nextTiles === null) {
      nextTiles = state.tiles.slice();
    }

    nextTiles[delta.index] = delta.tileWord;
    dirty.push(delta.index);
  }

  if (nextTiles === null || dirty.length === 0) {
    return resetMapDrawMarkers(state);
  }

  return {
    ...state,
    tiles: nextTiles,
    dirtyTileIndexes: Uint32Array.from(dirty),
    drawMode: 'patch',
    renderEpoch: state.renderEpoch + 1,
  };
}

function resetMapDrawMarkers(state: RuntimeMapState): RuntimeMapState {
  if (state.drawMode === 'none' && state.dirtyTileIndexes.length === 0) {
    return state;
  }

  return {
    ...state,
    dirtyTileIndexes: EMPTY_DIRTY_TILE_INDEXES,
    drawMode: 'none',
  };
}

function parseSnapshotPayload(payload: unknown): SnapshotPayload | null {
  const map = readMapObject(payload);
  if (map === null) {
    return null;
  }

  const width = readNonNegativeInteger(map.width);
  const height = readNonNegativeInteger(map.height);
  if (width === null || height === null) {
    return null;
  }

  const tileCount = width * height;
  if ('tileWords' in map) {
    const tileWords = toUint16Array(map.tileWords, tileCount);
    if (tileWords === null) {
      return null;
    }
    return {
      width,
      height,
      tiles: convertSnapshotTileWordsToRuntimeTiles(tileWords, width, height),
    };
  }

  const legacyTiles = toUint16Array(map.tiles, tileCount);
  if (legacyTiles === null) {
    return null;
  }

  return { width, height, tiles: legacyTiles };
}

function parsePatchPayload(
  payload: unknown,
  width: number,
  height: number,
): PatchTileDelta[] | null {
  const map = readMapObject(payload);
  if (map === null) {
    return null;
  }

  if (Array.isArray(map.tileWordDeltas)) {
    return parseTileWordCoordinateDeltas(map.tileWordDeltas, width, height);
  }

  if (Array.isArray(map.tiles)) {
    return parseLegacyIndexDeltas(map.tiles);
  }

  return null;
}

/**
 * Parses authoritative coordinate-addressed patch deltas into runtime indexes.
 * Mirrors `Map[x][y]` writes in `ref/micropolis/src/sim/w_tool.c` and
 * `ref/micropolis/src/sim/w_con.c`.
 * Difference: converts to row-major indexes for the canvas projection buffer.
 */
function parseTileWordCoordinateDeltas(
  entries: readonly unknown[],
  width: number,
  height: number,
): PatchTileDelta[] {
  const deltas: PatchTileDelta[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const x = readNonNegativeInteger(entry.x);
    const y = readNonNegativeInteger(entry.y);
    const tileWord = readTileValue(entry.tileWord);
    if (x === null || y === null || tileWord === null) {
      continue;
    }
    if (x >= width || y >= height) {
      continue;
    }

    deltas.push({
      index: toRuntimeTileIndex(x, y, width),
      tileWord,
    });
  }
  return deltas;
}

/**
 * Parses legacy Stage 2 index-addressed deltas retained during protocol migration.
 * Mirrors old bridge payload fixtures predating coordinate-addressed map deltas.
 */
function parseLegacyIndexDeltas(entries: readonly unknown[]): PatchTileDelta[] {
  const deltas: PatchTileDelta[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const index = readNonNegativeInteger(entry.index);
    const tileWord = readTileValue(entry.tile);
    if (index === null || tileWord === null) {
      continue;
    }

    deltas.push({ index, tileWord });
  }

  return deltas;
}

function readMapObject(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) {
    return null;
  }

  const mapValue = payload.map;
  if (!isRecord(mapValue)) {
    return null;
  }

  return mapValue;
}

/**
 * Converts authoritative snapshot x-major tile words into runtime row-major order.
 * Mirrors classic Micropolis map layout (`Map[x][y]`) in
 * `ref/micropolis/src/sim/s_alloc.c`.
 * Difference: runtime keeps row-major layout to simplify canvas redraw indexing.
 */
function convertSnapshotTileWordsToRuntimeTiles(
  tileWords: Uint16Array,
  width: number,
  height: number,
): Uint16Array {
  const tiles = new Uint16Array(width * height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const sourceIndex = getCoreBridgeV1SnapshotTileIndex(x, y, height);
      const runtimeIndex = toRuntimeTileIndex(x, y, width);
      tiles[runtimeIndex] = tileWords[sourceIndex] ?? 0;
    }
  }
  return tiles;
}

/**
 * Computes the runtime row-major tile index used by the canvas projection buffer.
 * Mirrors Stage 2 renderer indexing in `apps/web/src/game/map/map-canvas.tsx`.
 */
function toRuntimeTileIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

function toUint16Array(value: unknown, expectedLength: number): Uint16Array | null {
  if (value instanceof Uint16Array) {
    if (value.length !== expectedLength) {
      return null;
    }
    return value.slice();
  }

  if (!Array.isArray(value) || value.length !== expectedLength) {
    return null;
  }

  const result = new Uint16Array(expectedLength);
  for (let index = 0; index < expectedLength; index += 1) {
    const raw = readTileValue(value[index]);
    if (raw === null) {
      return null;
    }
    result[index] = raw;
  }

  return result;
}

function readTileValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  // The C map buffers are 16-bit words (`short`/`unsigned short` paths in
  // map rendering), so Stage 2 normalizes payload values to 16 bits.
  return Math.trunc(value) & 0xffff;
}

function readNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const next = Math.trunc(value);
  if (next < 0) {
    return null;
  }

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
