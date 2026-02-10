import { describe, expect, it } from 'vitest';

import { PowerMap, Tile, TileFlag, TileMask, World } from './constants.ts';

describe('sim.h constant parity', () => {
  it('matches world and power-map layout macros', () => {
    // Source: `ref/micropolis/src/sim/headers/sim.h`
    // - `#define WORLD_X SimWidth` where `SimWidth` is `120`
    // - `#define WORLD_Y SimHeight` where `SimHeight` is `100`
    // - `#define POWERMAPROW ((WORLD_X + 15) / 16)` => 8
    // - `#define PWRMAPSIZE (POWERMAPROW * WORLD_Y)` => 800
    // - `#define POWERMAPLEN 1700` (non-MEGA build)
    // - `#define PWRSTKSIZE ((WORLD_X * WORLD_Y) / 4)` => 3000
    expect(World.WORLD_X).toBe(120);
    expect(World.WORLD_Y).toBe(100);
    expect(PowerMap.POWERMAPROW).toBe(8);
    expect(PowerMap.PWRMAPSIZE).toBe(800);
    expect(PowerMap.POWERMAPLEN).toBe(1700);
    expect(PowerMap.PWRSTKSIZE).toBe(3000);
  });

  it('matches tile-word mask and status-bit macros', () => {
    // Source: `ref/micropolis/src/sim/headers/sim.h`
    // - `#define LOMASK 1023` and `#define ALLBITS 64512`
    // - `#define PWRBIT 32768`, `CONDBIT 16384`, `BURNBIT 8192`,
    //   `BULLBIT 4096`, `ANIMBIT 2048`, `ZONEBIT 1024`
    expect(TileMask.LOMASK).toBe(1023);
    expect(TileMask.ALLBITS).toBe(64512);
    expect(TileFlag.PWRBIT).toBe(32768);
    expect(TileFlag.CONDBIT).toBe(16384);
    expect(TileFlag.BURNBIT).toBe(8192);
    expect(TileFlag.BULLBIT).toBe(4096);
    expect(TileFlag.ANIMBIT).toBe(2048);
    expect(TileFlag.ZONEBIT).toBe(1024);
  });

  it('matches representative tile-id layout boundaries used by Stage 8', () => {
    // Source: `ref/micropolis/src/sim/headers/sim.h`
    // - `#define ROADBASE 64`
    // - `#define POWERBASE 208`
    // - `#define RAILBASE 224`
    // - `#define RESBASE 240`
    // - `#define LASTZONE 826`
    // - `#define LIGHTNINGBOLT 827`
    // - `#define TILE_COUNT 960`
    expect(Tile.ROADBASE).toBe(64);
    expect(Tile.POWERBASE).toBe(208);
    expect(Tile.RAILBASE).toBe(224);
    expect(Tile.RESBASE).toBe(240);
    expect(Tile.LASTZONE).toBe(826);
    expect(Tile.LIGHTNINGBOLT).toBe(827);
    expect(Tile.TILE_COUNT).toBe(960);
  });
});
