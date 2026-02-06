import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type CoreOracleState,
  runCoreOracleInitNewCity,
  runCoreOracleLoadCty,
  runCoreOracleSaveCty,
} from '../../micropolis-c-harness/src/core-parity.ts';
import {
  applyLoadNormalization,
  CITY_HISTORY_LENGTH,
  CITY_MISC_LENGTH,
  createCityFile,
  createClassicMapStore,
  createSimContext,
  createSimState,
  decodeCityFileForMap,
  encodeCityFile,
  readCityMeta,
  type SimState,
  World,
  writeCityMeta,
} from '../../sim-core/src/index.ts';
import { loadFileLikeC } from './load.ts';
import { saveFileLikeC } from './save.ts';

const CLASSIC_MAP = { width: World.WORLD_X, height: World.WORLD_Y };

// `MiscHis` indices from `saveFile`/`loadFile` in `ref/micropolis/src/sim/s_fileio.c`.
const MISC_CITY_TIME_INDEX = 8;
const MISC_TOTAL_FUNDS_INDEX = 50;
const MISC_POLICE_PERCENT_INDEX = 58;
const MISC_FIRE_PERCENT_INDEX = 60;
const MISC_ROAD_PERCENT_INDEX = 62;

// Accepted file sizes from `_load_file` in `ref/micropolis/src/sim/s_fileio.c`.
const CTY_BYTES_NORMAL = 27120;
const CTY_BYTES_DOUBLE = 99120;
const CTY_BYTES_TRIPLE = 219120;

interface PersistenceSeedCase {
  seed: number;
  cityTime: number;
  totalFunds: number;
  cityTax: number;
  simSpeed: number;
  autoBulldoze: boolean;
  autoBudget: boolean;
  autoGo: boolean;
  userSoundOn: boolean;
  policePercent: number;
  firePercent: number;
  roadPercent: number;
}

interface SeededRuntimePair {
  tsState: SimState;
  tsContext: ReturnType<typeof createSimContext>;
  oracleState: CoreOracleState;
}

interface LoadedScalarSummary {
  cityTime: number;
  totalFunds: number;
  cityTax: number;
  simSpeed: number;
  autoBulldoze: boolean;
  autoBudget: boolean;
  autoGo: boolean;
  userSoundOn: boolean;
  policePercent: number;
  firePercent: number;
  roadPercent: number;
}

/**
 * Deterministic signed history seed generator.
 * Mirrors the persisted `*His` short-array domain from `saveFile`/`loadFile`
 * in `ref/micropolis/src/sim/s_fileio.c` (1:1 value width, test-only values).
 */
function createHistory(seed: number, salt: number): Int16Array {
  const history = new Int16Array(CITY_HISTORY_LENGTH);
  for (let i = 0; i < history.length; i += 1) {
    const word = (seed * 1103 + salt * 97 + i * 53) & 0xffff;
    history[i] = word >= 0x8000 ? word - 0x10000 : word;
  }
  return history;
}

/**
 * Deterministic `MiscHis` seed generator.
 * Mirrors `MiscHis` short-array persistence in `ref/micropolis/src/sim/s_fileio.c`;
 * save packing later overwrites packed metadata slots (intentional parity behavior).
 */
function createMisc(seed: number): Int16Array {
  const misc = new Int16Array(CITY_MISC_LENGTH);
  for (let i = 0; i < misc.length; i += 1) {
    const word = (seed * 193 + i * 211) & 0xffff;
    misc[i] = word >= 0x8000 ? word - 0x10000 : word;
  }
  return misc;
}

/**
 * Deterministic map generator in x-major linear order.
 * Mirrors persisted `Map[x][y]` storage order in `ref/micropolis/src/sim/s_fileio.c`;
 * test values intentionally stay in a low tile-id range to avoid map-init side effects.
 */
function createPassiveMap(seed: number): Uint16Array {
  const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);
  for (let x = 0; x < World.WORLD_X; x += 1) {
    for (let y = 0; y < World.WORLD_Y; y += 1) {
      const index = x * World.WORLD_Y + y;
      map[index] = (seed + x * 3 + y * 5) & 0x0007;
    }
  }
  map[0] = 0x0001;
  map[1] = 0x0002;
  map[World.WORLD_Y] = 0x0003;
  map[World.WORLD_X * World.WORLD_Y - 1] = 0x0007;
  return map;
}

/**
 * Seeds equivalent TS + C runtime persistence fields.
 * Mirrors save-relevant runtime inputs consumed by `saveFile` in
 * `ref/micropolis/src/sim/s_fileio.c` (1:1 fields, test-only deterministic contents).
 */
function createSeededRuntimePair(input: PersistenceSeedCase): SeededRuntimePair {
  const tsStore = createClassicMapStore();
  const tsContext = createSimContext({ store: tsStore });
  const tsState = createSimState();
  const oracleState = runCoreOracleInitNewCity({ seed: input.seed });

  const map = createPassiveMap(input.seed);
  const resHis = createHistory(input.seed, 1);
  const comHis = createHistory(input.seed, 2);
  const indHis = createHistory(input.seed, 3);
  const crimeHis = createHistory(input.seed, 4);
  const pollutionHis = createHistory(input.seed, 5);
  const moneyHis = createHistory(input.seed, 6);
  const miscHis = createMisc(input.seed);

  tsStore.beginTick();
  try {
    (tsStore.getLayer('map') as Uint16Array).set(map);
  } finally {
    tsStore.commitTick();
  }

  tsState.ResHis.set(resHis);
  tsState.ComHis.set(comHis);
  tsState.IndHis.set(indHis);
  tsState.CrimeHis.set(crimeHis);
  tsState.PollutionHis.set(pollutionHis);
  tsState.MoneyHis.set(moneyHis);
  tsState.MiscHis.set(miscHis);

  tsState.CityTime = input.cityTime;
  tsState.TotalFunds = input.totalFunds;
  tsState.CityTax = input.cityTax;
  tsState.SimSpeed = input.simSpeed;
  tsState.autoBulldoze = input.autoBulldoze;
  tsState.autoBudget = input.autoBudget;
  tsState.autoGo = input.autoGo;
  tsState.userSoundOn = input.userSoundOn;
  tsState.policePercent = input.policePercent;
  tsState.firePercent = input.firePercent;
  tsState.roadPercent = input.roadPercent;

  oracleState.resHis.set(resHis);
  oracleState.comHis.set(comHis);
  oracleState.indHis.set(indHis);
  oracleState.crimeHis.set(crimeHis);
  oracleState.pollutionHis.set(pollutionHis);
  oracleState.moneyHis.set(moneyHis);
  oracleState.miscHis.set(miscHis);
  oracleState.map.set(map);

  oracleState.CityTime = input.cityTime;
  oracleState.TotalFunds = input.totalFunds;
  oracleState.CityTax = input.cityTax;
  oracleState.SimSpeed = input.simSpeed;
  oracleState.autoBulldoze = input.autoBulldoze ? 1 : 0;
  oracleState.autoBudget = input.autoBudget ? 1 : 0;
  oracleState.autoGo = input.autoGo ? 1 : 0;
  oracleState.UserSoundOn = input.userSoundOn ? 1 : 0;
  oracleState.policePercent = input.policePercent;
  oracleState.firePercent = input.firePercent;
  oracleState.roadPercent = input.roadPercent;

  return { tsState, tsContext, oracleState };
}

/**
 * Temporary `.cty` path wrapper around the oracle path-based load command.
 * Wraps headless `load-cty --cty-path` from `packages/micropolis-c-harness/core/core_oracle.c`
 * (intentional test-only filesystem indirection).
 */
function withTempCtyPath<T>(cityBytes: Uint8Array, run: (ctyPath: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'sim-io-parity-'));
  const ctyPath = path.join(dir, 'case.cty');
  writeFileSync(ctyPath, cityBytes);

  try {
    return run(ctyPath);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * Loads `.cty` bytes through the C oracle loader.
 * Mirrors `loadFile` normalization rules in `ref/micropolis/src/sim/s_fileio.c`
 * via headless `load-cty` (1:1 loader semantics; temporary file is intentional).
 */
function loadOracleFromBytes(cityBytes: Uint8Array, seed: number): CoreOracleState {
  return withTempCtyPath(cityBytes, (ctyPath) =>
    runCoreOracleLoadCty({
      state: runCoreOracleInitNewCity({ seed }),
      ctyPath,
    }),
  );
}

/**
 * Reads packed big-endian `MiscHis` int32 fields directly from encoded `.cty` bytes.
 * Mirrors `MiscHis` short packing in `saveFile` from `ref/micropolis/src/sim/s_fileio.c`.
 */
function readMiscI32FromCityBytes(cityBytes: Uint8Array, index: number): number {
  const view = new DataView(cityBytes.buffer, cityBytes.byteOffset, cityBytes.byteLength);
  const miscOffset = CITY_HISTORY_LENGTH * 6 * 2;
  return view.getInt32(miscOffset + index * 2, false);
}

/**
 * Extracts loader-normalized scalar fields from C oracle state.
 * Mirrors `loadFile` scalar destinations in `ref/micropolis/src/sim/s_fileio.c`.
 */
function summarizeOracleLoadedScalars(state: CoreOracleState): LoadedScalarSummary {
  return {
    cityTime: state.CityTime,
    totalFunds: state.TotalFunds,
    cityTax: state.CityTax,
    simSpeed: state.SimSpeed,
    autoBulldoze: state.autoBulldoze !== 0,
    autoBudget: state.autoBudget !== 0,
    autoGo: state.autoGo !== 0,
    userSoundOn: state.UserSoundOn !== 0,
    policePercent: state.policePercent,
    firePercent: state.firePercent,
    roadPercent: state.roadPercent,
  };
}

/**
 * Extracts loader-normalized scalar fields from TS runtime state.
 * Mirrors `loadFileLikeC` scalar destinations in `packages/sim-io/src/load.ts`.
 */
function summarizeTsLoadedScalars(state: SimState): LoadedScalarSummary {
  return {
    cityTime: state.CityTime,
    totalFunds: state.TotalFunds,
    cityTax: state.CityTax,
    simSpeed: state.SimSpeed,
    autoBulldoze: state.autoBulldoze,
    autoBudget: state.autoBudget,
    autoGo: state.autoGo,
    userSoundOn: state.userSoundOn,
    policePercent: state.policePercent,
    firePercent: state.firePercent,
    roadPercent: state.roadPercent,
  };
}

/**
 * Builds expected normalized load scalars from encoded `.cty` metadata.
 * Mirrors `loadFile` normalization + `InitFundingLevel()` in
 * `ref/micropolis/src/sim/s_fileio.c` (1:1 expected values).
 */
function expectedLoadedScalarsFromCityBytes(cityBytes: Uint8Array): LoadedScalarSummary {
  const city = decodeCityFileForMap(cityBytes, CLASSIC_MAP);
  const normalized = applyLoadNormalization(readCityMeta(city.misc));

  return {
    cityTime: normalized.cityTime,
    totalFunds: normalized.totalFunds,
    cityTax: normalized.cityTax,
    simSpeed: normalized.simSpeed,
    autoBulldoze: normalized.autoBulldoze,
    autoBudget: normalized.autoBudget,
    autoGo: normalized.autoGo,
    userSoundOn: normalized.userSoundOn,
    policePercent: normalized.policePercent,
    firePercent: normalized.firePercent,
    roadPercent: normalized.roadPercent,
  };
}

/**
 * Asserts C oracle loaded map/history buffers match decoded `.cty` payload.
 * Mirrors `_load_file` raw array assignment targets in
 * `ref/micropolis/src/sim/s_fileio.c` (1:1 array comparison).
 */
function expectOracleArraysMatchCity(state: CoreOracleState, cityBytes: Uint8Array): void {
  const city = decodeCityFileForMap(cityBytes, CLASSIC_MAP);
  expect(state.resHis).toEqual(city.histories.res);
  expect(state.comHis).toEqual(city.histories.com);
  expect(state.indHis).toEqual(city.histories.ind);
  expect(state.crimeHis).toEqual(city.histories.crime);
  expect(state.pollutionHis).toEqual(city.histories.pollution);
  expect(state.moneyHis).toEqual(city.histories.money);
  expect(state.miscHis).toEqual(city.misc);
  expect(state.map).toEqual(city.map);
}

/**
 * Asserts TS loaded map/history buffers match decoded `.cty` payload.
 * Mirrors `loadFileLikeC` copy behavior in `packages/sim-io/src/load.ts`:
 * `city.*` is direct decode output; state histories are copied into runtime arrays.
 */
function expectTsArraysMatchCity(state: SimState, cityBytes: Uint8Array): void {
  const city = decodeCityFileForMap(cityBytes, CLASSIC_MAP);
  expect(state.ResHis).toEqual(city.histories.res);
  expect(state.ComHis).toEqual(city.histories.com);
  expect(state.IndHis).toEqual(city.histories.ind);
  expect(state.CrimeHis).toEqual(city.histories.crime);
  expect(state.PollutionHis).toEqual(city.histories.pollution);
  expect(state.MoneyHis).toEqual(city.histories.money);
  expect(state.MiscHis).toEqual(city.misc);
}

/**
 * Builds deterministic `.cty` bytes for a specific supported map size.
 * Mirrors file-size variants accepted by `_load_file` in
 * `ref/micropolis/src/sim/s_fileio.c` (1:1 sizes, test-only deterministic content).
 */
function createSizedCityBytes(width: number, height: number, seed: number): Uint8Array {
  const city = createCityFile({ width, height });

  city.histories.res.set(createHistory(seed, 1));
  city.histories.com.set(createHistory(seed, 2));
  city.histories.ind.set(createHistory(seed, 3));
  city.histories.crime.set(createHistory(seed, 4));
  city.histories.pollution.set(createHistory(seed, 5));
  city.histories.money.set(createHistory(seed, 6));

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      city.map[x * height + y] = (x * 17 + y * 29 + seed) & 0xffff;
    }
  }

  writeCityMeta(city.misc, {
    cityTime: -17,
    totalFunds: 0x7ffffffe,
    autoBulldoze: true,
    autoBudget: false,
    autoGo: true,
    userSoundOn: false,
    cityTax: 999,
    simSpeed: -7,
    policePercent: 0.25,
    firePercent: 0.5,
    roadPercent: 0.75,
  });

  return encodeCityFile(city);
}

describe('persistence round-trip parity with C oracle', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm --filter @city/sim-io test-parity` to enable persistence round-trip parity checks', () => {});
    return;
  }

  it('loads TS-saved bytes in C with matching normalized state and raw map/history payloads', () => {
    const seeded = createSeededRuntimePair({
      seed: 0x0011aa22,
      cityTime: -2147483648,
      totalFunds: 2147483647,
      cityTax: 99,
      simSpeed: -1,
      autoBulldoze: true,
      autoBudget: false,
      autoGo: true,
      userSoundOn: false,
      policePercent: 0.1,
      firePercent: -0.1,
      roadPercent: 1.99999,
    });

    const tsBytes = saveFileLikeC(seeded.tsState, seeded.tsContext).cityBytes;

    // `saveFile` packs signed 32-bit CityTime/Funds into `MiscHis[8..9]` and `[50..51]`.
    expect(readMiscI32FromCityBytes(tsBytes, MISC_CITY_TIME_INDEX)).toBe(-2147483648);
    expect(readMiscI32FromCityBytes(tsBytes, MISC_TOTAL_FUNDS_INDEX)).toBe(2147483647);

    // `saveFile` stores funding percents as 16.16 fixed-point via cast truncation.
    expect(readMiscI32FromCityBytes(tsBytes, MISC_POLICE_PERCENT_INDEX)).toBe(
      Math.trunc(seeded.tsState.policePercent * 65536),
    );
    expect(readMiscI32FromCityBytes(tsBytes, MISC_FIRE_PERCENT_INDEX)).toBe(
      Math.trunc(seeded.tsState.firePercent * 65536),
    );
    expect(readMiscI32FromCityBytes(tsBytes, MISC_ROAD_PERCENT_INDEX)).toBe(
      Math.trunc(seeded.tsState.roadPercent * 65536),
    );

    const oracleAfterLoad = loadOracleFromBytes(tsBytes, 0x00442211);
    const expected = expectedLoadedScalarsFromCityBytes(tsBytes);
    expect(summarizeOracleLoadedScalars(oracleAfterLoad)).toEqual(expected);

    // `InitFundingLevel()` in C resets loaded percents to 1.0.
    expect(oracleAfterLoad.policePercent).toBe(1);
    expect(oracleAfterLoad.firePercent).toBe(1);
    expect(oracleAfterLoad.roadPercent).toBe(1);

    expectOracleArraysMatchCity(oracleAfterLoad, tsBytes);
  });

  it('loads C-saved bytes in TS with matching normalized state and raw map/history payloads', () => {
    const seeded = createSeededRuntimePair({
      seed: 0x000abcde,
      cityTime: 123456,
      totalFunds: 654321,
      cityTax: -99,
      simSpeed: 99,
      autoBulldoze: false,
      autoBudget: true,
      autoGo: false,
      userSoundOn: true,
      policePercent: -0.3333,
      firePercent: 0.3333,
      roadPercent: 1.25,
    });

    const cBytes = runCoreOracleSaveCty({ state: seeded.oracleState });

    // `saveFile` packs signed 32-bit CityTime/Funds into `MiscHis[8..9]` and `[50..51]`.
    expect(readMiscI32FromCityBytes(cBytes, MISC_CITY_TIME_INDEX)).toBe(123456);
    expect(readMiscI32FromCityBytes(cBytes, MISC_TOTAL_FUNDS_INDEX)).toBe(654321);

    // `saveFile` stores funding percents as 16.16 fixed-point via cast truncation.
    expect(readMiscI32FromCityBytes(cBytes, MISC_POLICE_PERCENT_INDEX)).toBe(
      Math.trunc(seeded.oracleState.policePercent * 65536),
    );
    expect(readMiscI32FromCityBytes(cBytes, MISC_FIRE_PERCENT_INDEX)).toBe(
      Math.trunc(seeded.oracleState.firePercent * 65536),
    );
    expect(readMiscI32FromCityBytes(cBytes, MISC_ROAD_PERCENT_INDEX)).toBe(
      Math.trunc(seeded.oracleState.roadPercent * 65536),
    );

    const tsState = createSimState();
    const tsContext = createSimContext({ store: createClassicMapStore() });
    loadFileLikeC(tsState, tsContext, cBytes);

    const expected = expectedLoadedScalarsFromCityBytes(cBytes);
    expect(summarizeTsLoadedScalars(tsState)).toEqual(expected);

    // `InitFundingLevel()` in C resets loaded percents to 1.0.
    expect(tsState.policePercent).toBe(1);
    expect(tsState.firePercent).toBe(1);
    expect(tsState.roadPercent).toBe(1);

    expectTsArraysMatchCity(tsState, cBytes);

    const oracleAfterLoad = loadOracleFromBytes(cBytes, 0x00fedcba);
    expect(summarizeTsLoadedScalars(tsState)).toEqual(
      summarizeOracleLoadedScalars(oracleAfterLoad),
    );
  });

  it('packs boundary signed 32-bit CityTime and TotalFunds values identically in TS and C', () => {
    const seeded = createSeededRuntimePair({
      seed: 0x00123456,
      cityTime: 2147483647,
      totalFunds: -2147483648,
      cityTax: 7,
      simSpeed: 3,
      autoBulldoze: false,
      autoBudget: false,
      autoGo: false,
      userSoundOn: false,
      policePercent: 1,
      firePercent: 1,
      roadPercent: 1,
    });

    const tsBytes = saveFileLikeC(seeded.tsState, seeded.tsContext).cityBytes;
    const cBytes = runCoreOracleSaveCty({ state: seeded.oracleState });
    expect(cBytes).toEqual(tsBytes);

    // `saveFile` stores signed 32-bit values in `MiscHis[8..9]` and `[50..51]`.
    expect(readMiscI32FromCityBytes(cBytes, MISC_CITY_TIME_INDEX)).toBe(2147483647);
    expect(readMiscI32FromCityBytes(cBytes, MISC_TOTAL_FUNDS_INDEX)).toBe(-2147483648);
  });

  it('stabilizes on deterministic TS->C->TS round-trip bytes', () => {
    const seeded = createSeededRuntimePair({
      seed: 0x0055aa55,
      cityTime: 123456,
      totalFunds: 7654321,
      cityTax: 9,
      simSpeed: 2,
      autoBulldoze: true,
      autoBudget: true,
      autoGo: false,
      userSoundOn: true,
      policePercent: 1,
      firePercent: 1,
      roadPercent: 1,
    });

    const tsStartBytes = saveFileLikeC(seeded.tsState, seeded.tsContext).cityBytes;
    const oracleAfterLoad = loadOracleFromBytes(tsStartBytes, 0x0055aa55);
    const cBytes = runCoreOracleSaveCty({ state: oracleAfterLoad });

    const tsStateAfter = createSimState();
    const tsContextAfter = createSimContext({ store: createClassicMapStore() });
    loadFileLikeC(tsStateAfter, tsContextAfter, cBytes);
    const tsEndBytes = saveFileLikeC(tsStateAfter, tsContextAfter).cityBytes;

    expect(cBytes).toEqual(tsStartBytes);
    expect(tsEndBytes).toEqual(cBytes);
    expect(tsEndBytes).toEqual(tsStartBytes);
  });

  it('stabilizes on deterministic C->TS->C round-trip bytes', () => {
    const seeded = createSeededRuntimePair({
      seed: 0x00aa55aa,
      cityTime: 0x01020304,
      totalFunds: 0x0badf00d,
      cityTax: 7,
      simSpeed: 3,
      autoBulldoze: false,
      autoBudget: true,
      autoGo: true,
      userSoundOn: false,
      policePercent: 1,
      firePercent: 1,
      roadPercent: 1,
    });

    const cStartBytes = runCoreOracleSaveCty({ state: seeded.oracleState });

    const tsState = createSimState();
    const tsContext = createSimContext({ store: createClassicMapStore() });
    loadFileLikeC(tsState, tsContext, cStartBytes);
    const tsBytes = saveFileLikeC(tsState, tsContext).cityBytes;

    const oracleAfterLoad = loadOracleFromBytes(tsBytes, 0x00aa55aa);
    const cEndBytes = runCoreOracleSaveCty({ state: oracleAfterLoad });

    expect(tsBytes).toEqual(cStartBytes);
    expect(cEndBytes).toEqual(tsBytes);
    expect(cEndBytes).toEqual(cStartBytes);
  });

  it('matches C and TS load behavior for 27120/99120/219120 city file sizes', () => {
    // Exact byte sizes accepted by `_load_file` in `ref/micropolis/src/sim/s_fileio.c`.
    const sizes = [
      { width: 120, height: 100, byteLength: CTY_BYTES_NORMAL, seed: 11 },
      { width: 240, height: 200, byteLength: CTY_BYTES_DOUBLE, seed: 22 },
      { width: 360, height: 300, byteLength: CTY_BYTES_TRIPLE, seed: 33 },
    ];

    for (const item of sizes) {
      const cityBytes = createSizedCityBytes(item.width, item.height, item.seed);
      expect(cityBytes.byteLength).toBe(item.byteLength);

      const oracleAfterLoad = loadOracleFromBytes(cityBytes, 0x0012_3400 + item.seed);
      const tsState = createSimState();
      const tsContext = createSimContext({ store: createClassicMapStore() });
      loadFileLikeC(tsState, tsContext, cityBytes);

      const expected = expectedLoadedScalarsFromCityBytes(cityBytes);
      expect(summarizeOracleLoadedScalars(oracleAfterLoad)).toEqual(expected);
      expect(summarizeTsLoadedScalars(tsState)).toEqual(expected);

      expectOracleArraysMatchCity(oracleAfterLoad, cityBytes);
      expectTsArraysMatchCity(tsState, cityBytes);
    }
  });
});
