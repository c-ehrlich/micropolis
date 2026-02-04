import { getOrThrow } from '../core/assert.ts';
import { putOnMap } from './put-on-map.ts';

/**
 * Big-river "plop" tile matrix (9x9).
 *
 * 1:1 port of the `static short BRMatrix[9][9]` constant in
 * `ref/micropolis/src/sim/s_gen.c` (`BRivPlop`).
 *
 * Notes:
 * - The C matrix uses raw numeric tile IDs (0/2/3/4). We keep the same numeric
 *   values for parity; symbolic meaning (per `ref/micropolis/spec/terrain/SPEC.md`):
 *   - 0: no-op (PutOnMap early-return)
 *   - 2: RIVER
 *   - 3: REDGE
 *   - 4: CHANNEL
 */
const BR_MATRIX = [
  [0, 0, 0, 3, 3, 3, 0, 0, 0],
  [0, 0, 3, 2, 2, 2, 3, 0, 0],
  [0, 3, 2, 2, 2, 2, 2, 3, 0],
  [3, 2, 2, 2, 2, 2, 2, 2, 3],
  [3, 2, 2, 2, 4, 2, 2, 2, 3],
  [3, 2, 2, 2, 2, 2, 2, 2, 3],
  [0, 3, 2, 2, 2, 2, 2, 3, 0],
  [0, 0, 3, 2, 2, 2, 3, 0, 0],
  [0, 0, 0, 3, 3, 3, 0, 0, 0],
] as const satisfies ReadonlyArray<ReadonlyArray<number>>;

/**
 * Small-river "plop" tile matrix (6x6).
 *
 * 1:1 port of the `static short SRMatrix[6][6]` constant in
 * `ref/micropolis/src/sim/s_gen.c` (`SRivPlop`).
 *
 * Tile IDs follow the same convention as {@link BR_MATRIX}.
 */
const SR_MATRIX = [
  [0, 0, 3, 3, 0, 0],
  [0, 3, 2, 2, 3, 0],
  [3, 2, 2, 2, 2, 3],
  [3, 2, 2, 2, 2, 3],
  [0, 3, 2, 2, 3, 0],
  [0, 0, 3, 3, 0, 0],
] as const satisfies ReadonlyArray<ReadonlyArray<number>>;

/**
 * Apply the "big river" plop at the current cursor position.
 *
 * 1:1 port of `BRivPlop()` in `ref/micropolis/src/sim/s_gen.c`.
 *
 * C behavior:
 * - Treats `(mapX, mapY)` as the top-left of the 9x9 matrix.
 * - Applies offsets in the same order as C:
 *
 *     for (x = 0; x < 9; x++)
 *       for (y = 0; y < 9; y++)
 *         PutOnMap(BRMatrix[y][x], x, y);
 *
 * - Overwrite behavior and bounds clipping are implemented in `putOnMap(...)`,
 *   which is a 1:1 port of C's `PutOnMap`.
 */
export function bRivPlop(map: Uint16Array, mapX: number, mapY: number): void {
  for (let x = 0; x < 9; x += 1) {
    for (let y = 0; y < 9; y += 1) {
      const row = getOrThrow(BR_MATRIX[y], 'Expected BR_MATRIX row to exist');
      const mchar = getOrThrow(row[x], 'Expected BR_MATRIX cell to exist');
      putOnMap(map, mapX, mapY, mchar, x, y);
    }
  }
}

/**
 * Apply the "small river" plop at the current cursor position.
 *
 * 1:1 port of `SRivPlop()` in `ref/micropolis/src/sim/s_gen.c`.
 *
 * See {@link bRivPlop} for ordering/offset semantics; this uses a 6x6 matrix.
 */
export function sRivPlop(map: Uint16Array, mapX: number, mapY: number): void {
  for (let x = 0; x < 6; x += 1) {
    for (let y = 0; y < 6; y += 1) {
      const row = getOrThrow(SR_MATRIX[y], 'Expected SR_MATRIX row to exist');
      const mchar = getOrThrow(row[x], 'Expected SR_MATRIX cell to exist');
      putOnMap(map, mapX, mapY, mchar, x, y);
    }
  }
}
