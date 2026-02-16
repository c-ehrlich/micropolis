import { transcodeScenarioMapCityFileBytesV1 } from '@city/scenario-core';
import { Tile, TileFlag, TileMask } from '@city/sim-core';
import { describe, expect, test } from 'vitest';

import {
  applyScenarioEditorMapToolAtPoint,
  applyScenarioEditorMapZoneLevelAtPoint,
  fillScenarioEditorMapBaseTileId,
  fillScenarioEditorMapTileWord,
  findScenarioEditorMapNamedBaseTileById,
  findScenarioEditorMapNamedBaseTileByName,
  getScenarioEditorMapIndex,
  getScenarioEditorMapNamedBaseTiles,
  getScenarioEditorMapZoneMaxLevel,
  isScenarioEditorMapTool,
  isScenarioEditorMapZoneKind,
  normalizeScenarioEditorBaseTileId,
  normalizeScenarioEditorMapZoneLevel,
  normalizeScenarioEditorMapZoneValue,
  normalizeScenarioEditorTileWord,
  readScenarioEditorMapTileWord,
  recomputeScenarioEditorMapTerrain,
  writeScenarioEditorMapBaseTileId,
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

  test('normalizes base tile ids to low 10 bits', () => {
    // Magic number source: `LOMASK=1023` in `ref/micropolis/src/sim/headers/sim.h`.
    expect(normalizeScenarioEditorBaseTileId(1024)).toBe(0);
    expect(normalizeScenarioEditorBaseTileId(1027)).toBe(3);
  });

  test('exposes full named tile constants for base-tile selection', () => {
    const namedTiles = getScenarioEditorMapNamedBaseTiles();

    // Magic number source: tile names/ids mirror `#define` constants in
    // `ref/micropolis/src/sim/headers/sim.h`.
    expect(namedTiles.some((entry) => entry.name === 'DIRT' && entry.tileId === Tile.DIRT)).toBe(
      true,
    );
    expect(namedTiles.some((entry) => entry.name === 'WOODS' && entry.tileId === Tile.WOODS)).toBe(
      true,
    );
    expect(namedTiles.some((entry) => entry.name === 'TILE_COUNT')).toBe(false);
    expect(namedTiles.some((entry) => entry.name === 'WOODS' && entry.label === 'Forest')).toBe(
      true,
    );
    expect(findScenarioEditorMapNamedBaseTileByName('RIVER')?.tileId).toBe(Tile.RIVER);
    expect(findScenarioEditorMapNamedBaseTileById(Tile.REDGE)?.name).toBe('REDGE');
  });

  test('writes base tile id while preserving status flags by default', () => {
    const bundle = createScenarioEditorInitialBundle();
    const withZoneBit = writeScenarioEditorMapTileWord(
      bundle,
      { x: 4, y: 7 },
      Tile.DIRT | TileFlag.ZONEBIT,
    );
    const nextBundle = writeScenarioEditorMapBaseTileId(withZoneBit, { x: 4, y: 7 }, Tile.RIVER);

    // Magic number source: tile word high bits hold status flags (`ZONEBIT`) and
    // low bits hold tile id in `ref/micropolis/src/sim/headers/sim.h`.
    expect(readScenarioEditorMapTileWord(nextBundle, { x: 4, y: 7 })).toBe(
      Tile.RIVER | TileFlag.ZONEBIT,
    );
  });

  test('writes base tile id without preserving flags when disabled', () => {
    const bundle = createScenarioEditorInitialBundle();
    const withFlags = writeScenarioEditorMapTileWord(
      bundle,
      { x: 4, y: 7 },
      Tile.DIRT | TileFlag.ZONEBIT | TileFlag.BULLBIT,
    );
    const nextBundle = writeScenarioEditorMapBaseTileId(withFlags, { x: 4, y: 7 }, Tile.REDGE, {
      preserveFlags: false,
    });

    expect(readScenarioEditorMapTileWord(nextBundle, { x: 4, y: 7 })).toBe(Tile.REDGE);
  });

  test('fills base tile id while preserving existing flags', () => {
    const bundle = createScenarioEditorInitialBundle();
    const withFlaggedTile = writeScenarioEditorMapTileWord(
      bundle,
      { x: 0, y: 0 },
      Tile.DIRT | TileFlag.ZONEBIT,
    );
    const nextBundle = fillScenarioEditorMapBaseTileId(withFlaggedTile, Tile.RIVER);

    expect(nextBundle.map.kind).toBe('tile-words');
    if (nextBundle.map.kind !== 'tile-words') {
      throw new Error('Expected tile-words map payload');
    }

    expect(nextBundle.map.tileWords[0]).toBe(Tile.RIVER | TileFlag.ZONEBIT);
    expect(nextBundle.map.tileWords[1]).toBe(Tile.RIVER);
  });

  test('applies road tool with Micropolis connectivity logic', () => {
    const bundle = createScenarioEditorInitialBundle();
    const nextBundle = applyScenarioEditorMapToolAtPoint(bundle, { x: 10, y: 20 }, 'road');
    const tileWord = readScenarioEditorMapTileWord(nextBundle, { x: 10, y: 20 });

    // Magic number source: `layRoad` writes `ROADS` id with status flags
    // (`BULLBIT`/`BURNBIT`) in `ref/micropolis/src/sim/w_tool.c`.
    expect((tileWord ?? 0) & TileMask.LOMASK).toBe(Tile.ROADS);
  });

  test('applies zone tools using centered footprints', () => {
    const bundle = createScenarioEditorInitialBundle();
    const nextBundle = applyScenarioEditorMapToolAtPoint(bundle, { x: 10, y: 20 }, 'res');

    // Magic number source: residential center tile starts at `RESBASE=240` and center
    // offset is +4 for 3x3 zones in `check3x3` (`ref/micropolis/src/sim/w_tool.c`).
    expect(readScenarioEditorMapTileWord(nextBundle, { x: 10, y: 20 })).toBe(
      Tile.RESBASE + 4 + TileFlag.BNCNBIT + TileFlag.ZONEBIT,
    );
  });

  test('normalizes zone level/value controls to classic domains', () => {
    // Magic number source: `GetCRVal` returns 0..3 and `ResPlop`/`ComPlop`/`IndPlop`
    // use den ranges 0..3 / 0..4 in `ref/micropolis/src/sim/s_zone.c`.
    expect(normalizeScenarioEditorMapZoneValue(5)).toBe(3);
    expect(getScenarioEditorMapZoneMaxLevel('res')).toBe(4);
    expect(getScenarioEditorMapZoneMaxLevel('com')).toBe(5);
    expect(normalizeScenarioEditorMapZoneLevel('ind', 0)).toBe(1);
    expect(normalizeScenarioEditorMapZoneLevel('com', 99)).toBe(5);
  });

  test('places explicit zone levels via res/com/ind plop formulas', () => {
    const bundle = createScenarioEditorInitialBundle();
    const nextBundle = applyScenarioEditorMapZoneLevelAtPoint(
      bundle,
      { x: 20, y: 30 },
      {
        zone: 'res',
        level: 4,
        value: 0,
      },
    );
    const center = readScenarioEditorMapTileWord(nextBundle, { x: 20, y: 30 }) ?? 0;

    // Magic number source: `ResPlop` formula in `ref/micropolis/src/sim/s_zone.c`:
    // `base = (value * 4 + den) * 9 + RZB - 4`, center tile is `base + 4`,
    // and `ZonePlop` marks center with `ZONEBIT|BULLBIT`.
    const expectedCenterTileId = (0 * 4 + (4 - 1)) * 9 + Tile.RZB;
    expect(center & TileMask.LOMASK).toBe(expectedCenterTileId);
    expect((center & TileFlag.ZONEBIT) !== 0).toBe(true);
  });

  test('recomputes terrain edges with smooth trees/water passes', () => {
    const bundle = createScenarioEditorInitialBundle();
    const withWater = writeScenarioEditorMapTileWord(bundle, { x: 10, y: 10 }, Tile.RIVER);
    const recomputed = recomputeScenarioEditorMapTerrain(withWater);

    // Magic number source: `SmoothWater()` pass 1 in `ref/micropolis/src/sim/s_gen.c`
    // converts water adjacent to non-water into `REDGE` (tile id 3).
    expect(readScenarioEditorMapTileWord(recomputed, { x: 10, y: 10 })).toBe(Tile.REDGE);
  });

  test('rejects unknown tool ids at runtime guard', () => {
    expect(isScenarioEditorMapTool('road')).toBe(true);
    expect(isScenarioEditorMapTool('network')).toBe(false);
  });

  test('rejects unknown zone ids at runtime guard', () => {
    expect(isScenarioEditorMapZoneKind('res')).toBe(true);
    expect(isScenarioEditorMapZoneKind('airport')).toBe(false);
  });
});
