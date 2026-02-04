import { describe, expect, it } from 'vitest';

import { Tile, World } from '../core/constants.ts';
import { indexFor } from './helpers.ts';
import { makeNakedIsland } from './make-naked-island.ts';
import type { TerrainRng } from './rng.ts';

class ConstTerrainRng implements TerrainRng {
  readonly ranges: number[] = [];

  seed(_value: number): void {
    // Not used by `MakeNakedIsland` in C.
  }

  next16(): number {
    throw new Error('ConstTerrainRng.next16(): not implemented for these tests');
  }

  rand(range: number): number {
    this.ranges.push(range);
    // Deterministic, valid for any inclusive `Rand(range)` call.
    return 0;
  }
}

/**
 * Island base generation (`MakeNakedIsland`).
 *
 * Source of truth:
 * - `MakeNakedIsland()` in `ref/micropolis/src/sim/s_gen.c`
 * - `ref/micropolis/spec/terrain/SPEC.md` ("MakeNakedIsland()")
 *
 * Magic numbers used here come from the C implementation:
 * - Border thickness: the interior DIRT rectangle is written for `x=5..WORLD_X-6`,
 *   `y=5..WORLD_Y-6` (i.e. the loop bounds `x < WORLD_X - 5`, `y < WORLD_Y - 5`).
 * - Perimeter loop bounds: `x < WORLD_X - 5` and `y < WORLD_Y - 5`, stepping by 2.
 * - RADIUS: `18` (used by `ERand(RADIUS)`).
 * - Edge offsets: `WORLD_Y - 10`, `WORLD_Y - 6`, `WORLD_X - 10`, `WORLD_X - 6`.
 */
describe('terrain MakeNakedIsland', () => {
  it('fills the world with RIVER, then writes an interior DIRT rectangle with a 5-tile water border (plops stubbed)', () => {
    const rng = new ConstTerrainRng();
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(1234);

    makeNakedIsland(map, rng, {
      // Stub the perimeter plops to isolate the "base fill + border" behavior.
      bRivPlop: () => {},
      sRivPlop: () => {},
    });

    // Border sample points: remain water (RIVER) because plops are stubbed.
    expect(map[indexFor(0, 0)]).toBe(Tile.RIVER);
    expect(map[indexFor(4, 50)]).toBe(Tile.RIVER);
    expect(map[indexFor(60, 4)]).toBe(Tile.RIVER);
    expect(map[indexFor(World.WORLD_X - 1, World.WORLD_Y - 1)]).toBe(Tile.RIVER);

    // Interior sample points: set to DIRT by the `[5..WORLD_X-6]×[5..WORLD_Y-6]` loop.
    expect(map[indexFor(5, 5)]).toBe(Tile.DIRT);
    expect(map[indexFor(60, 50)]).toBe(Tile.DIRT);
    expect(map[indexFor(World.WORLD_X - 6, World.WORLD_Y - 6)]).toBe(Tile.DIRT);

    // Border-adjacent interior points (exactly 5 in from edge) are still interior.
    expect(map[indexFor(5, 4)]).toBe(Tile.RIVER);
    expect(map[indexFor(4, 5)]).toBe(Tile.RIVER);
    expect(map[indexFor(5, 5)]).toBe(Tile.DIRT);
  });

  it('calls perimeter plops the expected number of times (loop bounds match C)', () => {
    const rng = new ConstTerrainRng();
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);

    let bCalls = 0;
    let sCalls = 0;

    makeNakedIsland(map, rng, {
      bRivPlop: () => {
        bCalls += 1;
      },
      sRivPlop: () => {
        sCalls += 1;
      },
    });

    // C loops:
    // - `for (x = 0; x < WORLD_X - 5; x += 2)` => x = 0..114 (step 2) => 58 iterations.
    // - `for (y = 0; y < WORLD_Y - 5; y += 2)` => y = 0..94 (step 2) => 48 iterations.
    //
    // Each iteration performs 2 BRivPlop calls and 2 SRivPlop calls.
    const xIterations = 58;
    const yIterations = 48;
    const expectedPlopsPerLoopIteration = 2;

    expect(bCalls).toBe(expectedPlopsPerLoopIteration * (xIterations + yIterations));
    expect(sCalls).toBe(expectedPlopsPerLoopIteration * (xIterations + yIterations));

    // `ERand(RADIUS)` is called twice per iteration (top/bottom and left/right),
    // and `ERand` draws from `Rand(RADIUS)` twice. Total `rand(18)` calls:
    //   4 * (xIterations + yIterations) = 424
    // All should be called with `range=18` (RADIUS).
    expect(rng.ranges.length).toBe(4 * (xIterations + yIterations));
    expect(new Set(rng.ranges)).toEqual(new Set([18]));
  });
});
