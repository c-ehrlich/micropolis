import { assertDefined } from '../core/assert.ts';
import { Tile, TileMask } from '../core/constants.ts';
import { indexFor, testBounds } from './helpers.ts';

/**
 * Writes a single terrain tile to the map, applying Micropolis overwrite rules.
 *
 * 1:1 port of `PutOnMap(Mchar, Xoff, Yoff)` in `ref/micropolis/src/sim/s_gen.c`.
 *
 * Notes on behavior (mirrors C exactly):
 * - `mchar === 0` is a no-op (used by the river plop matrices).
 * - The write is clipped by `TestBounds(MapX + Xoff, MapY + Yoff)`.
 * - Existing tiles are compared using `(tile & LOMASK)`:
 *   - If existing is `RIVER`, only `CHANNEL` can overwrite it.
 *   - If existing is `CHANNEL`, nothing can overwrite it (including CHANNEL).
 *
 * @param map The classic Micropolis map layer (`Map[x][y]`) as a column-major `Uint16Array`.
 * @param mapX Cursor X (`MapX` in C).
 * @param mapY Cursor Y (`MapY` in C).
 * @param mchar Tile value to write (`Mchar` in C); may include status bits.
 * @param xoff Offset X relative to `mapX` (`Xoff` in C).
 * @param yoff Offset Y relative to `mapY` (`Yoff` in C).
 */
export function putOnMap(
  map: Uint16Array,
  mapX: number,
  mapY: number,
  mchar: number,
  xoff: number,
  yoff: number,
): void {
  if (mchar === 0) {
    return;
  }

  const xloc = mapX + xoff;
  const yloc = mapY + yoff;

  if (!testBounds(xloc, yloc)) {
    return;
  }

  const index = indexFor(xloc, yloc);
  const existingRaw = map[index];
  assertDefined(existingRaw, 'Expected map index to be in-bounds');

  if (existingRaw !== 0) {
    const existing = existingRaw & TileMask.LOMASK;

    if (existing === Tile.RIVER && mchar !== Tile.CHANNEL) {
      return;
    }

    if (existing === Tile.CHANNEL) {
      return;
    }
  }

  map[index] = mchar;
}
