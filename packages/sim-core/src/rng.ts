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

export function randomSeedFromTime(rng: MicropolisRng): number {
  const now = Date.now();
  const seed = (now & 0xffff) ^ ((now >>> 16) & 0xffff) ^ rng.next16();
  rng.seed(seed);
  return seed >>> 0;
}
