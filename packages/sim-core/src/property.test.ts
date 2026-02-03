import fc from 'fast-check';
import { describe, it } from 'vitest';

import { World } from './constants.ts';
import { applyPatch, createClassicMapStore } from './map-store.ts';
import { createCityFile, decodeCityFile, encodeCityFile } from './persistence.ts';
import { MicropolisRng } from './rng.ts';

const CLASSIC_DIMENSIONS = { width: World.WORLD_X, height: World.WORLD_Y };
const MAP_LENGTH = World.WORLD_X * World.WORLD_Y;
const PROPERTY_RUNS = 50;
const PROPERTY_SEED = 1337;

const arraysEqual = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};

const nextSigned16 = (rng: MicropolisRng): number => {
  const value = rng.next16();
  return value & 0x8000 ? value - 0x10000 : value;
};

const fillInt16 = (arr: Int16Array, rng: MicropolisRng): void => {
  for (let i = 0; i < arr.length; i += 1) {
    arr[i] = nextSigned16(rng);
  }
};

const fillUint16 = (arr: Uint16Array, rng: MicropolisRng): void => {
  for (let i = 0; i < arr.length; i += 1) {
    arr[i] = rng.next16();
  }
};

const writeArb = fc.array(
  fc.record({
    index: fc.integer({ min: 0, max: MAP_LENGTH - 1 }),
    value: fc.integer({ min: 0, max: 0xffff }),
  }),
  { minLength: 1, maxLength: 200 },
);

const seedArb = fc.integer({ min: -0x80000000, max: 0x7fffffff });

const assertProperty = (property: fc.IProperty<unknown>) =>
  fc.assert(property, { numRuns: PROPERTY_RUNS, seed: PROPERTY_SEED });

describe('Property-based coverage', () => {
  it('patch logs reproduce map writes', () => {
    assertProperty(
      fc.property(writeArb, (writes) => {
        const store = createClassicMapStore();
        const before = store.snapshot('map').slice();

        store.beginTick();
        for (const { index, value } of writes) {
          store.write('map', index, value);
        }
        const result = store.commitTick();
        const patch = result.patches.find((entry) => entry.layer === 'map');
        const after = store.snapshot('map');

        if (!patch) {
          return arraysEqual(before, after);
        }

        const applied = applyPatch(before.slice(), patch);
        return arraysEqual(applied, after);
      }),
    );
  });

  it('patch logs are idempotent', () => {
    assertProperty(
      fc.property(writeArb, (writes) => {
        const store = createClassicMapStore();
        const before = store.snapshot('map').slice();

        store.beginTick();
        for (const { index, value } of writes) {
          store.write('map', index, value);
        }
        const result = store.commitTick();
        const patch = result.patches.find((entry) => entry.layer === 'map');

        if (!patch) {
          return true;
        }

        const applied = applyPatch(before.slice(), patch);
        const appliedTwice = applyPatch(applied.slice(), patch);
        return arraysEqual(applied, appliedTwice);
      }),
    );
  });

  it('city files round-trip under random seeds', () => {
    assertProperty(
      fc.property(seedArb, (seed) => {
        const rng = new MicropolisRng(seed);
        const city = createCityFile(CLASSIC_DIMENSIONS);

        fillInt16(city.histories.res, rng);
        fillInt16(city.histories.com, rng);
        fillInt16(city.histories.ind, rng);
        fillInt16(city.histories.crime, rng);
        fillInt16(city.histories.pollution, rng);
        fillInt16(city.histories.money, rng);
        fillInt16(city.misc, rng);
        fillUint16(city.map, rng);

        const encoded = encodeCityFile(city);
        const decoded = decodeCityFile(encoded);

        return (
          arraysEqual(decoded.map, city.map) &&
          arraysEqual(decoded.histories.res, city.histories.res) &&
          arraysEqual(decoded.histories.com, city.histories.com) &&
          arraysEqual(decoded.histories.ind, city.histories.ind) &&
          arraysEqual(decoded.histories.crime, city.histories.crime) &&
          arraysEqual(decoded.histories.pollution, city.histories.pollution) &&
          arraysEqual(decoded.histories.money, city.histories.money) &&
          arraysEqual(decoded.misc, city.misc)
        );
      }),
    );
  });

  it('rng repeats sequences for the same seed', () => {
    assertProperty(
      fc.property(seedArb, fc.integer({ min: 1, max: 64 }), (seed, count) => {
        const rngA = new MicropolisRng(seed);
        const rngB = new MicropolisRng(seed);

        for (let i = 0; i < count; i += 1) {
          if (rngA.next16() !== rngB.next16()) {
            return false;
          }
        }

        return true;
      }),
    );
  });
});
