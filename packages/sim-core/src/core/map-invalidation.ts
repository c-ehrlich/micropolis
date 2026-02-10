import { World } from './constants.ts';
import {
  getMapStateDrawModeEntry,
  MAP_FLAG_COUNT,
  MAP_FLAGS,
  type MapFlagId,
} from './map-flags.ts';
import type { Patch } from './map-store.ts';

const DEFAULT_MAX_DIRTY_TILES_BEFORE_FULL_REDRAW = 2048;
const DEFAULT_MAX_DIRTY_RECTS_BEFORE_FULL_REDRAW = 512;

/**
 * Tile-space dirty rectangle for incremental map redraw.
 * Mirrors Micropolis map invalidation intent where `DoUpdateMap` refreshes map
 * content in `ref/micropolis/src/sim/w_map.c` and overlay modes are selected in
 * `setUpMapProcs` from `ref/micropolis/src/sim/g_map.c`.
 * Parity note: rectangle batching is a TypeScript optimization layer for browser
 * renderers; C view code historically redraws full images in several paths.
 */
export interface DirtyTileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Deterministic redraw-plan outcome for one UI update cycle.
 * Mirrors the `NewMap`/`NewMapFlags` invalidation contract used by Micropolis
 * map windows in `ref/micropolis/src/sim/w_map.c` and map mode dispatch in
 * `ref/micropolis/src/sim/g_map.c`.
 * Parity note: reason labels are TypeScript diagnostics for testing/telemetry.
 */
export interface MapRedrawPlan {
  readonly reason:
    | 'none'
    | 'new-map'
    | 'map-flag'
    | 'shake'
    | 'patch-tile-threshold'
    | 'patch-rect-threshold'
    | 'patch-rects';
  readonly fullRedraw: boolean;
  readonly dirtyRects: ReadonlyArray<DirtyTileRect>;
  readonly consumedFlags: ReadonlyArray<MapFlagId>;
}

/**
 * Inputs for map redraw policy planning.
 * Mirrors Micropolis invalidation inputs (`NewMap`, `NewMapFlags`, current
 * map mode) from `ref/micropolis/src/sim/w_map.c`.
 * Parity note: optional patch thresholds are browser-oriented tuning knobs.
 */
export interface PlanMapRedrawOptions {
  /**
   * Active C map mode as one explicit NewMapFlags slot id.
   * Mirrors callers that already track symbolic `ALMAP`..`DYMAP`.
   */
  readonly activeMapFlag?: MapFlagId;
  /**
   * Active C `map_state` index (optional numeric form of `activeMapFlag`).
   * Mirrors `view->map_state` in `ref/micropolis/src/sim/g_map.c`.
   */
  readonly activeMapState?: number;
  readonly newMap: number;
  readonly newMapFlags: Uint8Array;
  readonly shakeNow?: number;
  readonly mapPatch?: Patch | null;
  readonly maxDirtyTilesBeforeFullRedraw?: number;
  readonly maxDirtyRectsBeforeFullRedraw?: number;
}

/**
 * Mutable subset of sim state used for invalidation acknowledgment.
 * Mirrors the C requirement that consumed invalidation markers are cleared after
 * processing (`NewMap` / `NewMapFlags` paths in `ref/micropolis/src/sim/s_scan.c`
 * and `ref/micropolis/src/sim/w_map.c`).
 */
export interface MapInvalidationState {
  NewMap: number;
  NewMapFlags: Uint8Array;
}

/**
 * Minimal mutable state required by `s_scan.c`-mapped `NewMapFlags` producers.
 * Mirrors the `NewMapFlags[NMAPS]` storage contract in
 * `ref/micropolis/src/sim/s_scan.c`.
 */
export interface MapInvalidationFlagState {
  NewMapFlags: Uint8Array;
}

const markMapFlags = (state: MapInvalidationFlagState, flags: ReadonlyArray<MapFlagId>): void => {
  for (const flag of flags) {
    state.NewMapFlags[MAP_FLAGS[flag]] = 1;
  }
};

/**
 * Mark dynamic and fire coverage map modes dirty after fire-station analysis.
 * Mirrors `FireAnalysis` in `ref/micropolis/src/sim/s_scan.c`.
 * Parity note: this is a 1:1 port of `NewMapFlags[DYMAP] = NewMapFlags[FIMAP] = 1`.
 */
export function markFireAnalysisMapFlags(state: MapInvalidationFlagState): void {
  markMapFlags(state, ['DYMAP', 'FIMAP']);
}

/**
 * Mark dynamic, population density, and growth-rate map modes dirty after
 * population density scan.
 * Mirrors `PopDenScan` in `ref/micropolis/src/sim/s_scan.c`.
 * Parity note: this is a 1:1 port of
 * `NewMapFlags[DYMAP] = NewMapFlags[PDMAP] = NewMapFlags[RGMAP] = 1`.
 */
export function markPopDenScanMapFlags(state: MapInvalidationFlagState): void {
  markMapFlags(state, ['DYMAP', 'PDMAP', 'RGMAP']);
}

/**
 * Mark dynamic, pollution, and land-value map modes dirty after PTL scan.
 * Mirrors `PTLScan` in `ref/micropolis/src/sim/s_scan.c`.
 * Parity note: this is a 1:1 port of
 * `NewMapFlags[DYMAP] = NewMapFlags[PLMAP] = NewMapFlags[LVMAP] = 1`.
 */
export function markPTLScanMapFlags(state: MapInvalidationFlagState): void {
  markMapFlags(state, ['DYMAP', 'PLMAP', 'LVMAP']);
}

/**
 * Mark dynamic, crime, and police map modes dirty after crime scan.
 * Mirrors `CrimeScan` in `ref/micropolis/src/sim/s_scan.c`.
 * Parity note: this is a 1:1 port of
 * `NewMapFlags[DYMAP] = NewMapFlags[CRMAP] = NewMapFlags[POMAP] = 1`.
 */
export function markCrimeScanMapFlags(state: MapInvalidationFlagState): void {
  markMapFlags(state, ['DYMAP', 'CRMAP', 'POMAP']);
}

/**
 * Resolve the active map-flag slot for one map-state index.
 * Mirrors `mapProcs[view->map_state]` lookup in `MemDrawMap` from
 * `ref/micropolis/src/sim/g_map.c` and map-state bounds validation in
 * `MapCmdMapState` from `ref/micropolis/src/sim/w_map.c`.
 */
export function resolveMapFlagForMapState(mapState: number): MapFlagId | null {
  const entry = getMapStateDrawModeEntry(mapState);
  return entry?.mapFlag ?? null;
}

/**
 * Build one redraw plan from C-compatible invalidation signals plus an optional
 * map patch.
 * Mirrors map invalidation gating in `DoUpdateMap` (`ref/micropolis/src/sim/w_map.c`).
 * Parity note: patch-based dirty-rectangle fallback is a TypeScript optimization
 * for browser rendering while preserving C invalidation priority order.
 */
export function planMapRedraw(options: PlanMapRedrawOptions): MapRedrawPlan {
  const activeMapFlag = resolveActiveMapFlag(options);
  const activeFlagIndex = MAP_FLAGS[activeMapFlag];
  const maxDirtyTiles =
    options.maxDirtyTilesBeforeFullRedraw ?? DEFAULT_MAX_DIRTY_TILES_BEFORE_FULL_REDRAW;
  const maxDirtyRects =
    options.maxDirtyRectsBeforeFullRedraw ?? DEFAULT_MAX_DIRTY_RECTS_BEFORE_FULL_REDRAW;

  if (options.newMap !== 0) {
    return {
      reason: 'new-map',
      fullRedraw: true,
      dirtyRects: [],
      consumedFlags: [activeMapFlag],
    };
  }

  if ((options.newMapFlags[activeFlagIndex] ?? 0) !== 0) {
    return {
      reason: 'map-flag',
      fullRedraw: true,
      dirtyRects: [],
      consumedFlags: [activeMapFlag],
    };
  }

  if ((options.shakeNow ?? 0) !== 0) {
    return {
      reason: 'shake',
      fullRedraw: true,
      dirtyRects: [],
      consumedFlags: [],
    };
  }

  const patch = options.mapPatch;
  if (!patch || patch.layer !== 'map' || patch.index.length === 0) {
    return {
      reason: 'none',
      fullRedraw: false,
      dirtyRects: [],
      consumedFlags: [],
    };
  }

  if (patch.index.length > maxDirtyTiles) {
    return {
      reason: 'patch-tile-threshold',
      fullRedraw: true,
      dirtyRects: [],
      consumedFlags: [],
    };
  }

  const dirtyRects = buildDirtyRectsFromMapPatch(patch.index);
  if (dirtyRects.length > maxDirtyRects) {
    return {
      reason: 'patch-rect-threshold',
      fullRedraw: true,
      dirtyRects: [],
      consumedFlags: [],
    };
  }

  return {
    reason: 'patch-rects',
    fullRedraw: false,
    dirtyRects,
    consumedFlags: [],
  };
}

/**
 * Resolve one redraw planning map flag from either symbolic or numeric map mode.
 * Mirrors the C pairing of `MapCmdMapState` input bounds in `w_map.c` with
 * `mapProcs[view->map_state]` lookup in `g_map.c`.
 */
function resolveActiveMapFlag(options: PlanMapRedrawOptions): MapFlagId {
  const activeMapState = options.activeMapState;
  if (typeof activeMapState === 'number') {
    const fromMapState = resolveMapFlagForMapState(activeMapState);
    if (fromMapState !== null) {
      return fromMapState;
    }
  }

  return options.activeMapFlag ?? 'ALMAP';
}

/**
 * Clear invalidation markers at the end of one map-update cycle.
 * Mirrors `sim_update_maps` in `ref/micropolis/src/sim/sim.c`, which always
 * resets `NewMap` and clears all `NewMapFlags[0..NMAPS-1]` after map views are
 * processed.
 * Parity note: `plan` is retained for diagnostics call-sites, but the clear
 * behavior is cycle-wide and does not depend on consumed per-view flags.
 */
export function consumeMapRedrawPlan(
  state: MapInvalidationState,
  _plan?: Pick<MapRedrawPlan, 'consumedFlags'>,
): void {
  consumeMapInvalidationCycle(state);
}

/**
 * Clear map invalidation markers after one complete map-view update cycle.
 * Mirrors `sim_update_maps` in `ref/micropolis/src/sim/sim.c`, where `NewMap`
 * and all `NewMapFlags[0..NMAPS-1]` entries are reset once after iterating all
 * map views.
 */
export function consumeMapInvalidationCycle(state: MapInvalidationState): void {
  state.NewMap = 0;
  for (let index = 0; index < MAP_FLAG_COUNT; index += 1) {
    state.NewMapFlags[index] = 0;
  }
}

function buildDirtyRectsFromMapPatch(indexes: Uint32Array): DirtyTileRect[] {
  const sortedUniqueIndexes = [...indexes]
    .sort((left, right) => left - right)
    .filter((index, idx, values) => idx === 0 || index !== values[idx - 1]);

  const runs: DirtyTileRect[] = [];
  let runStart: number | null = null;
  let previous: number | null = null;

  for (const index of sortedUniqueIndexes) {
    if (runStart == null || previous == null) {
      runStart = index;
      previous = index;
      continue;
    }

    const previousX = Math.floor(previous / World.WORLD_Y);
    const currentX = Math.floor(index / World.WORLD_Y);
    if (index === previous + 1 && previousX === currentX) {
      previous = index;
      continue;
    }

    runs.push(verticalRunRect(runStart, previous));
    runStart = index;
    previous = index;
  }

  if (runStart != null && previous != null) {
    runs.push(verticalRunRect(runStart, previous));
  }

  return mergeAdjacentColumns(runs);
}

function verticalRunRect(startIndex: number, endIndex: number): DirtyTileRect {
  const x = Math.floor(startIndex / World.WORLD_Y);
  const y = startIndex % World.WORLD_Y;
  const endY = endIndex % World.WORLD_Y;

  return {
    x,
    y,
    width: 1,
    height: endY - y + 1,
  };
}

function mergeAdjacentColumns(rects: ReadonlyArray<DirtyTileRect>): DirtyTileRect[] {
  if (rects.length <= 1) {
    return [...rects];
  }

  const sorted = [...rects].sort((left, right) => {
    if (left.y !== right.y) {
      return left.y - right.y;
    }
    if (left.height !== right.height) {
      return left.height - right.height;
    }
    return left.x - right.x;
  });

  const merged: DirtyTileRect[] = [];
  for (const rect of sorted) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.y === rect.y &&
      previous.height === rect.height &&
      previous.x + previous.width === rect.x
    ) {
      merged[merged.length - 1] = {
        ...previous,
        width: previous.width + rect.width,
      };
      continue;
    }

    merged.push(rect);
  }

  return merged;
}
