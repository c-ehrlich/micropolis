import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import {
  createFireHandler,
  createFloodHandler,
  createRadHandler,
  doDisasters,
  fireZone,
  makeEarthquake,
  makeFire,
  makeFlood,
  makeMeltdown,
  scenarioDisaster,
} from './disasters.ts';
import { mapScanSlice } from './map-scan.ts';

const { WORLD_Y, SmY } = World;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;
const rateIndex = (x: number, y: number) => x * SmY + y;

class StubRng extends MicropolisRng {
  private values: number[];
  private cursor = 0;

  constructor(values: number[]) {
    super(1);
    this.values = values;
  }

  override seed(_value = 0): void {
    this.cursor = 0;
  }

  override next16(): number {
    const value = this.values[this.cursor] ?? 0;
    this.cursor += 1;
    return value & 0xffff;
  }

  override next16Signed(): number {
    let value = this.next16();
    if (value > 32767) {
      value = 32767 - value;
    }
    return value;
  }

  override rand(range: number): number {
    if (range <= 0) {
      return 0;
    }
    return this.next16() % (range + 1);
  }
}

describe('Fire/Flood/Radiation', () => {
  it('fireZone decreases rateOGMem and sets BULLBIT in footprint', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const context = createSimContext({ store });
    const map = store.getLayer('map') as Uint16Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const x = 10;
    const y = 10;
    const zoneTile = Tile.IZB + 1 + TileFlag.ZONEBIT;

    store.write('map', indexFor(x, y), zoneTile);
    store.write('map', indexFor(x + 1, y), Tile.ROADS);
    store.write('map', indexFor(x + 1, y + 1), Tile.TREEBASE);
    store.write('map', indexFor(x + 2, y + 2), Tile.ROADS);

    fireZone(context, map, rateOGMem, x, y, zoneTile);

    expect(rateOGMem[rateIndex(x >> 3, y >> 3)]).toBe(-20);
    expect(map[indexFor(x + 1, y)]).toBe(Tile.ROADS | TileFlag.BULLBIT);
    expect(map[indexFor(x + 1, y + 1)]).toBe(Tile.TREEBASE);
    expect(map[indexFor(x + 2, y + 2)]).toBe(Tile.ROADS);
  });

  it('spreads fire to burnable neighbors and triggers zone explosions', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const rng = new StubRng([0, 0, 2, 1, 0, 1, 1, 1]);
    const explosions: Array<[number, number]> = [];
    const context = createSimContext({
      store,
      rng,
      hooks: {
        makeExplosionAt: (x, y) => explosions.push([x, y]),
      },
    });

    const x = 10;
    const y = 10;
    const zoneX = x - 1;
    const zoneY = y;

    store.write('map', indexFor(x, y), Tile.FIREBASE);
    store.write('map', indexFor(zoneX, zoneY), Tile.IZB + 1 + TileFlag.BURNBIT + TileFlag.ZONEBIT);
    store.write('map', indexFor(zoneX, zoneY - 1), Tile.ROADS);
    store.write('map', indexFor(x + 1, y), Tile.ROADS + TileFlag.BURNBIT);

    const onFire = createFireHandler(context);
    mapScanSlice(state, context, x, x + 1, { onFire });

    const map = store.getLayer('map') as Uint16Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    expect(map[indexFor(zoneX, zoneY)]).toBe(Tile.FIRE + 2 + TileFlag.ANIMBIT);
    expect(map[indexFor(x + 1, y)]).toBe(Tile.FIRE + 1 + TileFlag.ANIMBIT);
    expect(map[indexFor(zoneX, zoneY - 1)]).toBe(Tile.ROADS | TileFlag.BULLBIT);
    expect(rateOGMem[rateIndex(zoneX >> 3, zoneY >> 3)]).toBe(-20);
    expect(explosions).toEqual([[(zoneX << 4) + 8, (zoneY << 4) + 8]]);
  });

  it('burns out fire based on FireRate', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const rng = new StubRng([0, 1, 1, 1, 1, 0, 2]);
    const context = createSimContext({ store, rng });

    const x = 12;
    const y = 12;
    store.write('map', indexFor(x, y), Tile.FIREBASE);

    const fireRateIndex = rateIndex(x >> 3, y >> 3);
    store.write('fireRate', fireRateIndex, 200);

    const onFire = createFireHandler(context);
    mapScanSlice(state, context, x, x + 1, { onFire });

    const map = store.getLayer('map') as Uint16Array;
    expect(map[indexFor(x, y)]).toBe(Tile.RUBBLE + 2 + TileFlag.BULLBIT);
  });

  it('spreads flood when FloodCnt is active and tags rateOGMem for zones', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.FloodCnt = 1;

    const rng = new StubRng([1, 0, 1, 1, 1]);
    const context = createSimContext({ store, rng });

    const x = 15;
    const y = 10;
    store.write('map', indexFor(x, y), Tile.FLOOD);
    store.write('map', indexFor(x + 1, y), Tile.IZB + 1 + TileFlag.BURNBIT + TileFlag.ZONEBIT);

    const onFlood = createFloodHandler(state, context);
    mapScanSlice(state, context, x, x + 1, { onFlood });

    const map = store.getLayer('map') as Uint16Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    expect(map[indexFor(x + 1, y)]).toBe(Tile.FLOOD + 1);
    expect(rateOGMem[rateIndex((x + 1) >> 3, y >> 3)]).toBe(-20);
  });

  it('clears flood tiles when FloodCnt expires and RNG allows it', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.FloodCnt = 0;

    const rng = new StubRng([0]);
    const context = createSimContext({ store, rng });

    const x = 18;
    const y = 14;
    store.write('map', indexFor(x, y), Tile.FLOOD);

    const onFlood = createFloodHandler(state, context);
    mapScanSlice(state, context, x, x + 1, { onFlood });

    const map = store.getLayer('map') as Uint16Array;
    expect(map[indexFor(x, y)]).toBe(Tile.DIRT);
  });

  it('decays radiation tiles to dirt when RNG triggers', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const rng = new StubRng([0]);
    const context = createSimContext({ store, rng });

    const x = 22;
    const y = 9;
    store.write('map', indexFor(x, y), Tile.RADTILE);

    const onRadTile = createRadHandler();
    mapScanSlice(state, context, x, x + 1, { onRadTile });

    const map = store.getLayer('map') as Uint16Array;
    expect(map[indexFor(x, y)]).toBe(Tile.DIRT);
  });
});

describe('Disaster events', () => {
  it('decrements FloodCnt and can trigger SetFire via DoDisasters', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.GameLevel = 0;
    state.FloodCnt = 2;

    const rng = new StubRng([0, 0, 0, 0, 3]);
    const messages: Array<[number, number, number]> = [];
    const context = createSimContext({
      store,
      rng,
      hooks: {
        sendMesAt: (id, x, y) => messages.push([id, x, y]),
      },
    });

    const x = 0;
    const y = 0;
    // `SetFire` requires a non-zone tile with ID in (LHTHR..LASTZONE) (`s_disast.c`).
    store.write('map', indexFor(x, y), Tile.LHTHR + 1);

    doDisasters(state, context);

    const map = store.getLayer('map') as Uint16Array;
    // Fire variant comes from `Rand16() & 7` in `SetFire` (`s_disast.c`).
    expect(map[indexFor(x, y)]).toBe(Tile.FIRE + 3 + TileFlag.ANIMBIT);
    expect(state.FloodCnt).toBe(1);
    expect(state.CrashX).toBe(x);
    expect(state.CrashY).toBe(y);
    // Message -20 is sent by `SetFire` in `s_disast.c`.
    expect(messages).toEqual([[-20, x, y]]);
  });

  it('ticks scenario timers and clears DisasterEvent after countdown', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.DisasterEvent = 3;
    state.DisasterWait = 1;

    let drops = 0;
    const context = createSimContext({
      store,
      hooks: {
        dropFireBombs: () => {
          drops += 1;
        },
      },
    });

    scenarioDisaster(state, context);

    expect(drops).toBe(1);
    expect(state.DisasterWait).toBe(0);
    expect(state.DisasterEvent).toBe(3);

    scenarioDisaster(state, context);
    expect(state.DisasterEvent).toBe(0);
  });

  it('starts a random fire from a burnable tile', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const rng = new StubRng([1, 2, 4]);
    const messages: Array<[number, number, number]> = [];
    const context = createSimContext({
      store,
      rng,
      hooks: {
        sendMesAt: (id, x, y) => messages.push([id, x, y]),
      },
    });

    const x = 1;
    const y = 2;
    // `MakeFire` checks for BURNBIT and tileId > 21 (`s_disast.c`).
    store.write('map', indexFor(x, y), Tile.LHTHR + 1 + TileFlag.BURNBIT);

    makeFire(context);

    const map = store.getLayer('map') as Uint16Array;
    // Fire variant uses `Rand16() & 7` in `MakeFire` (`s_disast.c`).
    expect(map[indexFor(x, y)]).toBe(Tile.FIRE + 4 + TileFlag.ANIMBIT);
    expect(messages).toEqual([[20, x, y]]);
  });

  it('spawns a flood from a river edge neighbor', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const rng = new StubRng([5, 5]);
    const messages: Array<[number, number, number]> = [];
    const context = createSimContext({
      store,
      rng,
      hooks: {
        sendMesAt: (id, x, y) => messages.push([id, x, y]),
      },
    });

    const x = 5;
    const y = 5;
    store.write('map', indexFor(x, y), Tile.FIRSTRIVEDGE);
    store.write('map', indexFor(x, y - 1), Tile.DIRT);

    makeFlood(state, context);

    const map = store.getLayer('map') as Uint16Array;
    // `MakeFlood` sets FloodCnt to 30 in `s_disast.c`.
    expect(map[indexFor(x, y - 1)]).toBe(Tile.FLOOD);
    expect(state.FloodCnt).toBe(30);
    expect(state.FloodX).toBe(x);
    expect(state.FloodY).toBe(y - 1);
    expect(messages).toEqual([[-42, x, y - 1]]);
  });

  it('damages vulnerable tiles during earthquakes', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.CCx = 7;
    state.CCy = 9;

    const rng = new StubRng([0]);
    const quakes: Array<[number, number, number]> = [];
    const context = createSimContext({
      store,
      rng,
      hooks: {
        doEarthQuake: () => quakes.push([1, 0, 0]),
        sendMesAt: (id, x, y) => quakes.push([id, x, y]),
      },
    });

    store.write('map', indexFor(0, 0), Tile.RESBASE);

    makeEarthquake(state, context);

    const map = store.getLayer('map') as Uint16Array;
    // Earthquake fire variant uses `Rand16() & 7` when `(z & 3) == 0` (`s_disast.c`).
    expect(map[indexFor(0, 0)]).toBe(Tile.FIRE + TileFlag.ANIMBIT);
    expect(quakes).toEqual([
      [1, 0, 0],
      // Message -23 sent at city center in `MakeEarthquake` (`s_disast.c`).
      [-23, state.CCx, state.CCy],
    ]);
  });

  it('locates nuclear plants and triggers meltdowns', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const rng = new StubRng([0]);
    const explosions: Array<[number, number]> = [];
    const messages: Array<[number, number, number]> = [];
    const context = createSimContext({
      store,
      rng,
      hooks: {
        makeExplosion: (x, y) => explosions.push([x, y]),
        sendMesAt: (id, x, y) => messages.push([id, x, y]),
      },
    });

    const x = 10;
    const y = 10;
    store.write('map', indexFor(x, y), Tile.NUCLEAR);

    makeMeltdown(state, context);

    const map = store.getLayer('map') as Uint16Array;
    expect(state.MeltX).toBe(x);
    expect(state.MeltY).toBe(y);
    expect(map[indexFor(x - 1, y - 1)]).toBe(Tile.FIRE + TileFlag.ANIMBIT);
    expect(explosions).toEqual([
      [x - 1, y - 1],
      [x - 1, y + 2],
      [x + 2, y - 1],
      [x + 2, y + 2],
    ]);
    expect(messages).toEqual([[-43, x, y]]);
  });
});
