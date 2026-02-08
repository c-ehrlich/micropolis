import { describe, expect, it } from 'vitest';

import { World } from './constants.ts';
import { MAP_FLAGS } from './map-flags.ts';
import { consumeMapRedrawPlan, planMapRedraw } from './map-invalidation.ts';
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

describe('consumeMapRedrawPlan', () => {
  it('clears NewMap and consumed NewMapFlags entries only', () => {
    const state = {
      NewMap: 1,
      NewMapFlags: new Uint8Array(15),
    };
    state.NewMapFlags[MAP_FLAGS.ALMAP] = 1;
    state.NewMapFlags[MAP_FLAGS.PLMAP] = 1;

    consumeMapRedrawPlan(state, {
      consumedFlags: ['ALMAP'],
    });

    expect(state.NewMap).toBe(0);
    expect(state.NewMapFlags[MAP_FLAGS.ALMAP]).toBe(0);
    expect(state.NewMapFlags[MAP_FLAGS.PLMAP]).toBe(1);
  });
});
