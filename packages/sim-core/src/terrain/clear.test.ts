import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, World } from '../core/constants.ts';
import { clearMap, clearUnnatural } from './clear.ts';
import { indexFor } from './helpers.ts';

describe('terrain clear routines', () => {
  it('clearMap fills every tile with DIRT', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);
    map.fill(Tile.WOODS);

    // 1:1 port target: `ClearMap()` in `ref/micropolis/src/sim/s_gen.c`,
    // which writes `DIRT` (tile ID 0) to every Map[x][y] cell.
    clearMap(map);

    for (let i = 0; i < map.length; i += 1) {
      expect(map[i]).toBe(Tile.DIRT);
    }
  });

  it('clearUnnatural clears raw tile values > WOODS (no masking)', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);
    map.fill(Tile.DIRT);

    // 1:1 port target: `ClearUnnatural()` in `ref/micropolis/src/sim/s_gen.c`:
    //
    //   if (Map[x][y] > WOODS) Map[x][y] = DIRT;
    //
    // This is a *raw* comparison (not `(tile & LOMASK)`), which means any status
    // bit makes a tile "unnatural" since it raises the 16-bit value above 37.
    //
    // Magic numbers (from `ref/micropolis/spec/terrain/SPEC.md`):
    // - `WOODS` tile ID is 37.
    // - `BLBNBIT` is `BULLBIT + BURNBIT` = 4096 + 8192 = 12288 (0x3000).
    map[indexFor(1, 1)] = Tile.WOODS;
    map[indexFor(2, 2)] = Tile.WOODS | TileFlag.BLBNBIT;
    map[indexFor(3, 3)] = Tile.WOODS + 1; // 38 (unused trash tile in the C spec) > 37
    map[indexFor(4, 4)] = Tile.RIVER | TileFlag.BULLBIT; // low ID, but raw value > WOODS

    clearUnnatural(map);

    expect(map[indexFor(1, 1)]).toBe(Tile.WOODS);
    expect(map[indexFor(2, 2)]).toBe(Tile.DIRT);
    expect(map[indexFor(3, 3)]).toBe(Tile.DIRT);
    expect(map[indexFor(4, 4)]).toBe(Tile.DIRT);
  });
});
