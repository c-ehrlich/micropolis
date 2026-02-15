import { transcodeScenarioMapCityFileBytesV1 } from '@city/scenario-core';
import { describe, expect, test } from 'vitest';

import {
  fillScenarioEditorMapTileWord,
  getScenarioEditorMapIndex,
  normalizeScenarioEditorTileWord,
  readScenarioEditorMapTileWord,
  writeScenarioEditorMapTileWord,
} from './editor-map.ts';
import { createScenarioEditorInitialBundle } from './editor-state.tsx';

/**
 * Stage 3.3 map helper tests.
 * Parity anchors:
 * - Coordinate/index mapping follows `Map[x][y]` column-major storage from `s_alloc.c`.
 * - Tile writes/fills follow `SimCmdTile`/`SimCmdFill` loops from `w_sim.c`.
 */
describe('scenario editor map helpers', () => {
  test('maps x/y coordinates to x-major linear indices', () => {
    // Magic number source: `WORLD_Y=100` from `ref/micropolis/src/sim/headers/sim.h`,
    // with `Map[i] = auxPtr + i * WORLD_Y` in `ref/micropolis/src/sim/s_alloc.c`.
    expect(getScenarioEditorMapIndex({ x: 0, y: 0 })).toBe(0);
    expect(getScenarioEditorMapIndex({ x: 0, y: 1 })).toBe(1);
    expect(getScenarioEditorMapIndex({ x: 1, y: 0 })).toBe(100);
    expect(getScenarioEditorMapIndex({ x: 119, y: 99 })).toBe(11999);
  });

  test('rejects out-of-bounds coordinates for map index lookups', () => {
    expect(getScenarioEditorMapIndex({ x: -1, y: 0 })).toBeNull();
    expect(getScenarioEditorMapIndex({ x: 120, y: 0 })).toBeNull();
    expect(getScenarioEditorMapIndex({ x: 0, y: -1 })).toBeNull();
    expect(getScenarioEditorMapIndex({ x: 0, y: 100 })).toBeNull();
  });

  test('writes a single tile word at the requested x/y coordinate', () => {
    const bundle = createScenarioEditorInitialBundle();
    const nextBundle = writeScenarioEditorMapTileWord(bundle, { x: 4, y: 7 }, 321);

    expect(nextBundle).not.toBe(bundle);
    expect(readScenarioEditorMapTileWord(nextBundle, { x: 4, y: 7 })).toBe(321);
    expect(readScenarioEditorMapTileWord(nextBundle, { x: 4, y: 8 })).toBe(0);
  });

  test('normalizes tile writes to lower 16 bits like C short assignment', () => {
    // Magic number source: `Map[x][y]` is `short` in `ref/micropolis/src/sim/headers/sim.h`,
    // and `SimCmdTile` writes `Map[x][y] = tile` in `ref/micropolis/src/sim/w_sim.c`.
    expect(normalizeScenarioEditorTileWord(70000)).toBe(4464);
    expect(normalizeScenarioEditorTileWord(-1)).toBe(65535);
  });

  test('keeps bundle unchanged on out-of-bounds tile writes', () => {
    const bundle = createScenarioEditorInitialBundle();
    const nextBundle = writeScenarioEditorMapTileWord(bundle, { x: 120, y: 99 }, 5);

    expect(nextBundle).toBe(bundle);
  });

  test('supports editing bundles currently stored as city-file-bytes', () => {
    const bundle = createScenarioEditorInitialBundle();
    const cityFileBundle = {
      ...bundle,
      map: transcodeScenarioMapCityFileBytesV1(bundle.map),
    };

    const nextBundle = writeScenarioEditorMapTileWord(cityFileBundle, { x: 2, y: 3 }, 55);

    expect(nextBundle.map.kind).toBe('tile-words');
    expect(readScenarioEditorMapTileWord(nextBundle, { x: 2, y: 3 })).toBe(55);
  });

  test('fills the full map with one tile word', () => {
    const bundle = createScenarioEditorInitialBundle();
    const nextBundle = fillScenarioEditorMapTileWord(bundle, 2);

    expect(nextBundle).not.toBe(bundle);
    expect(nextBundle.map.kind).toBe('tile-words');
    if (nextBundle.map.kind !== 'tile-words') {
      throw new Error('Expected tile-words map payload');
    }

    // Magic number source: full world tile count is `WORLD_X * WORLD_Y = 120 * 100`
    // from `ref/micropolis/src/sim/headers/sim.h` and `ref/micropolis/src/sim/s_alloc.c`.
    expect(nextBundle.map.tileWords).toHaveLength(12000);
    expect(nextBundle.map.tileWords.every((word) => word === 2)).toBe(true);
  });
});
