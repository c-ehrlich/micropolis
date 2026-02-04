import { assertDefined } from '../core/assert.ts';
import { Tile, World } from '../core/constants.ts';
import { indexFor } from './helpers.ts';

/**
 * Fill the entire map with `Tile.DIRT`.
 *
 * 1:1 port of `ClearMap()` in `ref/micropolis/src/sim/s_gen.c`.
 *
 * In C:
 * - iterates `x=0..WORLD_X-1`, `y=0..WORLD_Y-1`
 * - writes `Map[x][y] = DIRT`
 */
export function clearMap(map: Uint16Array): void {
  // A typed-array `fill` is equivalent to the nested loops in the C version:
  // it writes the same scalar value into every `Map[x][y]` cell.
  map.fill(Tile.DIRT);
}

/**
 * Clear any "unnatural" tiles from the map (raw comparison).
 *
 * 1:1 port of `ClearUnnatural()` in `ref/micropolis/src/sim/s_gen.c`.
 *
 * Important: the C implementation uses a **raw** comparison:
 *
 *   `if (Map[x][y] > WOODS) Map[x][y] = DIRT;`
 *
 * This is intentionally *not* `(tile & LOMASK) > WOODS`. As a result, any tile
 * with status bits set (high bits) is treated as unnatural and cleared, even if
 * its low 10-bit tile ID would otherwise be <= `WOODS`.
 */
export function clearUnnatural(map: Uint16Array): void {
  for (let x = 0; x < World.WORLD_X; x += 1) {
    for (let y = 0; y < World.WORLD_Y; y += 1) {
      const index = indexFor(x, y);
      const tile = map[index];
      assertDefined(tile, 'Expected map index to be in-bounds');
      if (tile > Tile.WOODS) {
        map[index] = Tile.DIRT;
      }
    }
  }
}
