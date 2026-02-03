import { describe, expect, it, vi } from 'vitest';

import { PowerMap, Tile, TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { doPowerScan, pushPowerStack, setZPowerAt } from './power.ts';

const { POWERMAPROW } = PowerMap;
const { WORLD_Y } = World;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

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
    expect(cleared[tileIndex] & TileFlag.PWRBIT).toBe(0);

    const powerWord = (5 >> 4) + 6 * POWERMAPROW;
    power[powerWord] |= 1 << (5 & 15);
    const unpoweredTile = cleared[tileIndex] ?? 0;
    setZPowerAt(store, power, 5, 6, tileIndex, unpoweredTile);
    const powered = store.getLayer('map') as Uint16Array;
    expect(powered[tileIndex] & TileFlag.PWRBIT).toBe(TileFlag.PWRBIT);

    const plantIndex = indexFor(8, 9);
    store.write('map', plantIndex, Tile.POWERPLANT);
    setZPowerAt(store, power, 8, 9, plantIndex, Tile.POWERPLANT);
    const plant = store.getLayer('map') as Uint16Array;
    expect(plant[plantIndex] & TileFlag.PWRBIT).toBe(TileFlag.PWRBIT);
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
      expect(powered[word] & (1 << (coord.x & 15))).toBeTruthy();
    }

    const isolatedWord = (isolated.x >> 4) + isolated.y * POWERMAPROW;
    expect(powered[isolatedWord] & (1 << (isolated.x & 15))).toBe(0);
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
    expect(power[plantWord] & (1 << (plant.x & 15))).toBeTruthy();
    expect(power[wireWord] & (1 << (wire.x & 15))).toBe(0);
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

    expect(hooks.sendMes).toHaveBeenCalledWith(40);

    const power = store.getLayer('power') as Uint16Array;
    const word = (plant.x >> 4) + plant.y * POWERMAPROW;
    expect(power[word] & (1 << (plant.x & 15))).toBe(0);
  });
});
