import { describe, expect, it } from 'vitest';

import { QueueTerrainRng } from '../terrain/rng.ts';

describe('terrain RNG adapter', () => {
  it('treats Rand(range) as inclusive of the upper bound', () => {
    // In Micropolis terrain generation, `Rand(range)` returns a uniform integer
    // in [0..range], inclusive (i.e. both endpoints are possible). This is
    // explicitly documented in `ref/micropolis/spec/terrain/SPEC.md` and is the
    // semantics used throughout `ref/micropolis/src/sim/s_gen.c`.
    //
    // This behavior is easy to accidentally change when porting from C (e.g.
    // by using JS `Math.random() * range` patterns which are typically
    // half-open). We pin the intended semantics here with a deterministic test
    // RNG: it must be legal for `rand(range)` to return exactly `range`.
    const rng = new QueueTerrainRng({
      randValues: [5],
    });

    expect(rng.rand(5)).toBe(5);
  });

  it('throws if rand() consumes past the end of the queue', () => {
    // QueueTerrainRng is a test-only helper (not present in the C codebase). We
    // still want it to fail loudly and deterministically when a test expects
    // more RNG values than it provided.
    const rng = new QueueTerrainRng({ randValues: [] });

    expect(() => rng.rand(0)).toThrow(/missing value/i);
  });

  it('throws if next16() consumes past the end of the queue', () => {
    const rng = new QueueTerrainRng({ next16Values: [] });

    expect(() => rng.next16()).toThrow(/missing value/i);
  });

  it('throws if a queued rand() value is outside the inclusive [0..range] contract', () => {
    // In Micropolis terrain generation, `Rand(range)` is inclusive. Returning a
    // value greater than `range` would violate the core contract described in
    // `ref/micropolis/spec/terrain/SPEC.md` and implemented by `Rand(range)` in
    // `ref/micropolis/src/sim/s_gen.c`.
    const rng = new QueueTerrainRng({ randValues: [6] });

    expect(() => rng.rand(5)).toThrow(/\[0\.\.5\]/);
  });

  it('seed() resets queue consumption (deterministic reseed)', () => {
    // In C, `SeedRand(seed)` restarts the PRNG stream from a new seed. For a
    // queue-backed RNG, the closest equivalent is restarting consumption from
    // the head of the queue.
    const rng = new QueueTerrainRng({
      randValues: [1, 2],
      next16Values: [10, 11],
    });

    expect(rng.rand(5)).toBe(1);
    expect(rng.next16()).toBe(10);

    rng.seed(123);

    expect(rng.rand(5)).toBe(1);
    expect(rng.next16()).toBe(10);
  });
});
