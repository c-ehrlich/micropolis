import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createClocks } from '../core/clocks.ts';
import { World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { decodeCityFileForMap } from '../io/cty.ts';
import { hashInt16, hashMap, hashScalars, mixHashes } from '../io/hash.ts';
import { stepTick } from '../sim/scheduler.ts';

const CLASSIC_MAP = { width: World.WORLD_X, height: World.WORLD_Y };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CITY_DIR = path.join(ROOT, 'fixtures', 'cities');

const FIXTURES = [
  {
    name: 'about',
    file: 'about.cty',
    ticks: 48,
    expected: {
      mapHash: 1173693846,
      historyHash: 927980479,
      combinedHash: 4079004657,
    },
  },
  {
    name: 'haight',
    file: 'haight.cty',
    ticks: 48,
    expected: {
      mapHash: 4021615073,
      historyHash: 4240308559,
      combinedHash: 3380361210,
    },
  },
  {
    name: 'happisle',
    file: 'happisle.cty',
    ticks: 48,
    expected: {
      mapHash: 302065584,
      historyHash: 189368903,
      combinedHash: 192627565,
    },
  },
] as const;

const loadFixture = (file: string): Uint8Array => {
  return readFileSync(path.join(CITY_DIR, file));
};

const hashHistories = (city: ReturnType<typeof decodeCityFileForMap>): number => {
  return mixHashes(
    hashInt16(city.histories.res),
    hashInt16(city.histories.com),
    hashInt16(city.histories.ind),
    hashInt16(city.histories.crime),
    hashInt16(city.histories.pollution),
    hashInt16(city.histories.money),
    hashInt16(city.misc),
  );
};

const runGoldenReplay = (file: string, ticks: number) => {
  const data = loadFixture(file);
  const city = decodeCityFileForMap(data, CLASSIC_MAP);

  const store = createClassicMapStore();
  store.beginTick();
  (store.getLayer('map') as Uint16Array).set(city.map);
  store.commitTick();

  const clocks = createClocks();
  for (let i = 0; i < ticks; i += 1) {
    stepTick(clocks);
  }

  const map = store.snapshot('map') as Uint16Array;
  const mapHash = hashMap(map);
  const historyHash = hashHistories(city);
  const scalarsHash = hashScalars([ticks, clocks.simWeeks, clocks.simStep, clocks.realtimeTick]);
  const combinedHash = mixHashes(mapHash, historyHash, scalarsHash);

  return { mapHash, historyHash, combinedHash };
};

describe('Golden replay hashes', () => {
  for (const fixture of FIXTURES) {
    it(`matches ${fixture.name} after ${fixture.ticks} ticks`, () => {
      const result = runGoldenReplay(fixture.file, fixture.ticks);

      expect(result.mapHash).toBe(fixture.expected.mapHash);
      expect(result.historyHash).toBe(fixture.expected.historyHash);
      expect(result.combinedHash).toBe(fixture.expected.combinedHash);
    });
  }
});
