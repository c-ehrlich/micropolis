import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, TileMask } from '../../../../../packages/sim-core/src/core/constants.ts';
import {
  DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
  FUTURE_USA_TILE_ATLAS_DEFAULT_CANONICAL_IDENTITY_KEY,
  getTileAtlasSourceByCanonicalIdentityKey,
  isDebugTileRendererEnabled,
  lookupTileSprite,
  lookupTileSpriteRectByTileId,
  lookupTileSpriteRectByTileName,
  resolveMicropolisTileSheetCanonicalIdentityKey,
  resolveRuntimeTilesetBaseAtlasCanonicalIdentityKey,
  resolveTileIdByName,
  resolveTileNameById,
  TILE_ATLAS_CANONICAL_IDENTITY_KEYS,
} from './tile-sprite-atlas.ts';

describe('tile sprite atlas', () => {
  it('resolves deterministic atlas metadata from canonical GetViewTiles image keys', () => {
    const atlas = getTileAtlasSourceByCanonicalIdentityKey(
      DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
    );
    const editorMonochromeKey = resolveMicropolisTileSheetCanonicalIdentityKey({
      viewClass: 'editor',
      color: false,
    });
    const mapColorKey = resolveMicropolisTileSheetCanonicalIdentityKey({
      viewClass: 'map',
      color: true,
    });
    const editorMonochromeAtlas =
      editorMonochromeKey === undefined
        ? undefined
        : getTileAtlasSourceByCanonicalIdentityKey(editorMonochromeKey);
    const mapColorAtlas =
      mapColorKey === undefined ? undefined : getTileAtlasSourceByCanonicalIdentityKey(mapColorKey);

    expect(TILE_ATLAS_CANONICAL_IDENTITY_KEYS).toEqual([
      'ref/micropolis/images/tiles.xpm',
      'ref/micropolis/images/tilesbw.xpm',
      'ref/micropolis/images/tilessm.xpm',
      'ref/micropolis/images/tiles-futureusa.xpm',
    ]);
    expect(atlas).toBeDefined();
    expect(atlas?.canonicalIdentityKey).toBe(DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY);
    expect(atlas?.derivedPngPath).toBe('packages/sim-assets/generated-images/images/tiles.png');
    expect(atlas?.tileWidth).toBe(16);
    expect(atlas?.tileHeight).toBe(16);
    expect(editorMonochromeAtlas?.canonicalIdentityKey).toBe('ref/micropolis/images/tilesbw.xpm');
    expect(editorMonochromeAtlas?.derivedPngPath).toBe(
      'packages/sim-assets/generated-images/images/tilesbw.png',
    );
    // `TILE_SHEET_HEADERS.monochrome` is `"16 15360 2 1"` in `packages/sim-assets/src/tiles.ts`.
    expect(editorMonochromeAtlas?.tileWidth).toBe(16);
    expect(editorMonochromeAtlas?.tileHeight).toBe(16);
    expect(mapColorAtlas?.canonicalIdentityKey).toBe('ref/micropolis/images/tilessm.xpm');
    expect(mapColorAtlas?.derivedPngPath).toBe(
      'packages/sim-assets/generated-images/images/tilessm.png',
    );
    // `TILE_SHEET_HEADERS.small` is `"4 2880 14 1"` in `packages/sim-assets/src/tiles.ts`.
    expect(mapColorAtlas?.tileWidth).toBe(4);
    expect(mapColorAtlas?.tileHeight).toBe(3);
    // Source: `#define TILE_COUNT 960` in `ref/micropolis/src/sim/headers/sim.h`.
    expect(atlas?.tileCount).toBe(Tile.TILE_COUNT);
    expect(editorMonochromeAtlas?.tileCount).toBe(Tile.TILE_COUNT);
    expect(mapColorAtlas?.tileCount).toBe(Tile.TILE_COUNT);
  });

  it('resolves MicropolisCore Future USA atlas metadata through static adapter path', () => {
    const atlas = getTileAtlasSourceByCanonicalIdentityKey(
      FUTURE_USA_TILE_ATLAS_DEFAULT_CANONICAL_IDENTITY_KEY,
    );

    expect(atlas?.canonicalIdentityKey).toBe('ref/micropolis/images/tiles-futureusa.xpm');
    expect(atlas?.derivedPngPath).toBe(
      'packages/sim-assets/micropoliscore-tilesets/futureusa/tiles.png',
    );
    // `resources/tilesets/futureusa/tiles.bmp` in MicropolisCore is 512x480.
    expect(atlas?.tileWidth).toBe(16);
    expect(atlas?.tileHeight).toBe(16);
    // Source: `#define TILE_COUNT 960` in `ref/micropolis/src/sim/headers/sim.h`.
    expect(atlas?.tileCount).toBe(Tile.TILE_COUNT);
  });

  it('maps authoritative tile words to deterministic atlas rects with LOMASK parity', () => {
    // `MemDrawBeegMapRect` in `g_bigmap.c` applies `(tile & LOMASK)` and wraps
    // ids in `[TILE_COUNT, 1023]` by subtracting `TILE_COUNT`.
    const wrapped = lookupTileSprite(Tile.TILE_COUNT + 7);
    expect(wrapped.tileId).toBe(7);
    expect(wrapped.sourceX).toBe(0);
    // Each tile is 16px high in `tiles.xpm` loaded by `GetViewTiles` (`g_setup.c`).
    expect(wrapped.sourceY).toBe(7 * 16);
    expect(wrapped.sourceWidth).toBe(16);
    expect(wrapped.sourceHeight).toBe(16);
  });

  it('maps tile ids to deterministic atlas rects with LOMASK masking parity', () => {
    // `g_bigmap.c` draw path masks tile words with `LOMASK`, then wraps
    // `[TILE_COUNT, 1023]` into the base page before graphics lookup.
    const base = lookupTileSpriteRectByTileId(Tile.ROADBASE + 5);
    const flagged = lookupTileSpriteRectByTileId(
      Tile.ROADBASE + 5 + TileFlag.BULLBIT + TileFlag.ANIMBIT,
    );
    const wrapped = lookupTileSpriteRectByTileId(Tile.TILE_COUNT + 13);

    expect(flagged.tileId).toBe(base.tileId);
    expect(flagged.sourceY).toBe(base.sourceY);
    expect(wrapped.tileId).toBe(13);
    expect(wrapped.sourceY).toBe(13 * 16);
  });

  it('maps tile ids with MicropolisCore grid atlas adapter coordinates', () => {
    const sprite = lookupTileSpriteRectByTileId(33, {
      atlasCanonicalIdentityKey: FUTURE_USA_TILE_ATLAS_DEFAULT_CANONICAL_IDENTITY_KEY,
    });

    expect(sprite.tileId).toBe(33);
    // MicropolisCore `tiles.bmp` is 512px wide with 16px tiles -> 32 columns.
    expect(sprite.sourceX).toBe(16);
    expect(sprite.sourceY).toBe(16);
    expect(sprite.sourceWidth).toBe(16);
    expect(sprite.sourceHeight).toBe(16);
  });

  it('wraps masked top-of-page ids exactly like g_bigmap lookup normalization', () => {
    // Sources:
    // - `#define LOMASK 0x3ff` and `#define TILE_COUNT 960` in
    //   `ref/micropolis/src/sim/headers/sim.h`
    // - draw-time `(tile & LOMASK)` + `if (tile >= TILE_COUNT) tile -= TILE_COUNT;`
    //   in `ref/micropolis/src/sim/g_bigmap.c`
    const wrappedTop = lookupTileSpriteRectByTileId(TileMask.LOMASK);
    const wrappedFromFullWord = lookupTileSpriteRectByTileId(0xffff);
    const expectedWrappedTileId = TileMask.LOMASK - Tile.TILE_COUNT;

    expect(wrappedTop.tileId).toBe(expectedWrappedTileId);
    expect(wrappedTop.sourceY).toBe(expectedWrappedTileId * 16);
    expect(wrappedFromFullWord.tileId).toBe(expectedWrappedTileId);
    expect(wrappedFromFullWord.sourceY).toBe(expectedWrappedTileId * 16);
  });

  it('uses canonical atlas identity key to select sprite dimensions deterministically', () => {
    // `GetViewTiles` map-class color branch in `g_setup.c` reads `tilessm.xpm`.
    const mapColorKey = resolveMicropolisTileSheetCanonicalIdentityKey({
      viewClass: 'map',
      color: true,
    });
    if (mapColorKey === undefined) {
      throw new Error('Expected map color atlas canonical key');
    }

    const sprite = lookupTileSprite(Tile.TILE_COUNT + 7, {
      atlasCanonicalIdentityKey: mapColorKey,
    });

    expect(sprite.atlasCanonicalIdentityKey).toBe(mapColorKey);
    expect(sprite.tileId).toBe(7);
    // `GetViewTiles` in `ref/micropolis/src/sim/g_setup.c` documents map-class
    // tiles as "4 pixels wide per 3 pixel wide tile" (4th column is spacing).
    expect(sprite.sourceWidth).toBe(3);
    expect(sprite.sourceHeight).toBe(3);
    expect(sprite.sourceY).toBe(7 * 3);
  });

  it('ignores high tile flags when selecting sprite rects', () => {
    const plain = lookupTileSprite(Tile.FIRE + 1);
    // `g_ani.c` animation writes preserve high bits (`aniTile[id] | tileflags`);
    // draw path still masks to low tile id before graphic lookup.
    const flagged = lookupTileSprite(Tile.FIRE + 1 + TileFlag.ANIMBIT + TileFlag.BULLBIT);

    expect(flagged.tileId).toBe(plain.tileId);
    expect(flagged.sourceY).toBe(plain.sourceY);
  });

  it('applies g_bigmap blink-time LIGHTNINGBOLT substitution for unpowered zone centers', () => {
    // Sources:
    // - `if (blink && (tile & ZONEBIT) && !(tile & PWRBIT)) tile = LIGHTNINGBOLT;`
    //   in `ref/micropolis/src/sim/g_bigmap.c`
    // - `#define LIGHTNINGBOLT 827` in `ref/micropolis/src/sim/headers/sim.h`
    const unpoweredZoneWord = Tile.RESBASE | TileFlag.ZONEBIT;

    const nonBlink = lookupTileSprite(unpoweredZoneWord);
    const blink = lookupTileSprite(unpoweredZoneWord, {
      blinkUnpoweredZoneCenter: true,
    });
    const powered = lookupTileSprite(unpoweredZoneWord | TileFlag.PWRBIT, {
      blinkUnpoweredZoneCenter: true,
    });

    expect(nonBlink.tileId).toBe(Tile.RESBASE);
    expect(blink.tileId).toBe(Tile.LIGHTNINGBOLT);
    expect(powered.tileId).toBe(Tile.RESBASE);
  });

  it('parses explicit debug-renderer feature flag values only', () => {
    expect(isDebugTileRendererEnabled({})).toBe(false);
    expect(isDebugTileRendererEnabled({ VITE_DEBUG_TILE_RENDERER: '0' })).toBe(false);
    expect(isDebugTileRendererEnabled({ VITE_DEBUG_TILE_RENDERER: '1' })).toBe(true);
    expect(isDebugTileRendererEnabled({ VITE_DEBUG_TILE_RENDERER: 'true' })).toBe(true);
  });

  it('mirrors GetViewTiles image identity selection by view class and color mode', () => {
    // `GetViewTiles` in `g_setup.c` picks `tiles.xpm` for Editor_Class color.
    expect(
      resolveMicropolisTileSheetCanonicalIdentityKey({ viewClass: 'editor', color: true }),
    ).toBe('ref/micropolis/images/tiles.xpm');
    // `GetViewTiles` in `g_setup.c` picks `tilesbw.xpm` for Editor_Class monochrome.
    expect(
      resolveMicropolisTileSheetCanonicalIdentityKey({ viewClass: 'editor', color: false }),
    ).toBe('ref/micropolis/images/tilesbw.xpm');
    // `GetViewTiles` in `g_setup.c` picks `tilessm.xpm` for Map_Class color.
    expect(resolveMicropolisTileSheetCanonicalIdentityKey({ viewClass: 'map', color: true })).toBe(
      'ref/micropolis/images/tilessm.xpm',
    );
    // Map_Class monochrome path uses `MickGetHexa(SIM_GSMTILE)` (not an XPM file key).
    expect(
      resolveMicropolisTileSheetCanonicalIdentityKey({ viewClass: 'map', color: false }),
    ).toBeUndefined();
  });

  it('resolves runtime tileset names to adapter-backed base atlas identities', () => {
    expect(resolveRuntimeTilesetBaseAtlasCanonicalIdentityKey('classic')).toBe(
      DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
    );
    expect(resolveRuntimeTilesetBaseAtlasCanonicalIdentityKey('futureusa')).toBe(
      FUTURE_USA_TILE_ATLAS_DEFAULT_CANONICAL_IDENTITY_KEY,
    );
  });

  it('supports adapter tile-name lookup and tile-name sprite queries', () => {
    // Sources:
    // - `#define ROADBASE 64` in `ref/micropolis/src/sim/headers/sim.h`
    // - draw path in `g_bigmap.c` resolves source row from normalized tile id.
    expect(resolveTileIdByName('roadbase')).toBe(Tile.ROADBASE);
    expect(resolveTileNameById(Tile.ROADBASE)).toBe('ROADBASE');

    const byName = lookupTileSpriteRectByTileName('ROADBASE');
    expect(byName?.tileId).toBe(Tile.ROADBASE);
    expect(byName?.sourceY).toBe(Tile.ROADBASE * 16);
    expect(lookupTileSpriteRectByTileName('missing-tile-name')).toBeUndefined();
  });
});
