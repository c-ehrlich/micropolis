import { describe, expect, it } from 'vitest';

import { Tile, World } from '../core/constants.ts';
import { indexFor } from './helpers.ts';
import { bRivPlop, sRivPlop } from './river-plops.ts';

describe('terrain river plop matrices', () => {
  it('bRivPlop applies the 9x9 BRMatrix via PutOnMap offsets', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);
    const mapX = 10;
    const mapY = 10;

    // 1:1 port target: `BRivPlop()` in `ref/micropolis/src/sim/s_gen.c`.
    //
    // The C code applies BRMatrix with:
    //   PutOnMap(BRMatrix[y][x], x, y);
    //
    // Magic numbers (from `ref/micropolis/spec/terrain/SPEC.md`):
    // - `RIVER` tile ID is 2.
    // - `REDGE` tile ID is 3.
    // - `CHANNEL` tile ID is 4.
    //
    // `PutOnMap` has a special-case early return when `Mchar == 0` (see
    // `ref/micropolis/src/sim/s_gen.c`). To make that behavior observable, we
    // pre-fill a known `0`-cell in the matrix with a non-zero tile and assert
    // it remains unchanged.
    map[indexFor(mapX + 0, mapY + 0)] = Tile.WOODS;
    bRivPlop(map, mapX, mapY);

    // Corners are 0 in the matrix (no-op in PutOnMap), so they do not overwrite.
    expect(map[indexFor(mapX + 0, mapY + 0)]).toBe(Tile.WOODS);

    // Top row has `3` at x=3..5.
    expect(map[indexFor(mapX + 3, mapY + 0)]).toBe(Tile.REDGE);
    expect(map[indexFor(mapX + 4, mapY + 0)]).toBe(Tile.REDGE);
    expect(map[indexFor(mapX + 5, mapY + 0)]).toBe(Tile.REDGE);

    // The interior includes `2` (river) and a single `4` (channel) at [4][4].
    expect(map[indexFor(mapX + 4, mapY + 1)]).toBe(Tile.RIVER);
    expect(map[indexFor(mapX + 4, mapY + 4)]).toBe(Tile.CHANNEL);

    // Left edge at y=3 is `3` in the matrix.
    expect(map[indexFor(mapX + 0, mapY + 3)]).toBe(Tile.REDGE);
  });

  it('sRivPlop applies the 6x6 SRMatrix via PutOnMap offsets', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);
    const mapX = 20;
    const mapY = 15;

    // 1:1 port target: `SRivPlop()` in `ref/micropolis/src/sim/s_gen.c`.
    //
    // The C code applies SRMatrix with:
    //   PutOnMap(SRMatrix[y][x], x, y);
    // As above, pre-fill a `0`-cell to verify `Mchar == 0` is a no-op.
    map[indexFor(mapX + 0, mapY + 0)] = Tile.WOODS;
    sRivPlop(map, mapX, mapY);

    // Corner is 0 in the matrix (no-op), so it does not overwrite.
    expect(map[indexFor(mapX + 0, mapY + 0)]).toBe(Tile.WOODS);

    // Top row has `3` at x=2..3.
    expect(map[indexFor(mapX + 2, mapY + 0)]).toBe(Tile.REDGE);
    expect(map[indexFor(mapX + 3, mapY + 0)]).toBe(Tile.REDGE);

    // Interior is `2` (river) for the central 4x4 region.
    expect(map[indexFor(mapX + 2, mapY + 2)]).toBe(Tile.RIVER);
    expect(map[indexFor(mapX + 3, mapY + 3)]).toBe(Tile.RIVER);

    // Left side at y=2 is `3` (redge).
    expect(map[indexFor(mapX + 0, mapY + 2)]).toBe(Tile.REDGE);
  });
});
