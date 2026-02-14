import {
  createClassicMapStore,
  createRng,
  createSimContext,
  createSimState,
  initMapArrays,
  resetForNewCityFromSeed,
  World,
} from '../../../../../packages/sim-core/src/index.ts';

const MAX_NEW_CITY_TERRAIN_SEED = 0xffff;

/**
 * Terrain-generation controls used by Micropolis "New City" flows.
 * Mirrors global defaults consumed by `GenerateSomeCity` and `GenerateMap` in
 * `ref/micropolis/src/sim/s_gen.c`.
 */
export const NEW_CITY_TERRAIN_OPTIONS = Object.freeze({
  treeLevel: -1,
  lakeLevel: -1,
  curveLevel: -1,
  createIsland: -1,
});

/**
 * Row-major map preview payload for the New City dialog.
 * Mirrors the authoritative map tile-word domain from
 * `ref/micropolis/src/sim/s_alloc.c` (`Map[x][y]` tile words).
 * Difference: preview payload stores row-major indexing for browser canvas drawing.
 */
export interface NewCityPreviewMap {
  readonly width: number;
  readonly height: number;
  readonly tileWords: Uint16Array;
}

/**
 * Generates one random `GenerateSomeCity` terrain seed in the classic 16-bit range.
 * Mirrors `next16()` seed sourcing used by runtime new-city startup around
 * `GenerateSomeCity` in `ref/micropolis/src/sim/s_gen.c`.
 */
export function createRandomNewCityTerrainSeed(random: () => number = Math.random): number {
  const sample = random();
  if (!Number.isFinite(sample)) {
    return 0;
  }
  const clamped = Math.max(0, Math.min(0.999_999_999_999, sample));
  return Math.trunc(clamped * (MAX_NEW_CITY_TERRAIN_SEED + 1));
}

/**
 * Produces one deterministic New City preview map from a terrain seed.
 * Mirrors `GenerateSomeCity(int r)` terrain + reset flow in
 * `ref/micropolis/src/sim/s_gen.c`.
 * Difference: this helper runs in a throwaway sim-core context and returns only
 * the generated map layer for dialog preview rendering.
 */
export function buildNewCityPreviewMap(terrainSeed: number): NewCityPreviewMap {
  const mapStore = createClassicMapStore();
  const simState = createSimState();
  const simContext = createSimContext({
    store: mapStore,
    rng: createRng(1),
  });
  initMapArrays(mapStore);
  resetForNewCityFromSeed(simState, simContext, {
    seed: normalizeNewCityTerrainSeed(terrainSeed),
    ...NEW_CITY_TERRAIN_OPTIONS,
  });

  const mapLayer = mapStore.snapshot('map');
  if (!(mapLayer instanceof Uint16Array)) {
    throw new Error(`expected Uint16Array map layer; got ${mapLayer.constructor.name}`);
  }

  return {
    width: World.WORLD_X,
    height: World.WORLD_Y,
    tileWords: convertXMajorMapLayerToRowMajorTileWords(mapLayer, World.WORLD_X, World.WORLD_Y),
  };
}

/**
 * Converts x-major Micropolis map storage (`x * WORLD_Y + y`) into row-major order.
 * Mirrors contiguous `Map[x][y]` indexing in `ref/micropolis/src/sim/s_alloc.c`.
 * Difference: row-major output aligns with browser canvas raster loops.
 */
function convertXMajorMapLayerToRowMajorTileWords(
  mapLayer: Uint16Array,
  width: number,
  height: number,
): Uint16Array {
  const rowMajorTiles = new Uint16Array(width * height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const xMajorIndex = x * height + y;
      const rowMajorIndex = y * width + x;
      rowMajorTiles[rowMajorIndex] = mapLayer[xMajorIndex] ?? 0;
    }
  }
  return rowMajorTiles;
}

/**
 * Normalizes user-provided terrain seeds to the 16-bit domain used by new-city flows.
 * Mirrors Micropolis seed truncation expectations around `SeedRand(seed)` in
 * `ref/micropolis/src/sim/s_gen.c`.
 */
function normalizeNewCityTerrainSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    return 0;
  }
  return Math.trunc(seed) & MAX_NEW_CITY_TERRAIN_SEED;
}
