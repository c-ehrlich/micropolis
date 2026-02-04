import { describe, expect, it } from 'vitest';

import { eRand } from './erand.ts';
import { QueueTerrainRng } from './rng.ts';

/**
 * `ERand(limit)` is a small helper used by Micropolis terrain generation.
 *
 * Source of truth:
 * - `ERand(short limit)` in `ref/micropolis/src/sim/s_gen.c`
 * - Also described in `ref/micropolis/spec/terrain/SPEC.md` ("ERand(limit)")
 *
 * C behavior:
 * - `ERand(limit)` returns `min(Rand(limit), Rand(limit))`.
 *
 * There are no "magic numbers" here beyond the literal translation of the C
 * logic; `limit` is passed through to `Rand(limit)` twice. Note that `Rand` is
 * inclusive in Micropolis, returning values in `[0..limit]`.
 */
describe('terrain ERand', () => {
  it('returns the minimum of two `Rand(limit)` draws (C behavior)', () => {
    const rng = new QueueTerrainRng({
      // Simulate the two `Rand(limit)` calls inside `ERand`.
      randValues: [7, 3],
    });

    expect(eRand(rng, 10)).toBe(3);
  });
});
