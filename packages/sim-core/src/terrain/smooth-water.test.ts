import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, World } from '../core/constants.ts';
import { indexFor } from './helpers.ts';
import { smoothWater, smoothWaterPass3 } from './smooth-water.ts';

/**
 * Water smoothing (`SmoothWater`) performs 3 sequential passes over the map.
 *
 * Source of truth:
 * - `SmoothWater()` in `ref/micropolis/src/sim/s_gen.c`
 * - `ref/micropolis/spec/terrain/SPEC.md` ("SmoothWater(), SmoothRiver(), SmoothTrees(), SmoothWater()")
 *
 * "Magic numbers" asserted here come directly from Micropolis tile IDs:
 * - `WATER_LOW = Tile.RIVER (2)`
 * - `WATER_HIGH = Tile.LASTRIVEDGE (20)`
 * - `WOODS_LOW = Tile.TREEBASE (21)`
 * - `WOODS_HIGH = UNUSED_TRASH2 (39)` (not a named constant in sim-core)
 *
 * The important parity detail is that `SmoothWater` uses masked comparisons for
 * range checks (`tile & LOMASK`) but raw equality checks for the "woods next to
 * exact RIVER/CHANNEL" conversion in pass 3.
 */
describe('terrain SmoothWater', () => {
  it('pass 1: converts water next to non-water into REDGE', () => {
    // C condition: if Map[x][y] is in [WATER_LOW..WATER_HIGH] and any in-bounds
    // 4-neighbor is outside that range, set Map[x][y] = REDGE (3).
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(Tile.DIRT);

    const x = 10;
    const y = 10;
    map[indexFor(x, y)] = Tile.RIVER; // in water range (2..20)

    // Left neighbor remains DIRT (0), which is outside water range => edge.
    smoothWater(map);

    expect(map[indexFor(x, y)]).toBe(Tile.REDGE);
  });

  it('pass 2: converts interior non-channel water into RIVER when all 4-neighbors are water', () => {
    // C condition: if Map[x][y] is water (2..20) and (tileId != CHANNEL),
    // and all in-bounds neighbors are also water, set Map[x][y] = RIVER (2).
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(Tile.DIRT);

    const x = 30;
    const y = 30;
    map[indexFor(x, y)] = Tile.REDGE; // still in water range (2..20), not CHANNEL

    map[indexFor(x - 1, y)] = Tile.RIVER;
    map[indexFor(x + 1, y)] = Tile.RIVER;
    map[indexFor(x, y - 1)] = Tile.RIVER;
    map[indexFor(x, y + 1)] = Tile.RIVER;

    smoothWater(map);

    expect(map[indexFor(x, y)]).toBe(Tile.RIVER);
  });

  it('pass 3: converts woods-range tiles adjacent to exact RIVER or CHANNEL into REDGE', () => {
    // C condition: if Map[x][y] is in woods range (masked id in 21..39),
    // and any neighbor is exactly `RIVER` (2) or `CHANNEL` (4) by raw equality,
    // set Map[x][y] = REDGE (3).
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(Tile.DIRT);

    const x = 50;
    const y = 50;

    // Use flagged woods to prove the woods-range check is masked (status bits ignored).
    map[indexFor(x, y)] = Tile.WOODS + TileFlag.BLBNBIT; // tileId 37, flags set
    map[indexFor(x + 1, y)] = Tile.RIVER; // exact raw equality required

    // Note: In the full `SmoothWater()` function, pass 1 would first convert
    // any water tile adjacent to non-water into `REDGE`, which would turn this
    // neighbor from `RIVER` into `REDGE` before pass 3 runs.
    //
    // We validate the pass-3 logic directly via this extracted 1:1 helper,
    // which is the third loop of `SmoothWater()` in `s_gen.c`.
    smoothWaterPass3(map);

    // C writes a bare `REDGE` (no status bits) here.
    expect(map[indexFor(x, y)]).toBe(Tile.REDGE);
  });
});
