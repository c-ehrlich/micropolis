import { describe, expect, it, vi } from 'vitest';

import { PowerMap, Tile, TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { CITY_HISTORY_LENGTH, CITY_MISC_LENGTH } from '../io/cty.ts';
import { hashInt16, hashMap, hashScalars, hashUint16, mixHashes } from '../io/hash.ts';
import {
  doNilPower,
  doSimInit,
  initMapArrays,
  initSimMemory,
  initWillStuff,
  simLoadInit,
} from './init.ts';

const { WORLD_Y } = World;
const { POWERMAPROW, PWRMAPSIZE } = PowerMap;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

describe('initMapArrays', () => {
  it('zeros all layers in the map store', () => {
    const store = createClassicMapStore();
    store.beginTick();
    store.write('map', indexFor(1, 1), 123);
    store.write('power', 0, 0xffff);
    store.write('popDensity', 0, 7);
    store.write('rateOGMem', 0, -9);
    store.commitTick();

    initMapArrays(store);

    const map = store.snapshot('map') as Uint16Array;
    const power = store.snapshot('power') as Uint16Array;
    const pop = store.snapshot('popDensity') as Uint8Array;
    const rog = store.snapshot('rateOGMem') as Int16Array;

    expect(map[indexFor(1, 1)]).toBe(0);
    expect(power[0]).toBe(0);
    expect(pop[0]).toBe(0);
    expect(rog[0]).toBe(0);
  });
});

describe('initWillStuff', () => {
  it('resets state defaults, clears derived maps, and fires hooks', () => {
    const store = createClassicMapStore();
    const hooks = {
      destroyAllSprites: vi.fn(),
      doUpdateHeads: vi.fn(),
    };
    const context = createSimContext({ store, rng: createRng(1), hooks });
    const state = createSimState();

    state.RoadEffect = 0;
    state.PoliceEffect = 0;
    state.FireEffect = 0;
    state.CityScore = 1;
    state.CityPop = 42;
    state.LastCityTime = 99;
    state.LastCityYear = 99;
    state.LastCityMonth = 99;
    state.LastFunds = 99;
    state.RoadFund = 55;
    state.PoliceFund = 66;
    state.FireFund = 77;
    state.ValveFlag = 0;
    state.DisasterEvent = 3;
    state.TaxFlag = 1;

    store.beginTick();
    store.write('popDensity', 0, 3);
    store.write('rateOGMem', 0, -7);
    store.commitTick();

    initWillStuff(context, state, { seed: 123 });

    expect(state.RoadEffect).toBe(32);
    expect(state.PoliceEffect).toBe(1000);
    expect(state.FireEffect).toBe(1000);
    expect(state.CityScore).toBe(500);
    expect(state.CityPop).toBe(-1);
    // InitWillStuff calls DoUpdateHeads in the C codebase; updateDate uses CityTime/48 and (CityTime % 48)/4.
    // With default CityTime=50, LastCityTime=50/4=12, year=1901, month=0.
    expect(state.LastCityTime).toBe(12);
    expect(state.LastCityYear).toBe(1901);
    expect(state.LastCityMonth).toBe(0);
    // w_update.c: UpdateHeads() initializes MustUpdateFunds=1 and resets LastFunds; the subsequent
    // DoUpdateHeads() call runs ReallyUpdateFunds(), which sets LastFunds to TotalFunds.
    expect(state.LastFunds).toBe(state.TotalFunds);
    expect(state.RoadFund).toBe(0);
    expect(state.PoliceFund).toBe(0);
    expect(state.FireFund).toBe(0);
    // w_update.c: UpdateHeads() sets ValveFlag=1 before DoUpdateHeads(); showValves() clears it.
    expect(state.ValveFlag).toBe(0);
    expect(state.DisasterEvent).toBe(0);
    expect(state.TaxFlag).toBe(0);

    const pop = store.snapshot('popDensity') as Uint8Array;
    const rog = store.snapshot('rateOGMem') as Int16Array;
    expect(pop[0]).toBe(0);
    expect(rog[0]).toBe(0);

    expect(hooks.destroyAllSprites).toHaveBeenCalledOnce();
    expect(hooks.doUpdateHeads).toHaveBeenCalledOnce();
  });

  it('clears all derived layers listed in the spec', () => {
    const store = createClassicMapStore();
    const context = createSimContext({ store, rng: createRng(1) });
    const state = createSimState();

    store.beginTick();
    store.write('popDensity', 0, 7);
    store.write('trfDensity', 0, 9);
    store.write('pollutionMem', 0, 11);
    store.write('landValueMem', 0, 13);
    store.write('crimeMem', 0, 15);
    store.write('terrainMem', 0, 17);
    store.write('rateOGMem', 0, -19);
    store.write('fireRate', 0, 21);
    store.write('comRate', 0, 23);
    store.write('policeMap', 0, 25);
    store.write('policeMapEffect', 0, 27);
    store.write('fireStMap', 0, 29);
    store.commitTick();

    initWillStuff(context, state, { seed: 123 });

    expect((store.snapshot('popDensity') as Uint8Array)[0]).toBe(0);
    expect((store.snapshot('trfDensity') as Uint8Array)[0]).toBe(0);
    expect((store.snapshot('pollutionMem') as Uint8Array)[0]).toBe(0);
    expect((store.snapshot('landValueMem') as Uint8Array)[0]).toBe(0);
    expect((store.snapshot('crimeMem') as Uint8Array)[0]).toBe(0);
    expect((store.snapshot('terrainMem') as Uint8Array)[0]).toBe(0);
    expect((store.snapshot('rateOGMem') as Int16Array)[0]).toBe(0);
    expect((store.snapshot('fireRate') as Int16Array)[0]).toBe(0);
    expect((store.snapshot('comRate') as Int16Array)[0]).toBe(0);
    expect((store.snapshot('policeMap') as Int16Array)[0]).toBe(0);
    expect((store.snapshot('policeMapEffect') as Int16Array)[0]).toBe(0);
    expect((store.snapshot('fireStMap') as Int16Array)[0]).toBe(0);
  });
});

describe('initSimMemory', () => {
  it('produces the expected new-city state hash', () => {
    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();

    state.ResHis.fill(9);
    state.ComHis.fill(9);
    state.IndHis.fill(9);
    state.MoneyHis.fill(9);
    state.CrimeHis.fill(9);
    state.PollutionHis.fill(9);
    state.CrimeRamp = 7;
    state.PolluteRamp = 11;
    state.TotalPop = 1234;
    state.RValve = 5;
    state.CValve = -6;
    state.IValve = 9;
    state.ResCap = 9;
    state.ComCap = 9;
    state.IndCap = 9;
    state.EMarket = 2;
    state.DisasterEvent = 4;
    state.ScoreType = 5;
    state.RoadEffect = 0;
    state.PoliceEffect = 0;
    state.FireEffect = 0;
    state.TaxFlag = 1;
    state.TaxFund = 99;
    state.NewPower = 0;
    state.InitSimLoad = 2;

    let powerScanCalls = 0;
    initSimMemory(context, state, {
      doPowerScan: () => {
        powerScanCalls += 1;
      },
    });

    const expectedRes = new Int16Array(CITY_HISTORY_LENGTH);
    const expectedCom = new Int16Array(CITY_HISTORY_LENGTH);
    const expectedInd = new Int16Array(CITY_HISTORY_LENGTH);
    const expectedMoney = new Int16Array(CITY_HISTORY_LENGTH).fill(128);
    const expectedCrime = new Int16Array(CITY_HISTORY_LENGTH);
    const expectedPollution = new Int16Array(CITY_HISTORY_LENGTH);

    const expectedScalars = [
      0, // CrimeRamp
      0, // PolluteRamp
      0, // TotalPop
      0, // RValve
      0, // CValve
      0, // IValve
      0, // ResCap
      0, // ComCap
      0, // IndCap
      6, // EMarket
      0, // DisasterEvent
      0, // ScoreType
      32, // RoadEffect
      1000, // PoliceEffect
      1000, // FireEffect
      0, // TaxFlag
      0, // TaxFund
      1, // NewPower
      0, // InitSimLoad
    ];

    const expectedHash = mixHashes(
      hashInt16(expectedRes),
      hashInt16(expectedCom),
      hashInt16(expectedInd),
      hashInt16(expectedMoney),
      hashInt16(expectedCrime),
      hashInt16(expectedPollution),
      hashScalars(expectedScalars),
    );

    const actualHash = mixHashes(
      hashInt16(state.ResHis),
      hashInt16(state.ComHis),
      hashInt16(state.IndHis),
      hashInt16(state.MoneyHis),
      hashInt16(state.CrimeHis),
      hashInt16(state.PollutionHis),
      hashScalars([
        state.CrimeRamp,
        state.PolluteRamp,
        state.TotalPop,
        state.RValve,
        state.CValve,
        state.IValve,
        state.ResCap,
        state.ComCap,
        state.IndCap,
        state.EMarket,
        state.DisasterEvent,
        state.ScoreType,
        state.RoadEffect,
        state.PoliceEffect,
        state.FireEffect,
        state.TaxFlag,
        state.TaxFund,
        state.NewPower,
        state.InitSimLoad,
      ]),
    );

    expect(actualHash).toBe(expectedHash);
    expect(powerScanCalls).toBe(1);
  });
});

describe('simLoadInit', () => {
  it('produces the expected loaded-city state hash', () => {
    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();

    state.MiscHis = new Int16Array(CITY_MISC_LENGTH);
    state.MiscHis[1] = 0;
    state.MiscHis[2] = 123;
    state.MiscHis[3] = 45;
    state.MiscHis[4] = 67;
    state.MiscHis[5] = 111;
    state.MiscHis[6] = 222;
    state.MiscHis[7] = 333;
    state.MiscHis[10] = 12;
    state.MiscHis[11] = 34;
    state.MiscHis[12] = 56;
    state.MiscHis[13] = 78;
    state.MiscHis[14] = 90;
    state.MiscHis[15] = 5;
    state.MiscHis[16] = 7;
    state.MiscHis[17] = 0;

    state.CityTime = -10;
    state.ScenarioID = 4;
    state.ResCap = 9;
    state.ComCap = 9;
    state.IndCap = 9;
    state.RoadEffect = 9;
    state.PoliceEffect = 9;
    state.FireEffect = 9;
    state.TaxFlag = 1;
    state.TaxFund = 99;

    const tileA = Tile.RESBASE | TileFlag.ZONEBIT;
    const tileB = Tile.RESBASE | TileFlag.ZONEBIT;
    const indexA = indexFor(2, 3);
    const indexB = indexFor(4, 5);

    store.beginTick();
    store.write('map', indexA, tileA);
    store.write('map', indexB, tileB);
    simLoadInit(context, state);
    store.commitTick();

    const map = store.snapshot('map') as Uint16Array;
    const power = store.snapshot('power') as Uint16Array;

    const expectedMap = new Uint16Array(World.WORLD_X * World.WORLD_Y);
    expectedMap[indexA] = tileA | TileFlag.PWRBIT;
    expectedMap[indexB] = tileB | TileFlag.PWRBIT;

    const expectedPower = new Uint16Array(PWRMAPSIZE);
    expectedPower.fill(0xffff);

    const expectedScalars = [
      0, // CityTime
      4, // EMarket
      123, // ResPop
      45, // ComPop
      67, // IndPop
      111, // RValve
      222, // CValve
      333, // IValve
      12, // CrimeRamp
      34, // PolluteRamp
      56, // LVAverage
      78, // CrimeAverage
      90, // PolluteAverage
      0, // GameLevel
      0, // CityClass
      500, // CityScore
      0, // ResCap
      0, // ComCap
      0, // IndCap
      0, // AvCityTax
      4, // DisasterEvent
      20, // DisasterWait
      4, // ScoreType
      480, // ScoreWait
      32, // RoadEffect
      1000, // PoliceEffect
      1000, // FireEffect
      0, // TaxFlag
      0, // TaxFund
      0, // InitSimLoad
      4, // ScenarioID
    ];

    const expectedHash = mixHashes(
      hashScalars(expectedScalars),
      hashUint16(expectedPower),
      hashMap(expectedMap),
    );
    const actualHash = mixHashes(
      hashScalars([
        state.CityTime,
        state.EMarket,
        state.ResPop,
        state.ComPop,
        state.IndPop,
        state.RValve,
        state.CValve,
        state.IValve,
        state.CrimeRamp,
        state.PolluteRamp,
        state.LVAverage,
        state.CrimeAverage,
        state.PolluteAverage,
        state.GameLevel,
        state.CityClass,
        state.CityScore,
        state.ResCap,
        state.ComCap,
        state.IndCap,
        state.AvCityTax,
        state.DisasterEvent,
        state.DisasterWait,
        state.ScoreType,
        state.ScoreWait,
        state.RoadEffect,
        state.PoliceEffect,
        state.FireEffect,
        state.TaxFlag,
        state.TaxFund,
        state.InitSimLoad,
        state.ScenarioID,
      ]),
      hashUint16(power),
      hashMap(map),
    );

    expect(actualHash).toBe(expectedHash);
  });

  it('clamps ScenarioID and calls setGameLevel with the normalized value', () => {
    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();

    state.MiscHis = new Int16Array(CITY_MISC_LENGTH);
    state.MiscHis[15] = 9;
    state.CityTime = 10;
    state.ScenarioID = 12;

    store.beginTick();
    const setGameLevel = vi.fn();
    simLoadInit(context, state, { setGameLevel });
    store.commitTick();

    expect(state.GameLevel).toBe(0);
    expect(setGameLevel).toHaveBeenCalledOnce();
    expect(setGameLevel).toHaveBeenCalledWith(0);
    expect(state.ScenarioID).toBe(0);
    expect(state.DisasterEvent).toBe(0);
    expect(state.ScoreType).toBe(0);
    expect(state.DisasterWait).toBe(0);
    expect(state.ScoreWait).toBe(0);
  });
});

describe('doNilPower', () => {
  it('sets power bits based on the power map and plant tiles', () => {
    const store = createClassicMapStore();
    const context = createSimContext({ store });

    const powered = { x: 5, y: 6 };
    const unpowered = { x: 6, y: 6 };
    const plant = { x: 7, y: 6 };
    const nuclear = { x: 8, y: 6 };

    const zoneTile = Tile.RESBASE | TileFlag.ZONEBIT;
    const plantTile = Tile.POWERPLANT | TileFlag.ZONEBIT;
    const nuclearTile = Tile.NUCLEAR | TileFlag.ZONEBIT;

    store.beginTick();
    store.write('map', indexFor(powered.x, powered.y), zoneTile);
    store.write('map', indexFor(unpowered.x, unpowered.y), zoneTile);
    store.write('map', indexFor(plant.x, plant.y), plantTile);
    store.write('map', indexFor(nuclear.x, nuclear.y), nuclearTile);

    const powerLayer = store.getLayer('power') as Uint16Array;
    const powerWord = (powered.x >> 4) + powered.y * POWERMAPROW;
    powerLayer[powerWord]! |= 1 << (powered.x & 15);

    doNilPower(context);
    store.commitTick();

    const map = store.snapshot('map') as Uint16Array;
    const expectedMap = new Uint16Array(World.WORLD_X * World.WORLD_Y);
    expectedMap[indexFor(powered.x, powered.y)] = zoneTile | TileFlag.PWRBIT;
    expectedMap[indexFor(unpowered.x, unpowered.y)] = zoneTile;
    expectedMap[indexFor(plant.x, plant.y)] = plantTile | TileFlag.PWRBIT;
    expectedMap[indexFor(nuclear.x, nuclear.y)] = nuclearTile | TileFlag.PWRBIT;

    const expectedHash = hashMap(expectedMap);
    const actualHash = hashMap(map);

    expect(actualHash).toBe(expectedHash);
  });
});

describe('doSimInit', () => {
  it('runs initial scans and sets init flags', () => {
    const store = createClassicMapStore();
    const hooks = { doAllGraphs: vi.fn() };
    const context = createSimContext({ store, hooks });
    const state = createSimState();
    state.InitSimLoad = 0;

    const calls: string[] = [];
    doSimInit(context, state, {
      setValves: () => calls.push('valves'),
      clearCensus: () => calls.push('census'),
      mapScan: (x1, x2) => calls.push(`scan:${x1}-${x2}`),
      doPowerScan: () => calls.push('power'),
      ptlScan: () => calls.push('ptl'),
      crimeScan: () => calls.push('crime'),
      popDenScan: () => calls.push('pop'),
      fireAnalysis: () => calls.push('fire'),
    });

    expect(calls).toEqual([
      'valves',
      'census',
      `scan:0-${World.WORLD_X}`,
      'power',
      'ptl',
      'crime',
      'pop',
      'fire',
    ]);
    expect(state.NewPower).toBe(1);
    expect(state.NewMap).toBe(1);
    expect(state.NewGraph).toBe(1);
    expect(state.TotalPop).toBe(1);
    expect(state.DoInitialEval).toBe(1);
    expect(hooks.doAllGraphs).toHaveBeenCalledOnce();
  });
});
