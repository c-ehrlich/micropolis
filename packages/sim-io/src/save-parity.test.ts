import { describe, expect, it } from 'vitest';

import {
  type CoreOracleState,
  runCoreOracleInitNewCity,
  runCoreOracleSaveCty,
} from '../../micropolis-c-harness/src/core-parity.ts';
import {
  CITY_FILE_HEADER_BYTES,
  CITY_HISTORY_LENGTH,
  CITY_MISC_LENGTH,
  createClassicMapStore,
  createSimContext,
  createSimState,
  type SimState,
  World,
} from '../../sim-core/src/index.ts';
import { saveFileLikeC } from './save.ts';

interface SaveParityCase {
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

interface SeededStatePair {
  tsState: SimState;
  tsContext: ReturnType<typeof createSimContext>;
  oracleState: CoreOracleState;
  map: Uint16Array;
}

/**
 * Generate deterministic signed 16-bit history data.
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
 * Generate deterministic `MiscHis` seed data before C-style save packing overwrites.
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
 * Generate deterministic x-major map words (`Map[x][y]` memory order in C).
 */
function createMap(seed: number): Uint16Array {
  const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);
  for (let x = 0; x < World.WORLD_X; x += 1) {
    for (let y = 0; y < World.WORLD_Y; y += 1) {
      const index = x * World.WORLD_Y + y;
      const tileId = (x * 251 + y * 17 + seed * 13) & 0x03ff;
      const pwr = (x + y + seed) % 5 === 0 ? 0x8000 : 0;
      const cond = (x * 3 + y + seed) % 7 === 0 ? 0x4000 : 0;
      map[index] = (tileId | pwr | cond) & 0xffff;
    }
  }

  // Distinct sentinels to make map ordering/layout assertions explicit.
  map[0] = 0x1001;
  map[1] = 0x2002;
  map[World.WORLD_Y] = 0x3003;
  map[World.WORLD_X * World.WORLD_Y - 1] = 0x7ffe;
  return map;
}

/**
 * Seed the same save-relevant state/map buffers in TS and the C oracle.
 */
function createSeededStatePair(input: SaveParityCase): SeededStatePair {
  const tsStore = createClassicMapStore();
  const tsContext = createSimContext({ store: tsStore });
  const tsState = createSimState();
  const oracleState = runCoreOracleInitNewCity({ seed: input.seed });

  const map = createMap(input.seed);
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

  return { tsState, tsContext, oracleState, map };
}

describe('save byte parity with C oracle', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm --filter @city/sim-io test-parity` to enable save byte parity checks', () => {});
    return;
  }

  it('matches full .cty bytes for deterministic seeded state/map buffers', () => {
    const seeded = createSeededStatePair({
      seed: 1337,
      cityTime: 0x10203040,
      totalFunds: 0x1234abcd,
      cityTax: 9,
      simSpeed: 2,
      autoBulldoze: true,
      autoBudget: false,
      autoGo: true,
      userSoundOn: false,
      policePercent: 1.25,
      firePercent: 0.5,
      roadPercent: -0.75,
    });

    const tsBytes = saveFileLikeC(seeded.tsState, seeded.tsContext).cityBytes;
    const oracleBytes = runCoreOracleSaveCty({ state: seeded.oracleState });

    expect(tsBytes).toEqual(oracleBytes);
  });

  it('matches signed 32-bit packing for CityTime and TotalFunds', () => {
    const seeded = createSeededStatePair({
      seed: 77,
      cityTime: -19088743,
      totalFunds: -2147480000,
      cityTax: 11,
      simSpeed: 1,
      autoBulldoze: false,
      autoBudget: true,
      autoGo: false,
      userSoundOn: true,
      policePercent: 1,
      firePercent: 1,
      roadPercent: 1,
    });

    const tsBytes = saveFileLikeC(seeded.tsState, seeded.tsContext).cityBytes;
    const oracleBytes = runCoreOracleSaveCty({ state: seeded.oracleState });
    expect(tsBytes).toEqual(oracleBytes);

    const view = new DataView(tsBytes.buffer, tsBytes.byteOffset, tsBytes.byteLength);
    // Magic offsets from C `saveFile` in `ref/micropolis/src/sim/s_fileio.c`:
    // `MiscHis[8..9]` stores `CityTime`, `MiscHis[50..51]` stores `TotalFunds`.
    // `MiscHis` starts at `6 * HISTLEN` bytes (6 * 480 = 2880).
    const miscOffset = CITY_HISTORY_LENGTH * 6 * 2;
    expect(view.getInt32(miscOffset + 8 * 2, false)).toBe(seeded.tsState.CityTime | 0);
    expect(view.getInt32(miscOffset + 50 * 2, false)).toBe(seeded.tsState.TotalFunds | 0);
  });

  it('matches fixed-point percent truncation using value * 65536', () => {
    const seeded = createSeededStatePair({
      seed: 9001,
      cityTime: 12345,
      totalFunds: 54321,
      cityTax: 7,
      simSpeed: 3,
      autoBulldoze: true,
      autoBudget: true,
      autoGo: true,
      userSoundOn: true,
      policePercent: 0.1,
      firePercent: -0.1,
      roadPercent: 1.99999,
    });

    const tsBytes = saveFileLikeC(seeded.tsState, seeded.tsContext).cityBytes;
    const oracleBytes = runCoreOracleSaveCty({ state: seeded.oracleState });
    expect(tsBytes).toEqual(oracleBytes);

    const view = new DataView(tsBytes.buffer, tsBytes.byteOffset, tsBytes.byteLength);
    // C `saveFile` writes `(*Percent * 65536)` into `MiscHis[58..63]`
    // using cast-to-int truncation (`ref/micropolis/src/sim/s_fileio.c`).
    const miscOffset = CITY_HISTORY_LENGTH * 6 * 2;
    expect(view.getInt32(miscOffset + 58 * 2, false)).toBe(
      Math.trunc(seeded.tsState.policePercent * 65536),
    );
    expect(view.getInt32(miscOffset + 60 * 2, false)).toBe(
      Math.trunc(seeded.tsState.firePercent * 65536),
    );
    expect(view.getInt32(miscOffset + 62 * 2, false)).toBe(
      Math.trunc(seeded.tsState.roadPercent * 65536),
    );
  });

  it('matches C map ordering/layout offsets (x-major Map[x][y])', () => {
    const seeded = createSeededStatePair({
      seed: 2024,
      cityTime: 200,
      totalFunds: 300,
      cityTax: 10,
      simSpeed: 2,
      autoBulldoze: true,
      autoBudget: true,
      autoGo: false,
      userSoundOn: false,
      policePercent: 1,
      firePercent: 1,
      roadPercent: 1,
    });

    const tsBytes = saveFileLikeC(seeded.tsState, seeded.tsContext).cityBytes;
    const oracleBytes = runCoreOracleSaveCty({ state: seeded.oracleState });
    expect(tsBytes).toEqual(oracleBytes);

    const view = new DataView(tsBytes.buffer, tsBytes.byteOffset, tsBytes.byteLength);
    // `CITY_FILE_HEADER_BYTES` matches C save layout:
    // 6 history arrays + `MiscHis`, then `_save_short((&Map[0][0]), WORLD_X * WORLD_Y, f)`.
    // See `saveFile` in `ref/micropolis/src/sim/s_fileio.c`.
    expect(view.getUint16(CITY_FILE_HEADER_BYTES, false)).toBe(0x1001);
    expect(view.getUint16(CITY_FILE_HEADER_BYTES + 2, false)).toBe(0x2002);
    expect(view.getUint16(CITY_FILE_HEADER_BYTES + World.WORLD_Y * 2, false)).toBe(0x3003);

    const sampleX = 17;
    const sampleY = 42;
    const sampleIndex = sampleX * World.WORLD_Y + sampleY;
    const sampleOffset = CITY_FILE_HEADER_BYTES + sampleIndex * 2;
    expect(view.getUint16(sampleOffset, false)).toBe(seeded.map[sampleIndex] ?? 0);
  });
});
