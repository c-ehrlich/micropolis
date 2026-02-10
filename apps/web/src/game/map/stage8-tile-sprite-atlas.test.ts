import { describe, expect, it } from 'vitest';

import { Tile, TileFlag } from '../../../../../packages/sim-core/src/core/constants.ts';
import {
  getStage8TileAtlasSourceByCanonicalIdentityKey,
  isStage4DebugTileRendererEnabled,
  lookupStage8TileSprite,
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

  it('parses explicit debug-renderer feature flag values only', () => {
    expect(isStage4DebugTileRendererEnabled({})).toBe(false);
    expect(isStage4DebugTileRendererEnabled({ VITE_STAGE4_DEBUG_TILE_RENDERER: '0' })).toBe(false);
    expect(isStage4DebugTileRendererEnabled({ VITE_STAGE4_DEBUG_TILE_RENDERER: '1' })).toBe(true);
    expect(isStage4DebugTileRendererEnabled({ VITE_STAGE4_DEBUG_TILE_RENDERER: 'true' })).toBe(
      true,
    );
  });
});
