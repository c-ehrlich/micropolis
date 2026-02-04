import { describe, expect, it, vi } from 'vitest';

import { World } from '../core/constants.ts';
import { makeIsland } from './make-island.ts';
import * as makeLakesModule from './make-lakes.ts';
import type { TerrainRng } from './rng.ts';

class NoopTerrainRng implements TerrainRng {
  seed(_value: number): void {
    throw new Error('NoopTerrainRng.seed() should not be called by this test');
  }

  next16(): number {
    throw new Error('NoopTerrainRng.next16() should not be called by this test');
  }

  rand(_range: number): number {
    throw new Error('NoopTerrainRng.rand() should not be called by this test');
  }
}

/**
 * Island generation wrapper (`MakeIsland`).
 *
 * Source of truth:
 * - `MakeIsland()` in `ref/micropolis/src/sim/s_gen.c`
 * - `ref/micropolis/spec/terrain/SPEC.md` ("MakeIsland()")
 *
 * This is intentionally a spy-based test: `MakeIsland()` is defined in C as a
 * thin orchestration wrapper:
 *   `MakeNakedIsland(); SmoothRiver(); DoTrees();`
 *
 * There are no "magic numbers" in this wrapper, only a required call order.
 */
describe('terrain MakeIsland', () => {
  it('calls MakeNakedIsland, then SmoothRiver, then DoTrees (and does not call MakeLakes)', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);
    const rng = new NoopTerrainRng();
    const treeLevel = -1;

    const makeLakesSpy = vi.spyOn(makeLakesModule, 'makeLakes');

    const calls: string[] = [];

    makeIsland(map, rng, treeLevel, {
      makeNakedIsland: (targetMap, targetRng) => {
        expect(targetMap).toBe(map);
        expect(targetRng).toBe(rng);
        calls.push('MakeNakedIsland');
      },
      smoothRiver: (targetMap, targetRng) => {
        expect(calls).toEqual(['MakeNakedIsland']);
        expect(targetMap).toBe(map);
        expect(targetRng).toBe(rng);
        calls.push('SmoothRiver');
      },
      doTrees: (targetMap, targetRng, observedTreeLevel) => {
        expect(calls).toEqual(['MakeNakedIsland', 'SmoothRiver']);
        expect(targetMap).toBe(map);
        expect(targetRng).toBe(rng);
        expect(observedTreeLevel).toBe(treeLevel);
        calls.push('DoTrees');
      },
    });

    expect(calls).toEqual(['MakeNakedIsland', 'SmoothRiver', 'DoTrees']);

    // In the Micropolis pipeline, lakes are a separate stage invoked by
    // `GenerateMap` (after rivers). `MakeIsland` should not call `MakeLakes`.
    expect(makeLakesSpy).not.toHaveBeenCalled();
  });
});
