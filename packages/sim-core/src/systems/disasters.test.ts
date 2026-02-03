import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { createFireHandler, createFloodHandler, createRadHandler, fireZone } from './disasters.ts';
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
