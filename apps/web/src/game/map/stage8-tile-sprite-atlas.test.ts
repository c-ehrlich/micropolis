import { describe, expect, it } from 'vitest';

import { Tile, TileFlag } from '../../../../../packages/sim-core/src/core/constants.ts';
import {
  getStage8TileAtlasSourceByCanonicalIdentityKey,
  isStage4DebugTileRendererEnabled,
  lookupStage8TileSprite,
  resolveStage8MicropolisTileSheetCanonicalIdentityKey,
  STAGE8_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
} from './stage8-tile-sprite-atlas.ts';

describe('stage8 tile sprite atlas', () => {
  it('resolves deterministic atlas metadata from canonical tiles.xpm identity', () => {
    const atlas = getStage8TileAtlasSourceByCanonicalIdentityKey(
      STAGE8_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
    );

    expect(atlas).toBeDefined();
    expect(atlas?.canonicalIdentityKey).toBe(STAGE8_TILE_ATLAS_CANONICAL_IDENTITY_KEY);
    expect(atlas?.derivedPngPath).toBe('packages/sim-assets/generated-images/images/tiles.png');
    expect(atlas?.tileWidth).toBe(16);
    expect(atlas?.tileHeight).toBe(16);
    // Source: `#define TILE_COUNT 960` in `ref/micropolis/src/sim/headers/sim.h`.
    expect(atlas?.tileCount).toBe(Tile.TILE_COUNT);
  });

  it('maps authoritative tile words to deterministic atlas rects with LOMASK parity', () => {
    // `MemDrawBeegMapRect` in `g_bigmap.c` applies `(tile & LOMASK)` and wraps
    // ids in `[TILE_COUNT, 1023]` by subtracting `TILE_COUNT`.
    const wrapped = lookupStage8TileSprite(Tile.TILE_COUNT + 7);
    expect(wrapped.tileId).toBe(7);
    expect(wrapped.sourceX).toBe(0);
    // Each tile is 16px high in `tiles.xpm` loaded by `GetViewTiles` (`g_setup.c`).
    expect(wrapped.sourceY).toBe(7 * 16);
    expect(wrapped.sourceWidth).toBe(16);
    expect(wrapped.sourceHeight).toBe(16);
  });

  it('ignores high tile flags when selecting sprite rects', () => {
    const plain = lookupStage8TileSprite(Tile.FIRE + 1);
    // `g_ani.c` animation writes preserve high bits (`aniTile[id] | tileflags`);
    // draw path still masks to low tile id before graphic lookup.
    const flagged = lookupStage8TileSprite(Tile.FIRE + 1 + TileFlag.ANIMBIT + TileFlag.BULLBIT);

    expect(flagged.tileId).toBe(plain.tileId);
    expect(flagged.sourceY).toBe(plain.sourceY);
  });

  it('applies g_bigmap blink-time LIGHTNINGBOLT substitution for unpowered zone centers', () => {
    // Sources:
    // - `if (blink && (tile & ZONEBIT) && !(tile & PWRBIT)) tile = LIGHTNINGBOLT;`
    //   in `ref/micropolis/src/sim/g_bigmap.c`
    // - `#define LIGHTNINGBOLT 827` in `ref/micropolis/src/sim/headers/sim.h`
    const unpoweredZoneWord = Tile.RESBASE | TileFlag.ZONEBIT;

    const nonBlink = lookupStage8TileSprite(unpoweredZoneWord);
    const blink = lookupStage8TileSprite(unpoweredZoneWord, {
      blinkUnpoweredZoneCenter: true,
    });
    const powered = lookupStage8TileSprite(unpoweredZoneWord | TileFlag.PWRBIT, {
      blinkUnpoweredZoneCenter: true,
    });

    expect(nonBlink.tileId).toBe(Tile.RESBASE);
    expect(blink.tileId).toBe(Tile.LIGHTNINGBOLT);
    expect(powered.tileId).toBe(Tile.RESBASE);
  });

  it('parses explicit debug-renderer feature flag values only', () => {
    expect(isStage4DebugTileRendererEnabled({})).toBe(false);
    expect(isStage4DebugTileRendererEnabled({ VITE_STAGE4_DEBUG_TILE_RENDERER: '0' })).toBe(false);
    expect(isStage4DebugTileRendererEnabled({ VITE_STAGE4_DEBUG_TILE_RENDERER: '1' })).toBe(true);
    expect(isStage4DebugTileRendererEnabled({ VITE_STAGE4_DEBUG_TILE_RENDERER: 'true' })).toBe(
      true,
    );
  });

  it('mirrors GetViewTiles image identity selection by view class and color mode', () => {
    // `GetViewTiles` in `g_setup.c` picks `tiles.xpm` for Editor_Class color.
    expect(
      resolveStage8MicropolisTileSheetCanonicalIdentityKey({ viewClass: 'editor', color: true }),
    ).toBe('ref/micropolis/images/tiles.xpm');
    // `GetViewTiles` in `g_setup.c` picks `tilesbw.xpm` for Editor_Class monochrome.
    expect(
      resolveStage8MicropolisTileSheetCanonicalIdentityKey({ viewClass: 'editor', color: false }),
    ).toBe('ref/micropolis/images/tilesbw.xpm');
    // `GetViewTiles` in `g_setup.c` picks `tilessm.xpm` for Map_Class color.
    expect(
      resolveStage8MicropolisTileSheetCanonicalIdentityKey({ viewClass: 'map', color: true }),
    ).toBe('ref/micropolis/images/tilessm.xpm');
    // Map_Class monochrome path uses `MickGetHexa(SIM_GSMTILE)` (not an XPM file key).
    expect(
      resolveStage8MicropolisTileSheetCanonicalIdentityKey({ viewClass: 'map', color: false }),
    ).toBeUndefined();
  });
});
