import { getCoreBridgeV1SnapshotTileIndex } from '../../../../../packages/core-bridge/src/types.ts';
import type { HostMapRedrawPlanPayload, SequencedHostEnvelope } from './protocol.ts';

const EMPTY_DIRTY_TILE_INDEXES = new Uint32Array(0);
const EMPTY_DIRTY_RECTS: readonly RuntimeMapDirtyRect[] = Object.freeze([]);

/**
 * Last map draw mode emitted by one authoritative envelope.
 * Mirrors `MemDrawMap` draw-proc dispatch intent in
 * `ref/micropolis/src/sim/g_map.c`.
 * Parity note: this Stage 4 transport-level mode (`none`/`snapshot`/`patch`)
 * intentionally differs from C thematic map states (`ALMAP`..`DYMAP`) and is
 * used only to route full vs dirty redraw behavior in the web canvas.
 */
export type RuntimeMapDrawMode = 'none' | 'snapshot' | 'patch';

/**
 * Dirty tile rectangle for one runtime patch redraw.
 * Mirrors the invalid-region ownership used by map views in
 * `DoUpdateMap` from `ref/micropolis/src/sim/w_map.c`.
 * Parity note: Micropolis C redraws map views by invalidation state, while
 * this runtime exposes explicit tile-space rects for browser patch repainting.
 */
export interface RuntimeMapDirtyRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Runtime map projection consumed by the Stage 2 canvas renderer.
 * Mirrors `MemDrawMap` map-buffer ownership in `ref/micropolis/src/sim/g_map.c`.
 * Difference: this stores one explicit typed tile buffer instead of the C
 * global map memory macros.
 * Parity note: `drawMode`/`dirtyTileIndexes`/`dirtyRects` are map-view owned
 * redraw markers, matching `view->invalid` lifecycle ownership in `DoUpdateMap` from
 * `ref/micropolis/src/sim/w_map.c`.
 */
export interface RuntimeMapState {
  hasSnapshot: boolean;
  width: number;
  height: number;
  tiles: Uint16Array;
  dirtyTileIndexes: Uint32Array;
  dirtyRects: readonly RuntimeMapDirtyRect[];
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
    dirtyRects: EMPTY_DIRTY_RECTS,
    drawMode: 'none',
    renderEpoch: 0,
  };
}

/**
 * Projects snapshot/patch host envelopes into the runtime map projection.
 * Mirrors ordered map baseline + incremental application behavior across
 * `ref/micropolis/src/sim/w_map.c` and `ref/micropolis/src/sim/g_map.c`.
 * Difference: this consumes bridge payloads instead of direct C globals, and
 * non-map envelopes intentionally do not clear map redraw markers.
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

  return state;
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

interface ParsedMapRedrawPlan {
  fullRedraw: boolean;
  dirtyRects: readonly RuntimeMapDirtyRect[];
}

interface ParsedPatchPayload {
  deltas: PatchTileDelta[];
  redrawPlan: ParsedMapRedrawPlan | null;
}

function applySnapshotPayload(state: RuntimeMapState, payload: unknown): RuntimeMapState {
  const parsed = parseSnapshotPayload(payload);
  if (parsed === null) {
    return state;
  }

  return {
    hasSnapshot: true,
    width: parsed.width,
    height: parsed.height,
    tiles: parsed.tiles,
    dirtyTileIndexes: EMPTY_DIRTY_TILE_INDEXES,
    dirtyRects: EMPTY_DIRTY_RECTS,
    drawMode: 'snapshot',
    renderEpoch: state.renderEpoch + 1,
  };
}

function applyPatchPayload(state: RuntimeMapState, payload: unknown): RuntimeMapState {
  if (!state.hasSnapshot) {
    return state;
  }

  const parsed = parsePatchPayload(payload, state.width, state.height);
  if (parsed === null) {
    return state;
  }

  const deltas = parsed.deltas;
  const redrawPlan = parsed.redrawPlan;
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

  const hasTileChanges = nextTiles !== null && dirty.length > 0;
  const hasPlanDrivenRedraw =
    redrawPlan?.fullRedraw === true || (redrawPlan?.dirtyRects.length ?? 0) > 0;
  if (!hasTileChanges && !hasPlanDrivenRedraw) {
    return state;
  }

  const dirtyTileIndexes = hasTileChanges
    ? normalizeDirtyTileIndexes(dirty, state.tiles.length)
    : EMPTY_DIRTY_TILE_INDEXES;
  const dirtyRects =
    redrawPlan?.fullRedraw === true
      ? EMPTY_DIRTY_RECTS
      : redrawPlan?.dirtyRects.length
        ? redrawPlan.dirtyRects
        : buildDirtyRectsFromDirtyTileIndexes(dirtyTileIndexes, state.width);

  return {
    ...state,
    tiles: hasTileChanges && nextTiles !== null ? nextTiles : state.tiles,
    dirtyTileIndexes,
    dirtyRects,
    drawMode: redrawPlan?.fullRedraw === true ? 'snapshot' : 'patch',
    renderEpoch: state.renderEpoch + 1,
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
): ParsedPatchPayload | null {
  const map = readMapObject(payload);
  if (map === null) {
    return null;
  }

  const redrawPlan = parseMapRedrawPlan(map.redrawPlan);
  if (Array.isArray(map.tileWordDeltas)) {
    return {
      deltas: parseTileWordCoordinateDeltas(map.tileWordDeltas, width, height),
      redrawPlan,
    };
  }

  if (Array.isArray(map.tiles)) {
    return {
      deltas: parseLegacyIndexDeltas(map.tiles),
      redrawPlan,
    };
  }

  if (redrawPlan === null) {
    return null;
  }

  return {
    deltas: [],
    redrawPlan,
  };
}

/**
 * Parses authority redraw-plan metadata emitted from sim-core invalidation
 * planning.
 * Mirrors redraw policy produced by `planMapRedraw` in
 * `packages/sim-core/src/core/map-invalidation.ts`.
 */
function parseMapRedrawPlan(value: unknown): ParsedMapRedrawPlan | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.fullRedraw !== 'boolean') {
    return null;
  }

  const reason = value.reason;
  if (
    reason !== 'none' &&
    reason !== 'new-map' &&
    reason !== 'map-flag' &&
    reason !== 'shake' &&
    reason !== 'patch-tile-threshold' &&
    reason !== 'patch-rect-threshold' &&
    reason !== 'patch-rects'
  ) {
    return null;
  }

  const dirtyRects = normalizeMapRedrawDirtyRects(value.dirtyRects);
  if (dirtyRects === null) {
    return null;
  }

  return {
    fullRedraw: value.fullRedraw,
    dirtyRects,
  };
}

function normalizeMapRedrawDirtyRects(
  value: unknown,
): HostMapRedrawPlanPayload['dirtyRects'] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const dirtyRects: RuntimeMapDirtyRect[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      return null;
    }

    const x = readNonNegativeInteger(entry.x);
    const y = readNonNegativeInteger(entry.y);
    const width = readPositiveInteger(entry.width);
    const height = readPositiveInteger(entry.height);
    if (x === null || y === null || width === null || height === null) {
      return null;
    }

    dirtyRects.push({ x, y, width, height });
  }

  return dirtyRects;
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

function normalizeDirtyTileIndexes(indexes: readonly number[], tileCount: number): Uint32Array {
  if (indexes.length === 0) {
    return EMPTY_DIRTY_TILE_INDEXES;
  }

  const unique = [...new Set(indexes)]
    .filter((index) => index >= 0 && index < tileCount)
    .sort((left, right) => left - right);
  if (unique.length === 0) {
    return EMPTY_DIRTY_TILE_INDEXES;
  }

  return Uint32Array.from(unique);
}

function buildDirtyRectsFromDirtyTileIndexes(
  indexes: Uint32Array,
  width: number,
): readonly RuntimeMapDirtyRect[] {
  if (indexes.length === 0 || width <= 0) {
    return EMPTY_DIRTY_RECTS;
  }

  const firstIndex = indexes[0];
  if (firstIndex === undefined) {
    return EMPTY_DIRTY_RECTS;
  }

  const rowRuns: RuntimeMapDirtyRect[] = [];
  let runStartIndex = firstIndex;
  let previousIndex = firstIndex;

  for (let cursor = 1; cursor < indexes.length; cursor += 1) {
    const currentIndex = indexes[cursor];
    if (currentIndex === undefined) {
      continue;
    }

    const previousY = Math.trunc(previousIndex / width);
    const currentY = Math.trunc(currentIndex / width);
    if (currentY === previousY && currentIndex === previousIndex + 1) {
      previousIndex = currentIndex;
      continue;
    }

    rowRuns.push(buildRowRunRect(runStartIndex, previousIndex, width));
    runStartIndex = currentIndex;
    previousIndex = currentIndex;
  }

  rowRuns.push(buildRowRunRect(runStartIndex, previousIndex, width));
  return mergeAdjacentRowRuns(rowRuns);
}

function buildRowRunRect(startIndex: number, endIndex: number, width: number): RuntimeMapDirtyRect {
  const y = Math.trunc(startIndex / width);
  const startX = startIndex - y * width;
  const endX = endIndex - y * width;
  return {
    x: startX,
    y,
    width: endX - startX + 1,
    height: 1,
  };
}

function mergeAdjacentRowRuns(
  runs: readonly RuntimeMapDirtyRect[],
): readonly RuntimeMapDirtyRect[] {
  if (runs.length <= 1) {
    return runs;
  }

  const sortedRuns = [...runs].sort((left, right) => {
    if (left.x !== right.x) {
      return left.x - right.x;
    }
    if (left.width !== right.width) {
      return left.width - right.width;
    }
    return left.y - right.y;
  });

  const merged: RuntimeMapDirtyRect[] = [];
  for (const run of sortedRuns) {
    const previous = merged.at(-1);
    if (
      previous !== undefined &&
      previous.x === run.x &&
      previous.width === run.width &&
      previous.y + previous.height === run.y
    ) {
      merged[merged.length - 1] = {
        ...previous,
        height: previous.height + run.height,
      };
      continue;
    }

    merged.push(run);
  }

  return merged;
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

function readPositiveInteger(value: unknown): number | null {
  const next = readNonNegativeInteger(value);
  if (next === null || next <= 0) {
    return null;
  }

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
