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
  tile: number;
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

  const deltas = parsePatchPayload(payload);
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
    if (current === delta.tile) {
      continue;
    }

    if (nextTiles === null) {
      nextTiles = state.tiles.slice();
    }

    nextTiles[delta.index] = delta.tile;
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
  const tiles = toUint16Array(map.tiles, tileCount);
  if (tiles === null) {
    return null;
  }

  return { width, height, tiles };
}

function parsePatchPayload(payload: unknown): PatchTileDelta[] | null {
  const map = readMapObject(payload);
  if (map === null || !Array.isArray(map.tiles)) {
    return null;
  }

  const deltas: PatchTileDelta[] = [];
  for (const entry of map.tiles) {
    if (!isRecord(entry)) {
      continue;
    }

    const index = readNonNegativeInteger(entry.index);
    const tile = readTileValue(entry.tile);
    if (index === null || tile === null) {
      continue;
    }

    deltas.push({ index, tile });
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
