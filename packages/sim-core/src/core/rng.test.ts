import { describe, expect, it } from 'vitest';

import { MicropolisRng, randomSeedFromTime } from './rng.ts';

describe('MicropolisRng', () => {
  it('produces the same sequence for the same seed', () => {
    const rngA = new MicropolisRng(123456);
    const rngB = new MicropolisRng(123456);

    const valuesA: number[] = [];
    const valuesB: number[] = [];

    for (let i = 0; i < 32; i += 1) {
      valuesA.push(rngA.next16());
      valuesB.push(rngB.next16());
    }

    expect(valuesA).toEqual(valuesB);
  });

  it('matches reference outputs for seed 1', () => {
    const rng = new MicropolisRng(1);
    const expected = [50814, 32432, 33252, 27547, 19423, 64372, 58038, 64430, 21692, 63189];
    const values = expected.map(() => rng.next16());

    expect(values).toEqual(expected);
  });

  it('rand(range) matches the reference sequence and stays in range', () => {
    const rng = new MicropolisRng(1);
    const expected = [0, 2, 0, 1, 1, 4, 0, 2, 2, 3];
    const values = expected.map(() => rng.rand(5));

    expect(values).toEqual(expected);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(5);
    }
  });

  it('rand(0) always returns 0', () => {
    const rng = new MicropolisRng(98765);
    const values = Array.from({ length: 20 }, () => rng.rand(0));

    expect(values.every((value) => value === 0)).toBe(true);
  });

  it('randomSeedFromTime mirrors C RandomlySeedRand xor shape', () => {
    const initialSeed = 0x1234_5678;
    const tv_sec = 0x0bad_beef;
    const tv_usec = 0x0007_a120;

    const probe = new MicropolisRng(initialSeed);
    const expectedSeed = (tv_usec ^ tv_sec ^ probe.next16()) >>> 0;

    const rng = new MicropolisRng(initialSeed);
    const actualSeed = randomSeedFromTime(rng, () => ({ tv_sec, tv_usec }));
    expect(actualSeed).toBe(expectedSeed);

    const expectedRng = new MicropolisRng(expectedSeed);
    expect(rng.next16()).toBe(expectedRng.next16());
    expect(rng.next16()).toBe(expectedRng.next16());
  });

  it('randomSeedFromTime uses the provided timeval source', () => {
    const rng = new MicropolisRng(0x00c0ffee);
    let calls = 0;
    const source = () => {
      calls += 1;
      return { tv_sec: 123, tv_usec: 456789 };
    };

    randomSeedFromTime(rng, source);
    expect(calls).toBe(1);
  });
});
