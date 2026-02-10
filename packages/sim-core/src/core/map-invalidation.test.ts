import { describe, expect, it } from 'vitest';

import { World } from './constants.ts';
import { MAP_FLAG_COUNT, MAP_FLAGS } from './map-flags.ts';
import {
  consumeMapInvalidationCycle,
  consumeMapRedrawPlan,
  markCrimeScanMapFlags,
  markFireAnalysisMapFlags,
  markPopDenScanMapFlags,
  markPTLScanMapFlags,
  planMapRedraw,
  resolveMapFlagForMapState,
} from './map-invalidation.ts';
import type { Patch } from './map-store.ts';

/**
 * Convert Micropolis-style map coordinates into the linear map index used by
 * `Map[WORLD_X][WORLD_Y]` access patterns in C.
 * Mirrors index math used across C scan/render paths (`x * WORLD_Y + y`).
 */
function mapIndex(x: number, y: number): number {
  return x * World.WORLD_Y + y;
}

/**
 * Build a deterministic map patch fixture for redraw planning tests.
 * Parity note: only the `index` vector is significant for redraw policy.
 */
function createMapPatch(indexes: ReadonlyArray<number>): Patch {
  return {
    layer: 'map',
    index: Uint32Array.from(indexes),
    prev: new Uint16Array(indexes.length),
    next: new Uint16Array(indexes.length),
  };
}

describe('planMapRedraw', () => {
  it('forces full redraw when NewMap is set and consumes the active map flag', () => {
    const newMapFlags = new Uint8Array(15);
    newMapFlags[MAP_FLAGS.ALMAP] = 1;

    const plan = planMapRedraw({
      activeMapFlag: 'ALMAP',
      newMap: 1,
      newMapFlags,
      mapPatch: createMapPatch([mapIndex(0, 0)]),
    });

    expect(plan).toEqual({
      reason: 'new-map',
      fullRedraw: true,
      dirtyRects: [],
      consumedFlags: ['ALMAP'],
    });
  });

  it('forces full redraw when the active map flag is dirty', () => {
    const newMapFlags = new Uint8Array(15);
    newMapFlags[MAP_FLAGS.PDMAP] = 1;

    const plan = planMapRedraw({
      activeMapFlag: 'PDMAP',
      newMap: 0,
      newMapFlags,
      mapPatch: createMapPatch([mapIndex(10, 10)]),
    });

    expect(plan).toEqual({
      reason: 'map-flag',
      fullRedraw: true,
      dirtyRects: [],
      consumedFlags: ['PDMAP'],
    });
  });

  it('resolves active map flag from map_state using the g_map.c draw-mode table', () => {
    const newMapFlags = new Uint8Array(15);
    // `PDMAP` is map_state 6 in `sim.h`/`g_map.c` (`setUpMapProcs` table order).
    newMapFlags[MAP_FLAGS.PDMAP] = 1;

    const plan = planMapRedraw({
      activeMapState: 6,
      newMap: 0,
      newMapFlags,
      mapPatch: createMapPatch([mapIndex(4, 4)]),
    });

    expect(plan).toEqual({
      reason: 'map-flag',
      fullRedraw: true,
      dirtyRects: [],
      consumedFlags: ['PDMAP'],
    });
  });

  it('forces full redraw while ShakeNow is active', () => {
    const plan = planMapRedraw({
      activeMapFlag: 'ALMAP',
      newMap: 0,
      newMapFlags: new Uint8Array(15),
      // `sim_update_maps` invalidates map views when `ShakeNow` is non-zero.
      // Source: `ref/micropolis/src/sim/sim.c` (`mustUpdateMap` expression).
      shakeNow: 1,
      mapPatch: createMapPatch([mapIndex(7, 9)]),
    });

    expect(plan).toEqual({
      reason: 'shake',
      fullRedraw: true,
      dirtyRects: [],
      consumedFlags: [],
    });
  });

  it('coalesces patch indexes into deterministic tile rectangles', () => {
    const plan = planMapRedraw({
      activeMapFlag: 'ALMAP',
      newMap: 0,
      newMapFlags: new Uint8Array(15),
      mapPatch: createMapPatch([
        mapIndex(20, 8),
        mapIndex(10, 3),
        mapIndex(11, 2),
        mapIndex(10, 2),
        mapIndex(11, 3),
      ]),
    });

    expect(plan.reason).toBe('patch-rects');
    expect(plan.fullRedraw).toBe(false);
    expect(plan.dirtyRects).toEqual([
      { x: 10, y: 2, width: 2, height: 2 },
      { x: 20, y: 8, width: 1, height: 1 },
    ]);
    expect(plan.consumedFlags).toEqual([]);
  });

  it('falls back to full redraw when dirty tile count exceeds threshold', () => {
    const patch = createMapPatch([
      mapIndex(1, 1),
      mapIndex(2, 2),
      mapIndex(3, 3),
      mapIndex(4, 4),
      mapIndex(5, 5),
    ]);

    const plan = planMapRedraw({
      activeMapFlag: 'ALMAP',
      newMap: 0,
      newMapFlags: new Uint8Array(15),
      mapPatch: patch,
      maxDirtyTilesBeforeFullRedraw: 4,
    });

    expect(plan).toEqual({
      reason: 'patch-tile-threshold',
      fullRedraw: true,
      dirtyRects: [],
      consumedFlags: [],
    });
  });

  it('falls back to full redraw when rectangle count exceeds threshold', () => {
    const patch = createMapPatch([mapIndex(0, 0), mapIndex(10, 10), mapIndex(20, 20)]);

    const plan = planMapRedraw({
      activeMapFlag: 'ALMAP',
      newMap: 0,
      newMapFlags: new Uint8Array(15),
      mapPatch: patch,
      maxDirtyRectsBeforeFullRedraw: 2,
    });

    expect(plan).toEqual({
      reason: 'patch-rect-threshold',
      fullRedraw: true,
      dirtyRects: [],
      consumedFlags: [],
    });
  });

  it('ignores non-map patches for map redraw planning', () => {
    const plan = planMapRedraw({
      activeMapFlag: 'ALMAP',
      newMap: 0,
      newMapFlags: new Uint8Array(15),
      mapPatch: {
        layer: 'popDensity',
        index: Uint32Array.from([0]),
        prev: Uint8Array.from([0]),
        next: Uint8Array.from([1]),
      },
    });

    expect(plan).toEqual({
      reason: 'none',
      fullRedraw: false,
      dirtyRects: [],
      consumedFlags: [],
    });
  });
});

describe('resolveMapFlagForMapState', () => {
  it('maps valid C map_state indexes to their NewMapFlags slot ids', () => {
    // `ALMAP=0`, `PLMAP=9`, and `DYMAP=14` are defined in `sim.h` for map modes.
    expect(resolveMapFlagForMapState(0)).toBe('ALMAP');
    expect(resolveMapFlagForMapState(9)).toBe('PLMAP');
    expect(resolveMapFlagForMapState(14)).toBe('DYMAP');
  });

  it('returns null for out-of-range map_state indexes', () => {
    // `MapCmdMapState` bounds in `w_map.c`: `state < 0 || state >= NMAPS`.
    expect(resolveMapFlagForMapState(-1)).toBeNull();
    expect(resolveMapFlagForMapState(MAP_FLAG_COUNT)).toBeNull();
  });
});

describe('consumeMapRedrawPlan', () => {
  it('clears NewMap and all C map-flag slots for the update cycle', () => {
    const state = {
      NewMap: 1,
      NewMapFlags: new Uint8Array(MAP_FLAG_COUNT),
    };
    state.NewMapFlags[MAP_FLAGS.ALMAP] = 1;
    state.NewMapFlags[MAP_FLAGS.PLMAP] = 1;

    consumeMapRedrawPlan(state, {
      consumedFlags: [],
    });

    expect(state.NewMap).toBe(0);
    expect(state.NewMapFlags[MAP_FLAGS.ALMAP]).toBe(0);
    expect(state.NewMapFlags[MAP_FLAGS.PLMAP]).toBe(0);
  });

  it('clears C map invalidation slots even when no per-view metadata is provided', () => {
    const extensionSlot = MAP_FLAG_COUNT;
    const state = {
      NewMap: 1,
      // C `sim_update_maps` clears `NewMapFlags[0..NMAPS-1]` only.
      NewMapFlags: new Uint8Array(MAP_FLAG_COUNT + 1),
    };
    state.NewMapFlags[MAP_FLAGS.ALMAP] = 1;
    state.NewMapFlags[MAP_FLAGS.DYMAP] = 1;
    state.NewMapFlags[extensionSlot] = 6;

    // C has no per-view consumed flag list; clear happens once after map-view loop.
    consumeMapRedrawPlan(state);

    expect(state.NewMap).toBe(0);
    expect(state.NewMapFlags[MAP_FLAGS.ALMAP]).toBe(0);
    expect(state.NewMapFlags[MAP_FLAGS.DYMAP]).toBe(0);
    expect(state.NewMapFlags[extensionSlot]).toBe(6);
  });

  it('only clears the C NMAPS flag range', () => {
    const extensionSlot = MAP_FLAG_COUNT;
    const state = {
      NewMap: 0,
      // C `sim_update_maps` clears `NewMapFlags[0..NMAPS-1]` only.
      NewMapFlags: new Uint8Array(MAP_FLAG_COUNT + 1),
    };
    state.NewMapFlags[MAP_FLAGS.DYMAP] = 1;
    state.NewMapFlags[extensionSlot] = 9;

    consumeMapRedrawPlan(state, {
      consumedFlags: ['DYMAP'],
    });

    expect(state.NewMapFlags[MAP_FLAGS.DYMAP]).toBe(0);
    expect(state.NewMapFlags[extensionSlot]).toBe(9);
  });
});

describe('scan map-flag producers', () => {
  it('matches FireAnalysis NewMapFlags writes from s_scan.c', () => {
    const state = {
      NewMapFlags: new Uint8Array(MAP_FLAG_COUNT),
    };

    markFireAnalysisMapFlags(state);

    expect(state.NewMapFlags[MAP_FLAGS.DYMAP]).toBe(1);
    expect(state.NewMapFlags[MAP_FLAGS.FIMAP]).toBe(1);
  });

  it('matches PopDenScan NewMapFlags writes from s_scan.c', () => {
    const state = {
      NewMapFlags: new Uint8Array(MAP_FLAG_COUNT),
    };

    markPopDenScanMapFlags(state);

    expect(state.NewMapFlags[MAP_FLAGS.DYMAP]).toBe(1);
    expect(state.NewMapFlags[MAP_FLAGS.PDMAP]).toBe(1);
    expect(state.NewMapFlags[MAP_FLAGS.RGMAP]).toBe(1);
  });

  it('matches PTLScan NewMapFlags writes from s_scan.c', () => {
    const state = {
      NewMapFlags: new Uint8Array(MAP_FLAG_COUNT),
    };

    markPTLScanMapFlags(state);

    expect(state.NewMapFlags[MAP_FLAGS.DYMAP]).toBe(1);
    expect(state.NewMapFlags[MAP_FLAGS.PLMAP]).toBe(1);
    expect(state.NewMapFlags[MAP_FLAGS.LVMAP]).toBe(1);
  });

  it('matches CrimeScan NewMapFlags writes from s_scan.c', () => {
    const state = {
      NewMapFlags: new Uint8Array(MAP_FLAG_COUNT),
    };

    markCrimeScanMapFlags(state);

    expect(state.NewMapFlags[MAP_FLAGS.DYMAP]).toBe(1);
    expect(state.NewMapFlags[MAP_FLAGS.CRMAP]).toBe(1);
    expect(state.NewMapFlags[MAP_FLAGS.POMAP]).toBe(1);
  });
});

describe('consumeMapInvalidationCycle', () => {
  it('clears map invalidation markers once after a full view-update cycle', () => {
    const extensionSlot = MAP_FLAG_COUNT;
    const state = {
      NewMap: 1,
      // C `sim_update_maps` clears `NewMapFlags[0..NMAPS-1]` only.
      NewMapFlags: new Uint8Array(MAP_FLAG_COUNT + 1),
    };
    state.NewMapFlags[MAP_FLAGS.ALMAP] = 1;
    state.NewMapFlags[extensionSlot] = 7;

    consumeMapInvalidationCycle(state);

    expect(state.NewMap).toBe(0);
    expect(state.NewMapFlags[MAP_FLAGS.ALMAP]).toBe(0);
    expect(state.NewMapFlags[extensionSlot]).toBe(7);
  });
});
