import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, World } from '../core/constants.ts';
import { indexFor } from './helpers.ts';
import { smoothTrees } from './smooth-trees.ts';

/**
 * Tree smoothing (`SmoothTrees`) converts raw tree tiles into edge tiles based
 * on their 4-neighborhood.
 *
 * Source of truth:
 * - `SmoothTrees(void)` in `ref/micropolis/src/sim/s_gen.c`
 *
 * This routine uses a 16-entry lookup table `TEdTab[16]` in C:
 *
 *   { 0,0,0,34, 0,0,36,35, 0,32,0,33, 30,31,29,37 }
 *
 * `bitindex` is built from 4 neighbors in this order (DX/DY arrays in C):
 * - left, down, right, up
 *
 * i.e. `bitindex` bits are:
 * - bit3: left is tree
 * - bit2: down is tree
 * - bit1: right is tree
 * - bit0: up is tree
 *
 * "Magic numbers" asserted below (e.g. 34, 37) are taken directly from that
 * table in `s_gen.c`.
 */
describe('terrain SmoothTrees', () => {
  it('deletes isolated tree tiles (temp==0 => Map[x][y]=0)', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(Tile.DIRT);

    // Center is a tree (masked ID in the [TREEBASE..UNUSED_TRASH2] range).
    map[indexFor(10, 10)] = Tile.WOODS + TileFlag.BLBNBIT;

    // No tree neighbors => bitindex=0 => TEdTab[0]=0 => tile becomes 0 (DIRT).
    smoothTrees(map);

    expect(map[indexFor(10, 10)]).toBe(Tile.DIRT);
  });

  it('keeps fully-surrounded trees as WOODS (TEdTab[15]=37) with BLBNBIT', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(Tile.DIRT);

    // bitindex=15 means all 4 cardinal neighbors are trees.
    // In C: TEdTab[15] == 37 (`WOODS`).
    //
    // Important: `SmoothTrees` updates the map in-place while scanning, so if we
    // set only a cross-shape, the left/up neighbors get processed earlier and
    // can be deleted before the center is evaluated. A 3x3 block prevents those
    // earlier neighbors from becoming `temp==0`.
    const x = 20;
    const y = 20;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        map[indexFor(x + dx, y + dy)] = Tile.WOODS + TileFlag.BLBNBIT;
      }
    }

    smoothTrees(map);

    expect(map[indexFor(x, y)]).toBe(Tile.WOODS + TileFlag.BLBNBIT);
  });

  it('applies the checkerboard variant for non-WOODS outputs (temp!=WOODS)', () => {
    // C behavior:
    // - temp = TEdTab[bitindex]
    // - if temp != WOODS and (x+y)&1: temp = temp - 8
    // - write temp + BLBNBIT
    //
    // We pick a bit pattern where TEdTab[bitindex] is a non-WOODS non-zero:
    // bitindex=3 (right+up) => TEdTab[3] == 34 (from s_gen.c).
    const TEdTab_3 = 34;

    // Even parity cell: (10+10)&1 == 0 => no -8 adjustment.
    {
      const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(Tile.DIRT);

      const x = 10;
      const y = 10;
      map[indexFor(x, y)] = Tile.WOODS + TileFlag.BLBNBIT;

      // right + up are trees; left + down are dirt.
      map[indexFor(x + 1, y)] = Tile.WOODS + TileFlag.BLBNBIT; // right

      // Ensure the up-neighbor remains a tree when smoothed earlier in scan
      // order (C loops y ascending). A small cluster above it prevents it from
      // becoming temp==0 before the center is evaluated.
      map[indexFor(x, y - 1)] = Tile.WOODS + TileFlag.BLBNBIT; // up
      map[indexFor(x, y - 2)] = Tile.WOODS + TileFlag.BLBNBIT;
      map[indexFor(x + 1, y - 1)] = Tile.WOODS + TileFlag.BLBNBIT;
      map[indexFor(x + 1, y - 2)] = Tile.WOODS + TileFlag.BLBNBIT;

      smoothTrees(map);

      expect(map[indexFor(x, y)]).toBe(TEdTab_3 + TileFlag.BLBNBIT);
    }

    // Odd parity cell: (11+10)&1 == 1 => temp-8.
    {
      const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(Tile.DIRT);

      const x = 11;
      const y = 10;
      map[indexFor(x, y)] = Tile.WOODS + TileFlag.BLBNBIT;

      // right + up are trees; left + down are dirt.
      map[indexFor(x + 1, y)] = Tile.WOODS + TileFlag.BLBNBIT; // right

      map[indexFor(x, y - 1)] = Tile.WOODS + TileFlag.BLBNBIT; // up
      map[indexFor(x, y - 2)] = Tile.WOODS + TileFlag.BLBNBIT;
      map[indexFor(x + 1, y - 1)] = Tile.WOODS + TileFlag.BLBNBIT;
      map[indexFor(x + 1, y - 2)] = Tile.WOODS + TileFlag.BLBNBIT;

      smoothTrees(map);

      expect(map[indexFor(x, y)]).toBe(TEdTab_3 - 8 + TileFlag.BLBNBIT);
    }
  });
});
