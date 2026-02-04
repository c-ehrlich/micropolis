import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, World } from '../core/constants.ts';
import { indexFor } from './helpers.ts';
import { QueueTerrainRng } from './rng.ts';
import { smoothRiver } from './smooth-river.ts';

/**
 * River smoothing (`SmoothRiver`) converts `REDGE` (tile id 3) into a more
 * specific river-edge variant based on its 4-neighborhood.
 *
 * Source of truth:
 * - `SmoothRiver(void)` and `REdTab[16]` in `ref/micropolis/src/sim/s_gen.c`
 *
 * `bitindex` is built from 4 neighbors in this order (DX/DY arrays in C):
 * - left, down, right, up
 *
 * Each neighbor contributes a `1` iff (C condition):
 * - neighbor in bounds, AND
 * - (neighbor & LOMASK) != DIRT, AND
 * - neighbor is NOT in the woods range [WOODS_LOW..WOODS_HIGH] (21..39).
 *
 * Then:
 * - `temp = REdTab[bitindex & 15]`
 * - if `temp != RIVER` and `Rand(1)` is non-zero, `temp++` (alternate variant)
 * - write `Map[x][y] = temp`
 *
 * "Magic numbers" asserted here (e.g. 13, 2) are table entries from `REdTab` in
 * `s_gen.c`. `TileFlag.BULLBIT` comes from `ref/micropolis/src/sim/headers/macros.h`.
 */
describe('terrain SmoothRiver', () => {
  it('increments temp when Rand(1)=1 and temp != RIVER', () => {
    // Choose bitindex=0 (no qualifying neighbors).
    // In C: REdTab[0] == 13 + BULLBIT.
    const REdTab_0 = 13 + TileFlag.BULLBIT;

    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(Tile.DIRT);
    const x = 10;
    const y = 10;

    // Only `REDGE` tiles are processed, and this must be exact (raw equality).
    map[indexFor(x, y)] = Tile.REDGE;

    const rng = new QueueTerrainRng({ randValues: [1] }); // Rand(1)=1 => take alternate (+1)

    smoothRiver(map, rng);

    // Since temp != RIVER, SmoothRiver does:
    //   if (Rand(1)) temp++;
    expect(map[indexFor(x, y)]).toBe(REdTab_0 + 1);
  });

  it('does not call Rand(1) (and does not increment) when temp == RIVER', () => {
    // Choose bitindex=5 (down+up qualify, left+right do not).
    // In C: REdTab[5] == 2 (RIVER).
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(Tile.DIRT);
    const x = 30;
    const y = 30;

    map[indexFor(x, y)] = Tile.REDGE;
    map[indexFor(x, y - 1)] = Tile.RIVER; // up => qualifies
    map[indexFor(x, y + 1)] = Tile.RIVER; // down => qualifies

    // If our TS port incorrectly calls `Rand(1)` even when `temp == RIVER`,
    // this queue-backed RNG will throw due to a missing value.
    const rng = new QueueTerrainRng({ randValues: [] });

    smoothRiver(map, rng);

    expect(map[indexFor(x, y)]).toBe(Tile.RIVER);
  });
});
