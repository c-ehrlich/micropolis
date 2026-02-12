import { describe, expect, it } from 'vitest';

import { Tile, TileFlag } from '../../../../../packages/sim-core/src/core/constants.ts';
import { getTileDebugColor, toDrawTileId, toRenderableTileId } from './tile-renderer.ts';

describe('runtime tile renderer', () => {
  it('masks tile words with LOMASK and wraps ids above TILE_COUNT for lookup parity', () => {
    // `g_bigmap.c` uses `(tile & LOMASK)` and subtracts `TILE_COUNT` when that
    // masked id lands in the extra page `[TILE_COUNT, 1023]`.
    expect(toRenderableTileId(Tile.TILE_COUNT + 7)).toBe(7);
    expect(toRenderableTileId((Tile.TILE_COUNT + 12) | TileFlag.ANIMBIT)).toBe(12);
  });

  it('ignores high flag bits when mapping tile words to Authoritative Runtime debug colors', () => {
    const plainRoad = getTileDebugColor(Tile.ROADS);
    const flaggedRoad = getTileDebugColor(Tile.ROADS | TileFlag.BURNBIT | TileFlag.ANIMBIT);
    expect(flaggedRoad).toBe(plainRoad);
  });

  it('matches g_ani tile animation masking when ANIMBIT words retain high flags', () => {
    // `g_ani.c` rewrites animated tiles as `aniTile[id] | tileflags`.
    // In `ref/micropolis/src/sim/headers/animtab.h`, fire advances from 56 to 57.
    const animatedFireWord = (Tile.FIRE + 1) | TileFlag.ANIMBIT | TileFlag.BULLBIT;
    expect(toRenderableTileId(animatedFireWord)).toBe(Tile.FIRE + 1);
    expect(getTileDebugColor(animatedFireWord)).toBe(getTileDebugColor(Tile.FIRE + 1));
  });

  it('mirrors g_bigmap blink override to LIGHTNINGBOLT for unpowered zone centers', () => {
    // Sources:
    // - `if (blink && (tile & ZONEBIT) && !(tile & PWRBIT)) tile = LIGHTNINGBOLT;`
    //   in `ref/micropolis/src/sim/g_bigmap.c`
    // - `#define LIGHTNINGBOLT 827` in `ref/micropolis/src/sim/headers/sim.h`
    const unpoweredZoneWord = Tile.RESBASE | TileFlag.ZONEBIT;
    expect(toDrawTileId(unpoweredZoneWord)).toBe(Tile.RESBASE);
    expect(
      toDrawTileId(unpoweredZoneWord, {
        blinkUnpoweredZoneCenter: true,
      }),
    ).toBe(Tile.LIGHTNINGBOLT);
    expect(
      toDrawTileId(unpoweredZoneWord | TileFlag.PWRBIT, {
        blinkUnpoweredZoneCenter: true,
      }),
    ).toBe(Tile.RESBASE);
  });

  it('keeps core terrain classes visually distinct in debug rendering', () => {
    expect(getTileDebugColor(Tile.RIVER)).not.toBe(getTileDebugColor(Tile.DIRT));
    expect(getTileDebugColor(Tile.RESBASE)).not.toBe(getTileDebugColor(Tile.ROADS));
  });
});
