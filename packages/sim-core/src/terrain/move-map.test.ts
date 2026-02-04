import { describe, expect, it } from 'vitest';

import { moveMap } from './move-map.ts';

/**
 * These tests cover the 8-way direction table used by Micropolis terrain
 * generation river-walking and tree splashing.
 *
 * Source of truth:
 * - `MoveMap(short dir)` in `ref/micropolis/src/sim/s_gen.c`
 * - Also documented in `ref/micropolis/spec/terrain/SPEC.md` ("MoveMap(dir)")
 *
 * The "magic numbers" in the cases below are exactly the `DirTab` entries in C:
 *   dx: { 0, 1, 1, 1, 0,-1,-1,-1 }
 *   dy: {-1,-1, 0, 1, 1, 1, 0,-1 }
 */
describe('terrain MoveMap', () => {
  it('matches the C DirTab deltas for dir 0..7', () => {
    const startX = 10;
    const startY = 10;

    const cases: ReadonlyArray<{ dir: number; dx: number; dy: number }> = [
      { dir: 0, dx: 0, dy: -1 },
      { dir: 1, dx: 1, dy: -1 },
      { dir: 2, dx: 1, dy: 0 },
      { dir: 3, dx: 1, dy: 1 },
      { dir: 4, dx: 0, dy: 1 },
      { dir: 5, dx: -1, dy: 1 },
      { dir: 6, dx: -1, dy: 0 },
      { dir: 7, dx: -1, dy: -1 },
    ];

    for (const { dir, dx, dy } of cases) {
      const { mapX, mapY } = moveMap(startX, startY, dir);
      expect(mapX - startX, `dir=${dir} dx`).toBe(dx);
      expect(mapY - startY, `dir=${dir} dy`).toBe(dy);
    }
  });

  it('masks direction with `dir & 7` (C behavior)', () => {
    const startX = 10;
    const startY = 10;

    // In C: `dir = dir & 7;` so 8 becomes 0.
    expect(moveMap(startX, startY, 8)).toEqual(moveMap(startX, startY, 0));

    // In C: `dir` is a short and the bitmask is applied; in JS bitwise ops are
    // 32-bit signed, so `-1 & 7 === 7`, matching the "wrap to 7" behavior.
    expect(moveMap(startX, startY, -1)).toEqual(moveMap(startX, startY, 7));
  });
});
