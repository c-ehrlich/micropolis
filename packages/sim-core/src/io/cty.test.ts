import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runCoreOracleInitNewCity,
  runCoreOracleLoadCty,
} from '@city/micropolis-c-harness/core-parity';
import { describe, expect, it } from 'vitest';

import { getOrThrow } from '../core/assert.ts';
import { World } from '../core/constants.ts';
import {
  applyLoadNormalization,
  CITY_FILE_HEADER_BYTES,
  CITY_HISTORY_LENGTH,
  cityDimensionsForMap,
  createCityFile,
  decodeCityFile,
  decodeCityFileForMap,
  encodeCityFile,
  readCityMeta,
  sniffCityDimensions,
  writeCityMeta,
} from './cty.ts';

const CLASSIC_DIMENSIONS = { width: 120, height: 100 };
const FIXTURE_CITY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/cities/about.cty',
);

function fillHistories(target: ReturnType<typeof createCityFile>['histories']): void {
  for (let i = 0; i < CITY_HISTORY_LENGTH; i += 1) {
    const value = i % 2 === 0 ? i : -i;
    target.res[i] = value;
    target.com[i] = value + 2;
    target.ind[i] = value - 3;
    target.crime[i] = value + 4;
    target.pollution[i] = value - 5;
    target.money[i] = value + 6;
  }
}

function fillMap(target: Uint16Array): void {
  for (let i = 0; i < target.length; i += 1) {
    target[i] = (i * 37) & 0xffff;
  }
  target[0] = 0x8001;
  target[1] = 0xabcd;
}

describe('city file persistence', () => {
  it('round-trips .cty data', () => {
    const city = createCityFile(CLASSIC_DIMENSIONS);
    fillHistories(city.histories);
    fillMap(city.map);

    const meta = {
      cityTime: 123456,
      totalFunds: 987654,
      autoBulldoze: true,
      autoBudget: false,
      autoGo: true,
      userSoundOn: false,
      cityTax: 9,
      simSpeed: 2,
      policePercent: 0.75,
      firePercent: 0.5,
      roadPercent: 0.25,
    };

    writeCityMeta(city.misc, meta);

    const encoded = encodeCityFile(city);
    const decoded = decodeCityFile(encoded);

    expect(decoded.dimensions).toEqual(city.dimensions);
    expect(Array.from(decoded.map)).toEqual(Array.from(city.map));
    expect(Array.from(decoded.histories.res)).toEqual(Array.from(city.histories.res));
    expect(Array.from(decoded.histories.com)).toEqual(Array.from(city.histories.com));
    expect(Array.from(decoded.histories.ind)).toEqual(Array.from(city.histories.ind));
    expect(Array.from(decoded.histories.crime)).toEqual(Array.from(city.histories.crime));
    expect(Array.from(decoded.histories.pollution)).toEqual(Array.from(city.histories.pollution));
    expect(Array.from(decoded.histories.money)).toEqual(Array.from(city.histories.money));
    expect(Array.from(decoded.misc)).toEqual(Array.from(city.misc));

    expect(readCityMeta(decoded.misc)).toEqual(meta);
  });

  it('packs 32-bit and fixed-point misc values in big-endian order', () => {
    const city = createCityFile(CLASSIC_DIMENSIONS);
    writeCityMeta(city.misc, {
      cityTime: 0x12345678,
      totalFunds: -200,
      autoBulldoze: true,
      autoBudget: false,
      autoGo: true,
      userSoundOn: false,
      cityTax: 12,
      simSpeed: 1,
      policePercent: 1.5,
      firePercent: 0.25,
      roadPercent: -0.5,
    });

    expect(getOrThrow(city.misc[8])).toBe(0x1234);
    expect(getOrThrow(city.misc[9])).toBe(0x5678);
    expect(getOrThrow(city.misc[50]) & 0xffff).toBe(0xffff);
    expect(getOrThrow(city.misc[51]) & 0xffff).toBe(0xff38);
    expect(getOrThrow(city.misc[58]) & 0xffff).toBe(0x0001);
    expect(getOrThrow(city.misc[59]) & 0xffff).toBe(0x8000);
    expect(getOrThrow(city.misc[60]) & 0xffff).toBe(0x0000);
    expect(getOrThrow(city.misc[61]) & 0xffff).toBe(0x4000);
    expect(getOrThrow(city.misc[62]) & 0xffff).toBe(0xffff);
    expect(getOrThrow(city.misc[63]) & 0xffff).toBe(0x8000);

    const meta = readCityMeta(city.misc);
    expect(meta.cityTime).toBe(0x12345678);
    expect(meta.totalFunds).toBe(-200);
    expect(meta.policePercent).toBeCloseTo(1.5);
    expect(meta.firePercent).toBeCloseTo(0.25);
    expect(meta.roadPercent).toBeCloseTo(-0.5);
  });

  it('reads big-endian shorts from disk', () => {
    const bytes = new Uint8Array(27120);
    bytes[0] = 0x12;
    bytes[1] = 0x34;
    const mapOffset = CITY_FILE_HEADER_BYTES;
    bytes[mapOffset] = 0xab;
    bytes[mapOffset + 1] = 0xcd;

    const decoded = decodeCityFile(bytes);

    expect(decoded.histories.res[0]).toBe(0x1234);
    expect(decoded.map[0]).toBe(0xabcd);
  });

  it('sniffs supported file sizes and rejects invalid lengths', () => {
    expect(sniffCityDimensions(27120)).toMatchObject({ width: 120, height: 100 });
    expect(sniffCityDimensions(99120)).toMatchObject({ width: 240, height: 200 });
    expect(sniffCityDimensions(219120)).toMatchObject({ width: 360, height: 300 });
    expect(() => sniffCityDimensions(123)).toThrow('unsupported city file length');
    expect(() => cityDimensionsForMap(10, 10)).toThrow('unsupported city map dimensions');
    expect(() => decodeCityFile(new Uint8Array(10))).toThrow('unsupported city file length');
  });

  it('round-trips 2x2 and 3x3 city files', () => {
    const sizes = [
      { width: 240, height: 200 },
      { width: 360, height: 300 },
    ];

    for (const size of sizes) {
      const city = createCityFile(size);
      fillHistories(city.histories);
      fillMap(city.map);

      const encoded = encodeCityFile(city);
      expect(encoded.byteLength).toBe(cityDimensionsForMap(size.width, size.height).byteLength);

      const decoded = decodeCityFile(encoded);
      expect(decoded.dimensions).toEqual(city.dimensions);
      expect(decoded.map.length).toBe(city.map.length);
      expect(Array.from(decoded.map)).toEqual(Array.from(city.map));
    }
  });

  it('truncates oversized maps to the target build size', () => {
    const size = { width: 240, height: 200 };
    const city = createCityFile(size);

    for (let x = 0; x < size.width; x += 1) {
      for (let y = 0; y < size.height; y += 1) {
        city.map[x * size.height + y] = (x * 256 + y) & 0xffff;
      }
    }

    const decoded = decodeCityFileForMap(encodeCityFile(city), CLASSIC_DIMENSIONS);
    const classicLength = World.WORLD_X * World.WORLD_Y;

    expect(decoded.map.length).toBe(classicLength);
    expect(getOrThrow(decoded.map[0])).toBe(0);
    expect(getOrThrow(decoded.map[size.height - 1])).toBe(size.height - 1);
    expect(getOrThrow(decoded.map[size.height])).toBe(256);
    expect(getOrThrow(decoded.map[classicLength - 1])).toBe(
      (59 * 256 + (size.height - 1)) & 0xffff,
    );
  });

  it('rejects files smaller than the target build size', () => {
    const city = createCityFile(CLASSIC_DIMENSIONS);
    const data = encodeCityFile(city);

    expect(() => decodeCityFileForMap(data, { width: 240, height: 200 })).toThrow(
      'city file is smaller than target map size',
    );
  });

  it('normalizes load values and resets funding percents', () => {
    const city = createCityFile(CLASSIC_DIMENSIONS);
    writeCityMeta(city.misc, {
      cityTime: -5,
      totalFunds: 1000,
      autoBulldoze: false,
      autoBudget: false,
      autoGo: false,
      userSoundOn: true,
      cityTax: 99,
      simSpeed: -1,
      policePercent: 0.25,
      firePercent: 0.75,
      roadPercent: 0.5,
    });

    const meta = readCityMeta(city.misc);
    const normalized = applyLoadNormalization(meta);

    expect(normalized.cityTime).toBe(0);
    expect(normalized.cityTax).toBe(7);
    expect(normalized.simSpeed).toBe(3);
    expect(normalized.policePercent).toBe(1);
    expect(normalized.firePercent).toBe(1);
    expect(normalized.roadPercent).toBe(1);
  });

  it('matches oracle load-cty normalization for classic fixtures', () => {
    const oracleBefore = runCoreOracleInitNewCity({ seed: 0x00c7f1e });
    const oracleAfter = runCoreOracleLoadCty({ state: oracleBefore, ctyPath: FIXTURE_CITY });

    const cityBytes = readFileSync(FIXTURE_CITY);
    const city = decodeCityFileForMap(cityBytes, CLASSIC_DIMENSIONS);
    const rawMeta = readCityMeta(city.misc);
    const normalized = applyLoadNormalization(rawMeta);

    // `s_fileio.c` `loadFile` uses `SetFunds` on `MiscHis[50..51]` and applies
    // normalized `CityTime`/`CityTax`/`SimSpeed`.
    expect(oracleAfter.TotalFunds).toBe(rawMeta.totalFunds);
    expect(oracleAfter.CityTime).toBe(normalized.cityTime);
    expect(oracleAfter.CityTax).toBe(normalized.cityTax);
    expect(oracleAfter.SimSpeed).toBe(normalized.simSpeed);

    // `InitFundingLevel()` in `s_fileio.c` resets all funding percents to 1.0.
    expect(oracleAfter.policePercent).toBe(1);
    expect(oracleAfter.firePercent).toBe(1);
    expect(oracleAfter.roadPercent).toBe(1);

    expect(oracleAfter.autoBulldoze).toBe(rawMeta.autoBulldoze ? 1 : 0);
    expect(oracleAfter.autoBudget).toBe(rawMeta.autoBudget ? 1 : 0);
    expect(oracleAfter.autoGo).toBe(rawMeta.autoGo ? 1 : 0);
    expect(oracleAfter.UserSoundOn).toBe(rawMeta.userSoundOn ? 1 : 0);

    const oracleMapPrefix = Array.from(oracleAfter.map.slice(0, city.map.length));
    expect(oracleMapPrefix).toEqual(Array.from(city.map));
  });
});
