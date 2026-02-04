import { assertDefined, getOrThrow } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import { indexFor, testBounds } from './helpers.ts';
import { isTree } from './is-tree.ts';
import type { TerrainRng } from './rng.ts';

/**
 * Smooth river/water edge tiles into shoreline variants.
 *
 * 1:1 port of `SmoothRiver(void)` in `ref/micropolis/src/sim/s_gen.c`, as
 * described by `ref/micropolis/spec/terrain/SPEC.md` ("SmoothRiver()").
 *
 * Behavior notes (mirrors C exactly):
 * - Only processes tiles where `Map[x][y] == REDGE` (raw equality, no masking).
 * - Builds a 4-neighbor `bitindex` in the order: left, down, right, up.
 * - A neighbor contributes a `1` iff it is in-bounds and:
 *     - `(neighbor & LOMASK) != DIRT`, and
 *     - masked tile id is NOT in the woods range `[TREEBASE..UNUSED_TRASH2]`.
 * - Uses the 16-entry lookup table `REdTab[16]` (exact values from C).
 * - If the selected `temp` is not `RIVER`, draws `Rand(1)` (inclusive => 0|1)
 *   and increments `temp` when the draw is non-zero. This picks the alternate
 *   shoreline variant in the `FIRSTRIVEDGE..LASTRIVEDGE` range.
 * - Writes `temp` back into `Map[x][y]`. Note that `REdTab` entries include
 *   `BULLBIT` (not `BLBNBIT`) in the C implementation.
 *
 * C reference:
 * - `SmoothRiver(void)` and `REdTab` in `ref/micropolis/src/sim/s_gen.c`
 */
export function smoothRiver(map: Uint16Array, rng: TerrainRng): void {
  // C constants:
  //   static short DX[4] = {-1, 0, 1, 0};
  //   static short DY[4] = { 0, 1, 0,-1};
  const DX = [-1, 0, 1, 0] as const;
  const DY = [0, 1, 0, -1] as const;

  // 1:1 copy of `REdTab[16]` from `ref/micropolis/src/sim/s_gen.c`.
  //
  // These values are full tile words, including `BULLBIT` (bit 12) on the edge
  // variants. Entries that are exactly `2` represent `RIVER` (no status bits).
  const REdTab: readonly number[] = [
    13 + TileFlag.BULLBIT,
    13 + TileFlag.BULLBIT,
    17 + TileFlag.BULLBIT,
    15 + TileFlag.BULLBIT,
    5 + TileFlag.BULLBIT,
    2,
    19 + TileFlag.BULLBIT,
    17 + TileFlag.BULLBIT,
    9 + TileFlag.BULLBIT,
    11 + TileFlag.BULLBIT,
    2,
    13 + TileFlag.BULLBIT,
    7 + TileFlag.BULLBIT,
    9 + TileFlag.BULLBIT,
    5 + TileFlag.BULLBIT,
    2,
  ];

  for (let mapX = 0; mapX < World.WORLD_X; mapX += 1) {
    for (let mapY = 0; mapY < World.WORLD_Y; mapY += 1) {
      const index = indexFor(mapX, mapY);
      const cell = map[index];
      assertDefined(cell, 'Expected in-bounds map access');

      // Exact match required (raw equality), per C:
      //   if (Map[MapX][MapY] == REDGE) { ... }
      if (cell !== Tile.REDGE) {
        continue;
      }

      let bitindex = 0;
      for (let z = 0; z < 4; z += 1) {
        bitindex = bitindex << 1;

        const dx = getOrThrow(DX[z], 'Expected DX to have length 4');
        const dy = getOrThrow(DY[z], 'Expected DY to have length 4');

        const xTem = mapX + dx;
        const yTem = mapY + dy;
        if (!testBounds(xTem, yTem)) {
          continue;
        }

        const neighbor = map[indexFor(xTem, yTem)];
        assertDefined(neighbor, 'Expected in-bounds map access for river neighbor');

        const neighborId = neighbor & TileMask.LOMASK;
        if (neighborId !== Tile.DIRT && !isTree(neighbor)) {
          bitindex += 1;
        }
      }

      let temp = getOrThrow(REdTab[bitindex & 15], 'Expected REdTab to have 16 entries');
      if (temp !== Tile.RIVER) {
        // C:
        //   if ((temp != RIVER) && (Rand(1))) temp++;
        if (rng.rand(1) !== 0) {
          temp += 1;
        }
      }

      map[index] = temp;
    }
  }
}
