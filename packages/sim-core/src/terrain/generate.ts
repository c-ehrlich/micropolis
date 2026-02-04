import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';

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
 * Intended to become a 1:1 port of `GenerateMap(seed)` from
 * `ref/micropolis/src/sim/s_gen.c`, as specified by
 * `ref/micropolis/spec/terrain/SPEC.md`.
 *
 * Today this is intentionally a no-op stub to establish the module boundary and
 * allow incremental ports (one function at a time) with tests driving parity.
 */
export function generateMap(
  _state: SimState,
  _context: SimContext,
  _options: TerrainGenOptions,
): void {
  // TODO(terrain): Implement `GenerateMap(seed)` pipeline (see PLAN.md).
}
