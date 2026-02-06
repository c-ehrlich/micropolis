import {
  runCoreOracleDoPowerScan,
  runCoreOracleInitNewCity,
  runCoreOracleStepPhase,
} from '@city/micropolis-c-harness/core-parity';
import { describe, expect, it, vi } from 'vitest';

import { assertDefined } from '../core/assert.ts';
import { PowerMap, Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import type { SimContext } from '../core/sim-context.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState, type SimState } from '../core/sim-state.ts';
import { dispatchSimPhase } from '../sim/simulate.ts';
import { clearCensus } from './census.ts';
import { updateDate } from './date-time.ts';
import { doPowerScan, pushPowerStack, setZPowerAt } from './power.ts';

const { POWERMAPROW } = PowerMap;
const { WORLD_X, WORLD_Y } = World;
const { LOMASK } = TileMask;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

/**
 * Power-focused `MapScan` subset for phase progression parity tests.
 * Mirrors the `MapScan` + `DoZone` + power-plant portions in:
 * - `ref/micropolis/src/sim/s_sim.c`
 * - `ref/micropolis/src/sim/s_zone.c`
 */
function mapScanPowerZoneSubset(phase: number, state: SimState, context: SimContext): void {
  if (phase < 1 || phase > 8) {
    return;
  }

  const x1 = Math.floor(((phase - 1) * WORLD_X) / 8);
  const x2 = Math.floor((phase * WORLD_X) / 8);
  const map = context.store.getLayer('map') as Uint16Array;
  const power = context.store.getLayer('power') as Uint16Array;

  for (let x = x1; x < x2; x += 1) {
    const base = x * WORLD_Y;
    for (let y = 0; y < WORLD_Y; y += 1) {
      const index = base + y;
      const tile = map[index] ?? 0;
      if (tile === 0) {
        continue;
      }

      const tileId = tile & LOMASK;
      state.CChr9 = tileId;
      if (tileId < Tile.FLOOD) {
        continue;
      }

      if (state.NewPower !== 0 && (tile & TileFlag.CONDBIT) !== 0) {
        setZPowerAt(context.store, power, x, y, index, tile);
      }

      const current = map[index] ?? 0;
      if ((current & TileFlag.ZONEBIT) === 0) {
        continue;
      }

      const powered = setZPowerAt(context.store, power, x, y, index, current);
      if (powered) {
        state.PwrdZCnt += 1;
      } else {
        state.unPwrdZCnt += 1;
      }

      if (tileId === Tile.POWERPLANT) {
        state.CoalPop += 1;
        pushPowerStack(state, x, y);
      } else if (tileId === Tile.NUCLEAR) {
        state.NuclearPop += 1;
        pushPowerStack(state, x, y);
      }
    }
  }
}

describe('setZPowerAt', () => {
  it('sets or clears PWRBIT based on plant/power map status', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const power = store.getLayer('power') as Uint16Array;
    const tileIndex = indexFor(5, 6);
    const tile = Tile.RESBASE | TileFlag.ZONEBIT | TileFlag.PWRBIT;
    store.write('map', tileIndex, tile);

    setZPowerAt(store, power, 5, 6, tileIndex, tile);
    const cleared = store.getLayer('map') as Uint16Array;
    const clearedTile = cleared[tileIndex];
    assertDefined(clearedTile);
    expect(clearedTile & TileFlag.PWRBIT).toBe(0);

    const powerWord = (5 >> 4) + 6 * POWERMAPROW;
    const basePower = power[powerWord];
    assertDefined(basePower);
    power[powerWord] = basePower | (1 << (5 & 15));
    const unpoweredTile = cleared[tileIndex] ?? 0;
    setZPowerAt(store, power, 5, 6, tileIndex, unpoweredTile);
    const powered = store.getLayer('map') as Uint16Array;
    const poweredTile = powered[tileIndex];
    assertDefined(poweredTile);
    expect(poweredTile & TileFlag.PWRBIT).toBe(TileFlag.PWRBIT);

    const plantIndex = indexFor(8, 9);
    store.write('map', plantIndex, Tile.POWERPLANT);
    setZPowerAt(store, power, 8, 9, plantIndex, Tile.POWERPLANT);
    const plant = store.getLayer('map') as Uint16Array;
    const plantTile = plant[plantIndex];
    assertDefined(plantTile);
    expect(plantTile & TileFlag.PWRBIT).toBe(TileFlag.PWRBIT);
  });
});

describe('doPowerScan', () => {
  it('powers connected conductors using the power stack', () => {
    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();

    store.beginTick();
    const map = store.getLayer('map') as Uint16Array;
    const power = store.getLayer('power') as Uint16Array;
    power.fill(0xffff);

    const plant = { x: 10, y: 10 };
    map[indexFor(plant.x, plant.y)] = Tile.POWERPLANT;

    const wires = [
      { x: 11, y: 10 },
      { x: 12, y: 10 },
      { x: 11, y: 9 },
    ];
    for (const wire of wires) {
      map[indexFor(wire.x, wire.y)] = Tile.HPOWER | TileFlag.CONDBIT;
    }

    const isolated = { x: 30, y: 30 };
    map[indexFor(isolated.x, isolated.y)] = Tile.HPOWER | TileFlag.CONDBIT;

    state.CoalPop = 1;
    state.NuclearPop = 0;
    state.PowerStackNum = 0;
    pushPowerStack(state, plant.x, plant.y);

    doPowerScan(state, context);

    const powered = store.getLayer('power') as Uint16Array;
    const poweredCoords = [plant, ...wires];
    for (const coord of poweredCoords) {
      const word = (coord.x >> 4) + coord.y * POWERMAPROW;
      const value = powered[word];
      assertDefined(value);
      expect(value & (1 << (coord.x & 15))).toBeTruthy();
    }

    const isolatedWord = (isolated.x >> 4) + isolated.y * POWERMAPROW;
    const isolatedValue = powered[isolatedWord];
    assertDefined(isolatedValue);
    expect(isolatedValue & (1 << (isolated.x & 15))).toBe(0);
  });

  it('respects the CChr9 plant check when scanning neighbors', () => {
    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();

    store.beginTick();
    const map = store.getLayer('map') as Uint16Array;

    const plant = { x: 6, y: 6 };
    const wire = { x: 7, y: 6 };
    map[indexFor(plant.x, plant.y)] = Tile.POWERPLANT;
    map[indexFor(wire.x, wire.y)] = Tile.HPOWER | TileFlag.CONDBIT;

    state.CoalPop = 1;
    state.CChr9 = Tile.POWERPLANT;
    pushPowerStack(state, plant.x, plant.y);

    doPowerScan(state, context);

    const power = store.getLayer('power') as Uint16Array;
    const plantWord = (plant.x >> 4) + plant.y * POWERMAPROW;
    const wireWord = (wire.x >> 4) + wire.y * POWERMAPROW;
    const plantPower = power[plantWord];
    assertDefined(plantPower);
    expect(plantPower & (1 << (plant.x & 15))).toBeTruthy();
    const wirePower = power[wireWord];
    assertDefined(wirePower);
    expect(wirePower & (1 << (wire.x & 15))).toBe(0);
  });

  it('sends message 40 when capacity is exceeded', () => {
    const store = createClassicMapStore();
    const hooks = { sendMes: vi.fn() };
    const context = createSimContext({ store, hooks });
    const state = createSimState();

    store.beginTick();
    const map = store.getLayer('map') as Uint16Array;

    const plant = { x: 4, y: 4 };
    map[indexFor(plant.x, plant.y)] = Tile.POWERPLANT;

    state.CoalPop = 0;
    state.NuclearPop = 0;
    pushPowerStack(state, plant.x, plant.y);

    doPowerScan(state, context);
    updateDate(state, context);

    expect(hooks.sendMes).toHaveBeenCalledWith(40);

    const power = store.getLayer('power') as Uint16Array;
    const word = (plant.x >> 4) + plant.y * POWERMAPROW;
    const value = power[word];
    assertDefined(value);
    expect(value & (1 << (plant.x & 15))).toBe(0);
  });
});

describe('Power parity against C oracle (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  it('matches C DoPowerScan power-map output and stack consumption', () => {
    const seed = 0x00bada55;
    const plant = { x: 10, y: 10 };
    const wireA = { x: 11, y: 10 };
    const wireB = { x: 12, y: 10 };
    const zone = { x: 13, y: 10 };
    const zoneFlags = TileFlag.ZONEBIT | TileFlag.CONDBIT | TileFlag.BURNBIT;

    const oracleBefore = runCoreOracleInitNewCity({ seed });
    oracleBefore.map[indexFor(plant.x, plant.y)] = Tile.POWERPLANT | zoneFlags;
    oracleBefore.map[indexFor(wireA.x, wireA.y)] = Tile.HPOWER | TileFlag.CONDBIT;
    oracleBefore.map[indexFor(wireB.x, wireB.y)] = Tile.HPOWER | TileFlag.CONDBIT;
    oracleBefore.map[indexFor(zone.x, zone.y)] = Tile.RZB | zoneFlags;
    oracleBefore.CoalPop = 1;
    oracleBefore.NuclearPop = 0;
    oracleBefore.CChr9 = Tile.RZB;
    oracleBefore.PowerStackNum = 1;
    oracleBefore.powerStackX.fill(0);
    oracleBefore.powerStackY.fill(0);
    oracleBefore.powerStackX[1] = plant.x;
    oracleBefore.powerStackY[1] = plant.y;

    const oracleAfter = runCoreOracleDoPowerScan(oracleBefore);

    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();
    store.beginTick();
    (store.getLayer('map') as Uint16Array).set(oracleBefore.map);
    (store.getLayer('power') as Uint16Array).set(oracleBefore.powerMap);

    state.CChr9 = oracleBefore.CChr9;
    state.CoalPop = oracleBefore.CoalPop;
    state.NuclearPop = oracleBefore.NuclearPop;
    state.PowerStackNum = oracleBefore.PowerStackNum;
    state.PowerStackX.set(oracleBefore.powerStackX);
    state.PowerStackY.set(oracleBefore.powerStackY);

    doPowerScan(state, context);

    expect(Array.from(store.getLayer('power') as Uint16Array)).toEqual(
      Array.from(oracleAfter.powerMap),
    );
    expect(state.PowerStackNum).toBe(oracleAfter.PowerStackNum);
    store.commitTick();
  });

  it('matches C phase progression for zone power counters and zone PWRBIT updates', () => {
    const seed = 0x12345678;
    const zoneFlags = TileFlag.ZONEBIT | TileFlag.CONDBIT | TileFlag.BURNBIT;
    const plant = { x: 8, y: 8 };
    const wire = { x: 9, y: 8 };
    const poweredZone = { x: 10, y: 8 };
    const unpoweredZone = { x: 30, y: 20 };

    const oracleBefore = runCoreOracleInitNewCity({ seed, simSpeed: 3 });
    oracleBefore.map[indexFor(plant.x, plant.y)] = Tile.POWERPLANT | zoneFlags;
    oracleBefore.map[indexFor(wire.x, wire.y)] = Tile.HPOWER | TileFlag.CONDBIT;
    oracleBefore.map[indexFor(poweredZone.x, poweredZone.y)] = Tile.RZB | zoneFlags;
    oracleBefore.map[indexFor(unpoweredZone.x, unpoweredZone.y)] = Tile.RZB | zoneFlags;
    // `SpdPwr[3] == 5` in `Simulate` (`ref/micropolis/src/sim/s_sim.c`); setting
    // `Scycle=4` makes phase 11 run `DoPowerScan` after phase 0 increments to 5.
    oracleBefore.Scycle = 4;

    const phases = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8];
    let oracleAfter = oracleBefore;
    for (const phase of phases) {
      oracleAfter = runCoreOracleStepPhase(oracleAfter, phase);
    }

    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();
    state.CityTime = oracleBefore.CityTime;
    state.CityTax = oracleBefore.CityTax;
    state.AvCityTax = oracleBefore.AvCityTax;
    state.Scycle = oracleBefore.Scycle;
    state.Fcycle = oracleBefore.Fcycle;
    state.SimSpeed = oracleBefore.SimSpeed;
    state.DoInitialEval = oracleBefore.DoInitialEval;
    state.NewPower = oracleBefore.NewPower;
    state.CChr9 = oracleBefore.CChr9;

    store.beginTick();
    (store.getLayer('map') as Uint16Array).set(oracleBefore.map);
    (store.getLayer('power') as Uint16Array).set(oracleBefore.powerMap);

    for (const phase of phases) {
      dispatchSimPhase(phase, state, context, {
        clearCensus,
        mapScan: (scanPhase, scanState, scanContext) =>
          mapScanPowerZoneSubset(scanPhase, scanState, scanContext),
        doPowerScan,
      });
    }

    const tsMap = store.getLayer('map') as Uint16Array;
    const oracleMap = oracleAfter.map;
    expect(Array.from(store.getLayer('power') as Uint16Array)).toEqual(
      Array.from(oracleAfter.powerMap),
    );
    expect(state.PwrdZCnt).toBe(oracleAfter.PwrdZCnt);
    expect(state.unPwrdZCnt).toBe(oracleAfter.unPwrdZCnt);
    // `DoZone` in `ref/micropolis/src/sim/s_zone.c` increments one of these counters
    // once per zone tile scan. This fixture has 3 zone tiles, with 2 powered after the
    // previous tick's `DoPowerScan`.
    expect(state.PwrdZCnt).toBe(2);
    expect(state.unPwrdZCnt).toBe(1);
    expect((tsMap[indexFor(poweredZone.x, poweredZone.y)] ?? 0) & TileFlag.PWRBIT).toBe(
      (oracleMap[indexFor(poweredZone.x, poweredZone.y)] ?? 0) & TileFlag.PWRBIT,
    );
    expect((tsMap[indexFor(unpoweredZone.x, unpoweredZone.y)] ?? 0) & TileFlag.PWRBIT).toBe(
      (oracleMap[indexFor(unpoweredZone.x, unpoweredZone.y)] ?? 0) & TileFlag.PWRBIT,
    );
    store.commitTick();
  });
});
