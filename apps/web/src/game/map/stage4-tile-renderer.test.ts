import { describe, expect, it } from 'vitest';

import { Tile, TileFlag } from '../../../../../packages/sim-core/src/core/constants.ts';
import { getStage4TileDebugColor, toStage4RenderableTileId } from './stage4-tile-renderer.ts';

describe('stage4 tile renderer', () => {
  it('masks tile words with LOMASK and wraps ids above TILE_COUNT for lookup parity', () => {
    // `g_bigmap.c` uses `(tile & LOMASK)` and subtracts `TILE_COUNT` when that
    // masked id lands in the extra page `[TILE_COUNT, 1023]`.
    expect(toStage4RenderableTileId(Tile.TILE_COUNT + 7)).toBe(7);
    expect(toStage4RenderableTileId((Tile.TILE_COUNT + 12) | TileFlag.ANIMBIT)).toBe(12);
  });

  it('ignores high flag bits when mapping tile words to Stage 4 debug colors', () => {
    const plainRoad = getStage4TileDebugColor(Tile.ROADS);
    const flaggedRoad = getStage4TileDebugColor(Tile.ROADS | TileFlag.BURNBIT | TileFlag.ANIMBIT);
    expect(flaggedRoad).toBe(plainRoad);
  });

  it('keeps core terrain classes visually distinct in debug rendering', () => {
    expect(getStage4TileDebugColor(Tile.RIVER)).not.toBe(getStage4TileDebugColor(Tile.DIRT));
    expect(getStage4TileDebugColor(Tile.RESBASE)).not.toBe(getStage4TileDebugColor(Tile.ROADS));
  });
});
