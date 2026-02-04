import { randomSeedFromTime } from '../core/rng.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import { clearMap } from './clear.ts';
import { doRivers } from './do-rivers.ts';
import { getRandStart } from './get-rand-start.ts';
import { makeIsland } from './make-island.ts';
import { makeLakes } from './make-lakes.ts';
import { makeNakedIsland } from './make-naked-island.ts';
import { terrainRngFromMicropolisRng } from './rng.ts';
import { smoothRiver } from './smooth-river.ts';
import { doTrees } from './trees.ts';

export type TerrainReseedAfter = 'clock' | { seed: number } | false;

export interface TerrainGenOptions {
  /**
   * Initial seed for the Micropolis terrain RNG.
   *
   * Mirrors the `seed` parameter to `GenerateMap(seed)` in
   * `ref/micropolis/src/sim/s_gen.c`.
   */
  seed: number;

  /**
   * Mirrors `TreeLevel` (global) in `ref/micropolis/src/sim/s_gen.c`.
   */
  treeLevel: number;

  /**
   * Mirrors `LakeLevel` (global) in `ref/micropolis/src/sim/s_gen.c`.
   */
  lakeLevel: number;

  /**
   * Mirrors `CurveLevel` (global) in `ref/micropolis/src/sim/s_gen.c`.
   */
  curveLevel: number;

  /**
   * Mirrors `CreateIsland` (global) in `ref/micropolis/src/sim/s_gen.c`.
   */
  createIsland: number;

  /**
   * Whether to reseed after terrain generation.
   *
   * In C, `GenerateMap(seed)` ends with `RandomlySeedRand()` in the non-early-return
   * paths; the random-island early return skips this reseed. See:
   * - `ref/micropolis/src/sim/s_gen.c` (`GenerateMap`, `RandomlySeedRand`)
   * - `ref/micropolis/spec/terrain/SPEC.md` ("GenerateMap" notes)
   *
   * This option exists so unit tests can keep the outcome deterministic by
   * disabling or controlling reseeding.
   */
  reseedAfter?: TerrainReseedAfter;
}

/**
 * Terrain generation entry point.
 *
 * Orchestrates the full Micropolis terrain generation pipeline.
 *
 * This is a 1:1 port (pipeline shape + branching) of `GenerateMap(int r)` from:
 * - `ref/micropolis/src/sim/s_gen.c`
 * - `ref/micropolis/spec/terrain/SPEC.md`
 *
 * sim-core adaptations:
 * - Operates on `context.store` (no global `Map[x][y]`) and owns the store tick.
 * - Reseeding after generation is configurable via `reseedAfter` so tests can be
 *   deterministic. (`GenerateMap`’s early-return random-island branch still skips
 *   reseeding, matching the C behavior.)
 */
export function generateMap(
  _state: SimState,
  context: SimContext,
  options: TerrainGenOptions,
): void {
  // This function is intentionally orchestration-only: it wires together the
  // already-ported terrain routines to mirror the C `GenerateMap(int r)`
  // pipeline in `ref/micropolis/src/sim/s_gen.c` / `ref/micropolis/spec/terrain/SPEC.md`.

  // Terrain generation writes the entire map layer, so we own the store tick.
  context.store.beginTick();
  try {
    const layer = context.store.getLayer('map');
    if (!(layer instanceof Uint16Array)) {
      throw new Error(
        `generateMap expected 'map' layer to be Uint16Array; got ${layer.constructor.name}`,
      );
    }
    const map = layer;

    const rng = terrainRngFromMicropolisRng(context.rng);

    // C: `SeedRand(r);`
    rng.seed(options.seed);

    // C:
    //   if (CreateIsland < 0) {
    //     if (Rand(100) < 10) { MakeIsland(); return; }
    //   }
    //
    // Notes:
    // - `Rand(100)` is inclusive: 0..100.
    // - The `return` here is significant: it skips `RandomlySeedRand()` in C.
    if (options.createIsland < 0) {
      if (rng.rand(100) < 10) {
        makeIsland(map, rng, options.treeLevel, {});
        return;
      }
    }

    // C:
    //   if (CreateIsland == 1) MakeNakedIsland();
    //   else ClearMap();
    if (options.createIsland === 1) {
      makeNakedIsland(map, rng);
    } else {
      clearMap(map);
    }

    // C: `GetRandStart();`
    const { xStart, yStart } = getRandStart(rng);

    // C:
    //   if (CurveLevel != 0) DoRivers();
    //   if (LakeLevel != 0) MakeLakes();
    //   SmoothRiver();
    //   if (TreeLevel != 0) DoTrees();
    if (options.curveLevel !== 0) {
      doRivers(map, rng, options.curveLevel, xStart, yStart, {});
    }

    if (options.lakeLevel !== 0) {
      makeLakes(map, rng, options.lakeLevel, {});
    }

    smoothRiver(map, rng);

    if (options.treeLevel !== 0) {
      doTrees(map, rng, options.treeLevel, {});
    }

    // C: `RandomlySeedRand();` (only in non-early-return paths).
    //
    // sim-core adaptation:
    // - We make reseeding controllable for deterministic tests.
    // - For the 'clock' case today, we reuse sim-core's existing time-based seed
    //   helper. A future plan item tightens this to match the C `gettimeofday()`
    //   XOR formula more closely and provides a deterministic injection point.
    const reseedAfter = options.reseedAfter ?? 'clock';
    if (reseedAfter !== false) {
      if (typeof reseedAfter === 'object') {
        rng.seed(reseedAfter.seed);
      } else {
        randomSeedFromTime(context.rng);
      }
    }
  } finally {
    context.store.commitTick();
  }
}
