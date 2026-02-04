import { Tile, TileMask } from '../core/constants.ts';

/**
 * Tree / woods predicate used by Micropolis terrain generation.
 *
 * 1:1 port of `IsTree(int cell)` in `ref/micropolis/src/sim/s_gen.c`.
 *
 * Important: the C implementation checks the *masked* tile ID:
 *
 *   `(cell & LOMASK) >= WOODS_LOW && (cell & LOMASK) <= WOODS_HIGH`
 *
 * Where `WOODS_LOW` is `TREEBASE` (21) and `WOODS_HIGH` is `UNUSED_TRASH2` (39).
 * This means status flags in the high bits do not affect the classification.
 */
export function isTree(cell: number): boolean {
  // In Micropolis, tile IDs live in the low 10 bits (`LOMASK`); the high bits
  // are status flags. `IsTree` is intentionally based on the masked ID.
  const tileId = cell & TileMask.LOMASK;

  // C defines:
  // - `WOODS_LOW  = TREEBASE` (21)
  // - `WOODS_HIGH = UNUSED_TRASH2` (39)
  //
  // sim-core does not currently expose `UNUSED_TRASH2` as a named constant in
  // `Tile`, so we use the exact numeric upper bound for 1:1 parity.
  const WOODS_LOW = Tile.TREEBASE;
  const WOODS_HIGH = 39;

  return tileId >= WOODS_LOW && tileId <= WOODS_HIGH;
}
