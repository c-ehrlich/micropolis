import type { MicropolisRng } from '../core/rng.ts';

/**
 * Internal RNG interface used by Micropolis terrain generation.
 *
 * Mirrors the RNG helpers used by `GenerateMap(seed)` and its subroutines in:
 * - `ref/micropolis/src/sim/s_gen.c` (`SeedRand`, `Rand16`, `Rand(range)`)
 * - `ref/micropolis/spec/terrain/SPEC.md` ("Random number generation")
 *
 * This is intended to be a 1:1 behavioral contract: notably, `rand(range)`
 * must return a uniform integer in `[0..range]`, inclusive.
 */
export interface TerrainRng {
  /**
   * Mirrors `SeedRand(seed)` in `ref/micropolis/src/sim/s_gen.c` (1:1).
   */
  seed(value: number): void;

  /**
   * Mirrors `Rand16()` in `ref/micropolis/src/sim/s_gen.c` (1:1).
   */
  next16(): number;

  /**
   * Mirrors `Rand(range)` in `ref/micropolis/src/sim/s_gen.c` (1:1).
   *
   * Note: `range` is inclusive: this returns an integer in `[0..range]`.
   */
  rand(range: number): number;
}

/**
 * Adapter for using the production Micropolis RNG implementation in terrain
 * generation without changing its behavior.
 *
 * `MicropolisRng` already matches `TerrainRng` 1:1 (same method names and
 * inclusive `rand(range)` semantics), so this is intentionally a no-op adapter.
 *
 * C reference: `ref/micropolis/src/sim/s_gen.c` (`SeedRand`, `Rand16`, `Rand`).
 */
export function terrainRngFromMicropolisRng(rng: MicropolisRng): TerrainRng {
  return rng;
}

export interface QueueTerrainRngOptions {
  /**
   * A FIFO sequence of values to return from `rand(range)` calls.
   *
   * Each queued value must satisfy the Micropolis contract `0 <= value <= range`
   * for the `range` provided at the time of the call. We validate this to catch
   * accidental half-open ports.
   */
  randValues?: readonly number[];

  /**
   * A FIFO sequence of values to return from `next16()` calls.
   */
  next16Values?: readonly number[];
}

/**
 * Deterministic queue-backed RNG for terrain unit tests.
 *
 * This does not exist in Micropolis C; it is a test helper so we can unit test
 * individual terrain routines without depending on the PRNG sequence. It still
 * enforces Micropolis semantics (notably inclusive `Rand(range)`).
 */
export class QueueTerrainRng implements TerrainRng {
  private readonly randValues: readonly number[];
  private readonly next16Values: readonly number[];

  private randIndex = 0;
  private next16Index = 0;

  constructor(options: QueueTerrainRngOptions) {
    this.randValues = options.randValues ?? [];
    this.next16Values = options.next16Values ?? [];
  }

  seed(_value: number): void {
    // In terrain code, reseeding means the future random sequence is fully
    // determined by the new seed. For a queue RNG, the closest equivalent is to
    // restart consumption from the head.
    this.randIndex = 0;
    this.next16Index = 0;
  }

  next16(): number {
    const value = this.next16Values[this.next16Index];
    if (value === undefined) {
      throw new Error(`QueueTerrainRng.next16(): missing value at index ${this.next16Index}`);
    }
    this.next16Index += 1;
    return value;
  }

  rand(range: number): number {
    const value = this.randValues[this.randIndex];
    if (value === undefined) {
      throw new Error(`QueueTerrainRng.rand(${range}): missing value at index ${this.randIndex}`);
    }

    // `range` is inclusive in Micropolis (`Rand(range)` returns in [0..range]).
    // We enforce that contract here so tests catch an incorrect port.
    if (value < 0 || value > range) {
      throw new Error(
        `QueueTerrainRng.rand(${range}): queued value ${value} is outside [0..${range}] (index ${this.randIndex})`,
      );
    }

    this.randIndex += 1;
    return value;
  }
}
