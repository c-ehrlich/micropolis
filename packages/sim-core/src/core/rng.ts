const RANDOM_RANGE = 0xffff;

export class MicropolisRng {
  private next: number;

  constructor(seed = 1) {
    this.next = seed >>> 0;
  }

  seed(value: number) {
    this.next = value >>> 0;
  }

  next16(): number {
    this.next = (Math.imul(this.next, 1103515245) + 12345) >>> 0;
    return (this.next >>> 8) & 0xffff;
  }

  next16Signed(): number {
    let value = this.next16();
    if (value > 32767) {
      value = 32767 - value;
    }
    return value;
  }

  rand(range: number): number {
    const span = range + 1;
    const maxMultiple = Math.floor(RANDOM_RANGE / span) * span;
    let value = this.next16();
    while (value >= maxMultiple) {
      value = this.next16();
    }
    return value % span;
  }
}

export function createRng(seed = 1): MicropolisRng {
  return new MicropolisRng(seed);
}

/**
 * `gettimeofday`-style timestamp payload used by `randomSeedFromTime`.
 *
 * Mirrors `struct timeval` consumed by `RandomlySeedRand()` in
 * `ref/micropolis/src/sim/s_sim.c`.
 */
export interface MicropolisTimeval {
  /**
   * Seconds since Unix epoch (`time.tv_sec` in C).
   */
  tv_sec: number;
  /**
   * Microseconds within the current second (`time.tv_usec` in C).
   */
  tv_usec: number;
}

/**
 * Injectable `gettimeofday` equivalent used for deterministic testing.
 *
 * Mirrors `gettimeofday(&time, NULL)` in `ref/micropolis/src/sim/s_sim.c`.
 */
export type MicropolisTimevalSource = () => MicropolisTimeval;

const defaultTimevalSource: MicropolisTimevalSource = () => {
  const now = Date.now();
  const tv_sec = Math.trunc(now / 1000);
  const tv_usec = Math.trunc(now % 1000) * 1000;
  return { tv_sec, tv_usec };
};

/**
 * Time-based reseed helper for Micropolis core RNG.
 *
 * Mirrors `RandomlySeedRand()` in `ref/micropolis/src/sim/s_sim.c`:
 * `SeedRand(time.tv_usec ^ time.tv_sec ^ sim_rand());`
 *
 * sim-core note:
 * - JS does not expose native `gettimeofday`; the default source derives
 *   `tv_sec/tv_usec` from `Date.now()`.
 * - Tests can inject an exact `tv_sec/tv_usec` source for deterministic parity.
 */
export function randomSeedFromTime(
  rng: MicropolisRng,
  timeSource: MicropolisTimevalSource = defaultTimevalSource,
): number {
  const time = timeSource();
  const seed = (Math.trunc(time.tv_usec) ^ Math.trunc(time.tv_sec) ^ rng.next16()) >>> 0;
  rng.seed(seed);
  return seed;
}
