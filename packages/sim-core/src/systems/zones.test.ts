import { describe, expect, it, vi } from 'vitest';

import { PowerMap, Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createRng } from '../core/rng.ts';
import type { SimContextOptions } from '../core/sim-context.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { comPlop, createZoneSystem, decROGMem, doResIn, doZone, zonePlop } from './zones.ts';

const { WORLD_Y, SmY } = World;
const { POWERMAPROW } = PowerMap;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;
const smallIndex = (x: number, y: number) => (x >> 3) * SmY + (y >> 3);

const createHarness = (seed = 1, hooks: SimContextOptions['hooks'] = {}) => {
  const store = createClassicMapStore();
  const rng = createRng(seed);
  const context = createSimContext({ store, rng, hooks });
  const state = createSimState();
  store.beginTick();
  const system = createZoneSystem(state, context);
  return { store, context, state, system };
};

describe('zones', () => {
  it('zonePlop writes the 3x3 pattern and sets zone/bull bits on the center', () => {
    const { store, system } = createHarness();
    const x = 10;
    const y = 12;

    zonePlop(system, x, y, Tile.RESBASE);

    const map = store.getLayer('map') as Uint16Array;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const tile = map[indexFor(x + dx, y + dy)] ?? 0;
        const expectedId = Tile.RESBASE + (dy + 1) * 3 + (dx + 1);
        expect(tile & TileMask.LOMASK).toBe(expectedId);
        expect(tile & TileFlag.BNCNBIT).toBe(TileFlag.BNCNBIT);
      }
    }

    const center = map[indexFor(x, y)] ?? 0;
    expect(center & TileFlag.ZONEBIT).toBe(TileFlag.ZONEBIT);
    expect(center & TileFlag.BULLBIT).toBe(TileFlag.BULLBIT);
  });

  it('comPlop uses the commercial base formula for the center tile', () => {
    const { store, system } = createHarness();
    const x = 20;
    const y = 20;
    const den = 3;
    const value = 2;
    const base = (value * 5 + den) * 9 + Tile.CZB - 4;

    comPlop(system, x, y, den, value);

    const map = store.getLayer('map') as Uint16Array;
    const center = map[indexFor(x, y)] ?? 0;
    expect(center & TileMask.LOMASK).toBe(base + 4);
  });

  it('doResIn builds a house and bumps ROG for free zones', () => {
    const { store, system } = createHarness(5);
    const x = 30;
    const y = 30;

    store.write('map', indexFor(x, y), Tile.FREEZ | TileFlag.ZONEBIT | TileFlag.BNCNBIT);
    store.write('map', indexFor(x, y - 2), Tile.ROADS);

    doResIn(system, x, y, Tile.FREEZ, 1, 2);

    const map = store.getLayer('map') as Uint16Array;
    const house = map[indexFor(x, y - 1)] ?? 0;
    const houseId = house & TileMask.LOMASK;
    expect(house & TileFlag.BLBNCNBIT).toBe(TileFlag.BLBNCNBIT);
    expect(houseId).toBeGreaterThanOrEqual(Tile.HOUSE + 6);
    expect(houseId).toBeLessThanOrEqual(Tile.HOUSE + 8);

    const rog = store.getLayer('rateOGMem') as Int16Array;
    expect(rog[smallIndex(x, y)]).toBe(4);
  });

  it('doZone powers fire stations and applies road-adjusted effects', () => {
    const { store, system, state } = createHarness();
    const x = 40;
    const y = 40;

    store.write('map', indexFor(x, y), Tile.FIRESTATION | TileFlag.ZONEBIT | TileFlag.BNCNBIT);
    store.write('map', indexFor(x - 1, y - 2), Tile.ROADS);

    const powerWord = (x >> 4) + y * POWERMAPROW;
    store.write('power', powerWord, 1 << (x & 15));

    state.FireEffect = 100;

    doZone(system, x, y, Tile.FIRESTATION | TileFlag.ZONEBIT | TileFlag.BNCNBIT);

    const map = store.getLayer('map') as Uint16Array;
    const center = map[indexFor(x, y)] ?? 0;
    expect(center & TileFlag.PWRBIT).toBe(TileFlag.PWRBIT);
    expect(state.PwrdZCnt).toBe(1);
    expect(state.FireStPop).toBe(1);

    const fireSt = store.getLayer('fireStMap') as Int16Array;
    expect(fireSt[smallIndex(x, y)]).toBe(100);
  });

  it('doZone clears power bits for unpowered zones', () => {
    const { store, system, state } = createHarness();
    const x = 55;
    const y = 55;

    store.write(
      'map',
      indexFor(x, y),
      Tile.POLICESTATION | TileFlag.ZONEBIT | TileFlag.BNCNBIT | TileFlag.PWRBIT,
    );

    doZone(
      system,
      x,
      y,
      Tile.POLICESTATION | TileFlag.ZONEBIT | TileFlag.BNCNBIT | TileFlag.PWRBIT,
    );

    const map = store.getLayer('map') as Uint16Array;
    const center = map[indexFor(x, y)] ?? 0;
    expect(center & TileFlag.PWRBIT).toBe(0);
    expect(state.unPwrdZCnt).toBe(1);
  });

  it('ports generate ships when powered and no ship sprite exists', () => {
    const hooks = {
      getSprite: vi.fn(() => null),
      generateShip: vi.fn(),
    };
    const { store, system, state } = createHarness(1, hooks);
    const x = 60;
    const y = 20;

    store.write('map', indexFor(x, y), Tile.PORT | TileFlag.ZONEBIT | TileFlag.BNCNBIT);
    const powerWord = (x >> 4) + y * POWERMAPROW;
    store.write('power', powerWord, 1 << (x & 15));

    doZone(system, x, y, Tile.PORT | TileFlag.ZONEBIT | TileFlag.BNCNBIT);

    expect(state.PortPop).toBe(1);
    expect(hooks.getSprite).toHaveBeenCalled();
    expect(hooks.generateShip).toHaveBeenCalled();
  });

  it('powered stadiums render the full stadium and football tiles on schedule', () => {
    const { store, system, state } = createHarness();
    const x = 16;
    const y = 16;

    state.CityTime = 0;
    store.write('map', indexFor(x, y), Tile.STADIUM | TileFlag.ZONEBIT | TileFlag.BNCNBIT);

    const powerWord = (x >> 4) + y * POWERMAPROW;
    store.write('power', powerWord, 1 << (x & 15));

    doZone(system, x, y, Tile.STADIUM | TileFlag.ZONEBIT | TileFlag.BNCNBIT);

    const map = store.getLayer('map') as Uint16Array;
    const center = map[indexFor(x, y)] ?? 0;
    expect(center & TileMask.LOMASK).toBe(Tile.FULLSTADIUM);

    const footballA = map[indexFor(x + 1, y)] ?? 0;
    const footballB = map[indexFor(x + 1, y + 1)] ?? 0;
    expect(footballA & TileMask.LOMASK).toBe(Tile.FOOTBALLGAME1);
    expect(footballA & TileFlag.ANIMBIT).toBe(TileFlag.ANIMBIT);
    expect(footballB & TileMask.LOMASK).toBe(Tile.FOOTBALLGAME2);
    expect(footballB & TileFlag.ANIMBIT).toBe(TileFlag.ANIMBIT);
  });

  it('decROGMem decays toward zero and clamps extremes', () => {
    const { store, context, state } = createHarness();
    store.write('rateOGMem', 0, 205);
    store.write('rateOGMem', 1, -205);
    store.write('rateOGMem', 2, 1);

    decROGMem(state, context);

    const rog = store.getLayer('rateOGMem') as Int16Array;
    expect(rog[0]).toBe(200);
    expect(rog[1]).toBe(-200);
    expect(rog[2]).toBe(0);
  });
});
