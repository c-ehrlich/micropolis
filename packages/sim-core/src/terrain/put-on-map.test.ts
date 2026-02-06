import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import { indexFor } from './helpers.ts';
import { putOnMap } from './put-on-map.ts';

describe('terrain PutOnMap overwrite rules', () => {
  it('treats Mchar=0 as a no-op (does not clear the target tile)', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);
    map.fill(Tile.DIRT);

    // 1:1 port target: `PutOnMap(Mchar, Xoff, Yoff)` in
    // `ref/micropolis/src/sim/s_gen.c`.
    //
    // In C, `PutOnMap` begins with:
    //
    //   if (Mchar == 0) return;
    //
    // This matters because the river "plop" matrices contain zeros for cells
    // that should not write anything.
    const mapX = 10;
    const mapY = 20;
    map[indexFor(mapX, mapY)] = Tile.RIVER;

    putOnMap(map, mapX, mapY, 0, 0, 0);

    expect(map[indexFor(mapX, mapY)]).toBe(Tile.RIVER);
  });

  it('ignores writes that land outside world bounds', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);
    map.fill(Tile.DIRT);

    // 1:1 port target: `PutOnMap` in `ref/micropolis/src/sim/s_gen.c` calls
    // `TestBounds(Xloc, Yloc)` and returns without writing if out of bounds.
    //
    // Here we choose a cursor at the top-left corner and a negative offset so
    // the final location is (-1, 0), which is outside the classic
    // [0..119]x[0..99] Micropolis world.
    const mapX = 0;
    const mapY = 0;
    putOnMap(map, mapX, mapY, Tile.RIVER, -1, 0);

    // Nothing should have been written; the origin remains DIRT.
    expect(map[indexFor(0, 0)]).toBe(Tile.DIRT);
  });

  it('allows CHANNEL to overwrite RIVER, but prevents other tiles from overwriting RIVER', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);
    map.fill(Tile.DIRT);

    const mapX = 5;
    const mapY = 6;
    const targetIndex = indexFor(mapX, mapY);

    // We intentionally add a status bit to prove the overwrite check uses
    // `(temp & LOMASK)` like the C code does:
    //
    //   temp = temp & LOMASK;
    //   if (temp == RIVER) if (Mchar != CHANNEL) return;
    //
    // Magic numbers:
    // - `LOMASK` is 1023 (0x03ff), the low 10-bit tile ID mask.
    // - `BULLBIT` is 4096 (0x1000), a status flag in the high bits.
    // Both are specified in `ref/micropolis/spec/terrain/SPEC.md`.
    const riverWithFlags = Tile.RIVER | TileFlag.BULLBIT;
    expect(riverWithFlags & TileMask.LOMASK).toBe(Tile.RIVER);
    map[targetIndex] = riverWithFlags;

    // Non-channel tiles must not overwrite existing river.
    putOnMap(map, mapX, mapY, Tile.REDGE, 0, 0);
    expect(map[targetIndex]).toBe(riverWithFlags);

    // CHANNEL is the special case that *can* overwrite river.
    putOnMap(map, mapX, mapY, Tile.CHANNEL, 0, 0);
    expect(map[targetIndex]).toBe(Tile.CHANNEL);
  });

  it('prevents overwriting CHANNEL with any tile (including CHANNEL itself)', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);
    map.fill(Tile.DIRT);

    const mapX = 8;
    const mapY = 9;
    const targetIndex = indexFor(mapX, mapY);

    // Again include a status bit to ensure the CHANNEL check is masked with
    // `LOMASK` just like the C code.
    const channelWithFlags = Tile.CHANNEL | TileFlag.BURNBIT;
    expect(channelWithFlags & TileMask.LOMASK).toBe(Tile.CHANNEL);
    map[targetIndex] = channelWithFlags;

    // C:
    //   if (temp == CHANNEL) return;
    putOnMap(map, mapX, mapY, Tile.RIVER, 0, 0);
    expect(map[targetIndex]).toBe(channelWithFlags);

    putOnMap(map, mapX, mapY, Tile.CHANNEL, 0, 0);
    expect(map[targetIndex]).toBe(channelWithFlags);
  });
});
