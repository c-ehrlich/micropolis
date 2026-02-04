import { getOrThrow } from '../core/assert.ts';
import { Tile, TileFlag, World } from '../core/constants.ts';
import { indexFor, testBounds } from './helpers.ts';
import { isTree } from './is-tree.ts';

/**
 * Smooth tree tiles into edge variants.
 *
 * 1:1 port of `SmoothTrees(void)` in `ref/micropolis/src/sim/s_gen.c`.
 *
 * Behavior notes (mirrors C exactly):
 * - Only operates on tiles where `IsTree(Map[x][y])` is true (masked ID in the
 *   `[TREEBASE..UNUSED_TRASH2]` range).
 * - Builds a 4-neighbor `bitindex` in the order: left, down, right, up.
 * - Maps that bit pattern via the 16-entry lookup table `TEdTab[16]`.
 * - If `temp == 0`, deletes the tree tile (`Map[x][y] = 0`).
 * - Otherwise writes `temp + BLBNBIT` (always sets BULLBIT+BURNBIT).
 * - For non-`WOODS` outputs, applies a checkerboard variant:
 *     if ((x + y) & 1) temp = temp - 8
 *
 * C reference:
 * - `SmoothTrees(void)` and `TEdTab` in `ref/micropolis/src/sim/s_gen.c`
 */
export function smoothTrees(map: Uint16Array): void {
  // C constants:
  //   static short DX[4] = {-1, 0, 1, 0};
  //   static short DY[4] = { 0, 1, 0,-1};
  const DX = [-1, 0, 1, 0] as const;
  const DY = [0, 1, 0, -1] as const;

  // 1:1 copy of `TEdTab[16]` from `ref/micropolis/src/sim/s_gen.c`.
  //
  // These values are tile IDs (low 10 bits). When written back, C adds
  // `BLBNBIT` (BULLBIT+BURNBIT).
  const TEdTab: readonly number[] = [0, 0, 0, 34, 0, 0, 36, 35, 0, 32, 0, 33, 30, 31, 29, 37];

  for (let mapX = 0; mapX < World.WORLD_X; mapX += 1) {
    for (let mapY = 0; mapY < World.WORLD_Y; mapY += 1) {
      const index = indexFor(mapX, mapY);
      const cell = getOrThrow(map[index], 'Expected in-bounds map access');

      if (!isTree(cell)) {
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

        const neighbor = getOrThrow(
          map[indexFor(xTem, yTem)],
          'Expected in-bounds map access for tree neighbor',
        );
        if (isTree(neighbor)) {
          bitindex += 1;
        }
      }

      let temp = getOrThrow(TEdTab[bitindex & 15], 'Expected TEdTab to have 16 entries');
      if (temp !== 0) {
        if (temp !== Tile.WOODS) {
          if (((mapX + mapY) & 1) === 1) {
            temp -= 8;
          }
        }

        map[index] = temp + TileFlag.BLBNBIT;
      } else {
        map[index] = 0;
      }
    }
  }
}
