import { describe, expect, it } from 'vitest';

import { World } from '../core/constants.ts';
import { indexFor, testBounds } from '../terrain/helpers.ts';

describe('terrain bounds helpers', () => {
  it('matches Micropolis TestBounds(x,y) semantics', () => {
    // This is a direct parity test for the `TestBounds(x, y)` macro in
    // `ref/micropolis/src/sim/headers/macros.h`:
    //
    //   ((x) >= 0) && ((x) < WORLD_X) && ((y) >= 0) && ((y) < WORLD_Y)
    //
    // The "magic numbers" 120×100 are Micropolis classic world dimensions,
    // specified in `ref/micropolis/spec/terrain/SPEC.md` and encoded in
    // `packages/sim-core/src/core/constants.ts` as `World.WORLD_X/Y`.
    const { WORLD_X, WORLD_Y } = World;

    expect(testBounds(0, 0)).toBe(true);
    expect(testBounds(WORLD_X - 1, WORLD_Y - 1)).toBe(true);

    expect(testBounds(-1, 0)).toBe(false);
    expect(testBounds(0, -1)).toBe(false);
    expect(testBounds(WORLD_X, 0)).toBe(false);
    expect(testBounds(0, WORLD_Y)).toBe(false);
  });

  it('computes column-major map indices (x * WORLD_Y + y)', () => {
    // Micropolis stores the map as `Map[x][y]`, with `y` as the contiguous inner
    // dimension (column-major). In our sim-core maps, we keep the same layout:
    //
    //   index = x * WORLD_Y + y
    //
    // The "100" stride comes from `WORLD_Y = 100` (classic Micropolis world
    // height); see `ref/micropolis/spec/terrain/SPEC.md`.
    const { WORLD_X, WORLD_Y } = World;

    expect(indexFor(0, 0)).toBe(0);
    expect(indexFor(0, 1)).toBe(1);
    expect(indexFor(1, 0)).toBe(WORLD_Y);
    expect(indexFor(1, 1)).toBe(WORLD_Y + 1);

    // Last tile in a 120x100 map (length = 12000) should be index 11999.
    expect(indexFor(WORLD_X - 1, WORLD_Y - 1)).toBe(WORLD_X * WORLD_Y - 1);
  });
});
