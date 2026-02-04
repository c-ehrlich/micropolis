import { assertDefined } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import { indexFor, testBounds } from './helpers.ts';
import { moveMap } from './move-map.ts';
import type { TerrainRng } from './rng.ts';
import { smoothTrees } from './smooth-trees.ts';

/**
 * Compute the number of `TreeSplash` calls (`Amount`) performed by `DoTrees`.
 *
 * 1:1 port of the `Amount` selection logic in `DoTrees(void)` from:
 * - `ref/micropolis/src/sim/s_gen.c` (`DoTrees`)
 * - `ref/micropolis/spec/terrain/SPEC.md` ("DoTrees()")
 *
 * C behavior:
 * - If `TreeLevel < 0`: `Amount = Rand(100) + 50` (inclusive => 50..150).
 * - Else: `Amount = TreeLevel + 3`.
 */
export function treeSplashCount(rng: TerrainRng, treeLevel: number): number {
  if (treeLevel < 0) {
    return rng.rand(100) + 50;
  }
  return treeLevel + 3;
}

/**
 * Compute the random-walk path length (`dis`) for a single `TreeSplash`.
 *
 * 1:1 port of the `dis` selection logic in `TreeSplash(short xloc, short yloc)`
 * from:
 * - `ref/micropolis/src/sim/s_gen.c` (`TreeSplash`)
 * - `ref/micropolis/spec/terrain/SPEC.md` ("TreeSplash(xloc, yloc)")
 *
 * C behavior:
 * - If `TreeLevel < 0`: `dis = Rand(150) + 50` (inclusive => 50..200).
 * - Else: `dis = Rand(100 + (TreeLevel * 2)) + 50`.
 */
export function treeSplashDistance(rng: TerrainRng, treeLevel: number): number {
  if (treeLevel < 0) {
    return rng.rand(150) + 50;
  }
  return rng.rand(100 + treeLevel * 2) + 50;
}

/**
 * Paint a random-walk "splash" of trees onto the map.
 *
 * 1:1 port of `TreeSplash(short xloc, short yloc)` in
 * `ref/micropolis/src/sim/s_gen.c`.
 *
 * C behavior notes (mirrored exactly):
 * - Uses `MoveMap(dir)` with `dir = Rand(7)` (8-way).
 * - If the cursor leaves bounds, returns immediately (does not wrap).
 * - Only writes onto tiles whose *masked* ID is `DIRT`:
 *     `(Map[MapX][MapY] & LOMASK) == DIRT`
 * - Writes `WOODS + BLBNBIT` (tile id 37 with bull+burn flags set).
 *
 * @param map The classic Micropolis map layer (`Map[x][y]`) as a column-major `Uint16Array`.
 * @param rng Terrain RNG (`Rand(range)` is inclusive) used for `dis` and `dir` draws.
 * @param xloc Starting X (equivalent to `xloc` argument in C).
 * @param yloc Starting Y (equivalent to `yloc` argument in C).
 * @param treeLevel `TreeLevel` (global) from C, controlling `dis` selection.
 */
export function treeSplash(
  map: Uint16Array,
  rng: TerrainRng,
  xloc: number,
  yloc: number,
  treeLevel: number,
): void {
  const dis = treeSplashDistance(rng, treeLevel);

  // C uses global `MapX/MapY` as a mutable cursor. We model it as local vars.
  let mapX = xloc;
  let mapY = yloc;

  for (let step = 0; step < dis; step += 1) {
    const dir = rng.rand(7);
    ({ mapX, mapY } = moveMap(mapX, mapY, dir));

    if (!testBounds(mapX, mapY)) {
      return;
    }

    const index = indexFor(mapX, mapY);
    const existingRaw = map[index];
    assertDefined(existingRaw, 'Expected map index to be in-bounds');

    if ((existingRaw & TileMask.LOMASK) === Tile.DIRT) {
      map[index] = Tile.WOODS + TileFlag.BLBNBIT;
    }
  }
}

export interface DoTreesDeps {
  /**
   * Optional callback invoked once per tree splash. This is mainly to make
   * `DoTrees` unit-testable without depending on the random walk details.
   *
   * When omitted, `DoTrees` uses {@link treeSplash} (1:1 C behavior).
   */
  treeSplash?: (map: Uint16Array, xloc: number, yloc: number) => void;

  /**
   * Optional smoothing routine invoked twice after all splashes.
   *
   * In C, `DoTrees` always calls `SmoothTrees(); SmoothTrees();`. We keep this
   * as an injectable dependency primarily for unit tests (spies).
   *
   * When omitted, {@link smoothTrees} is used (1:1 C behavior).
   */
  smoothTrees?: (map: Uint16Array) => void;
}

/**
 * Populate the map with trees by applying multiple `TreeSplash` random walks,
 * then smoothing twice.
 *
 * 1:1 port of `DoTrees(void)` in `ref/micropolis/src/sim/s_gen.c`.
 *
 * C behavior:
 * - Computes `Amount` based on `TreeLevel` (see {@link treeSplashCount}).
 * - For each splash, picks `(xloc, yloc)` uniformly:
 *   - `xloc = Rand(WORLD_X - 1)`
 *   - `yloc = Rand(WORLD_Y - 1)`
 * - After all splashes, calls `SmoothTrees()` twice.
 */
export function doTrees(
  map: Uint16Array,
  rng: TerrainRng,
  treeLevel: number,
  deps: DoTreesDeps,
): void {
  const amount = treeSplashCount(rng, treeLevel);

  const treeSplashImpl =
    deps.treeSplash ??
    ((targetMap: Uint16Array, xloc: number, yloc: number) =>
      treeSplash(targetMap, rng, xloc, yloc, treeLevel));

  const smoothTreesImpl = deps.smoothTrees ?? smoothTrees;

  for (let i = 0; i < amount; i += 1) {
    const xloc = rng.rand(World.WORLD_X - 1);
    const yloc = rng.rand(World.WORLD_Y - 1);
    treeSplashImpl(map, xloc, yloc);
  }

  smoothTreesImpl(map);
  smoothTreesImpl(map);
}
