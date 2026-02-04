import { describe, expect, it } from 'vitest';

import { Tile, TileFlag } from '../core/constants.ts';
import { isTree } from './is-tree.ts';

/**
 * `IsTree(cell)` is a small predicate used by terrain smoothing and tree
 * placement.
 *
 * Source of truth:
 * - `IsTree(int cell)` in `ref/micropolis/src/sim/s_gen.c`
 *
 * In C, it checks the *masked* tile ID (`cell & LOMASK`) against the inclusive
 * range `[WOODS_LOW..WOODS_HIGH]`, where:
 * - `WOODS_LOW`  is `TREEBASE` (21)
 * - `WOODS_HIGH` is `UNUSED_TRASH2` (39)
 *
 * "Magic numbers" in these cases:
 * - 20 is `LASTRIVEDGE` (non-tree water edge upper bound).
 * - 21 is `TREEBASE` (first tree tile).
 * - 39 is `UNUSED_TRASH2`, referenced by `WOODS_HIGH` in `s_gen.c`:
 *   `#define WOODS_HIGH UNUSED_TRASH2` (commented as 39 in C)
 * - 40 is `WOODS2` (outside the `[21..39]` tree range).
 */
describe('terrain IsTree', () => {
  it('matches the C masked range check (WOODS_LOW..WOODS_HIGH)', () => {
    const UNUSED_TRASH2 = 39;

    expect(isTree(Tile.LASTRIVEDGE)).toBe(false); // 20
    expect(isTree(Tile.TREEBASE)).toBe(true); // 21
    expect(isTree(UNUSED_TRASH2)).toBe(true); // 39
    expect(isTree(Tile.WOODS2)).toBe(false); // 40
  });

  it('uses the masked tile ID, so status flags do not affect classification', () => {
    const UNUSED_TRASH2 = 39;

    expect(isTree(Tile.WOODS | TileFlag.BLBNBIT)).toBe(true);
    expect(isTree(UNUSED_TRASH2 | TileFlag.BLBNBIT)).toBe(true);

    expect(isTree(Tile.LASTRIVEDGE | TileFlag.BLBNBIT)).toBe(false);
  });
});
