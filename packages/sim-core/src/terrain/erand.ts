import type { TerrainRng } from './rng.ts';

/**
 * "E" rand helper used by Micropolis terrain generation.
 *
 * Intended to be a 1:1 port of `ERand(short limit)` from
 * `ref/micropolis/src/sim/s_gen.c`.
 *
 * In C, this is used by island generation to bias random offsets toward smaller
 * values (by taking the minimum of two draws from `Rand(limit)`).
 */
export function eRand(rng: TerrainRng, limit: number): number {
  // Matches C exactly (s_gen.c):
  //   z = Rand(limit);
  //   x = Rand(limit);
  //   if (z < x) return z;
  //   return x;
  const z = rng.rand(limit);
  const x = rng.rand(limit);
  return z < x ? z : x;
}
