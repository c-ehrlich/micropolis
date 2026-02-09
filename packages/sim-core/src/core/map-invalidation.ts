import { World } from './constants.ts';
import { MAP_FLAG_COUNT, MAP_FLAGS, type MapFlagId } from './map-flags.ts';
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
  readonly activeMapFlag: MapFlagId;
  readonly newMap: number;
  readonly newMapFlags: Uint8Array;
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
 * Build one redraw plan from C-compatible invalidation signals plus an optional
 * map patch.
 * Mirrors map invalidation gating in `DoUpdateMap` (`ref/micropolis/src/sim/w_map.c`).
 * Parity note: patch-based dirty-rectangle fallback is a TypeScript optimization
 * for browser rendering while preserving C invalidation priority order.
 */
export function planMapRedraw(options: PlanMapRedrawOptions): MapRedrawPlan {
  const activeFlagIndex = MAP_FLAGS[options.activeMapFlag];
  const maxDirtyTiles =
    options.maxDirtyTilesBeforeFullRedraw ?? DEFAULT_MAX_DIRTY_TILES_BEFORE_FULL_REDRAW;
  const maxDirtyRects =
    options.maxDirtyRectsBeforeFullRedraw ?? DEFAULT_MAX_DIRTY_RECTS_BEFORE_FULL_REDRAW;

  if (options.newMap !== 0) {
    return {
      reason: 'new-map',
      fullRedraw: true,
      dirtyRects: [],
      consumedFlags: [options.activeMapFlag],
    };
  }

  if ((options.newMapFlags[activeFlagIndex] ?? 0) !== 0) {
    return {
      reason: 'map-flag',
      fullRedraw: true,
      dirtyRects: [],
      consumedFlags: [options.activeMapFlag],
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
 * Clear invalidation markers at the end of one map-update cycle.
 * Mirrors `sim_update_maps` in `ref/micropolis/src/sim/sim.c`, which always
 * resets `NewMap` and clears all `NewMapFlags[0..NMAPS-1]` after map views are
 * processed.
 * Parity note: `plan` is retained for diagnostics call-sites, but the clear
 * behavior is cycle-wide and does not depend on consumed per-view flags.
 */
export function consumeMapRedrawPlan(
  state: MapInvalidationState,
  _plan: Pick<MapRedrawPlan, 'consumedFlags'>,
): void {
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
