import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { mapScanSlice } from './map-scan.ts';
import { createRoadHandler } from './roads.ts';

const { WORLD_Y, HWLDY } = World;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;
const trfIndexFor = (x: number, y: number) => (x >> 1) * HWLDY + (y >> 1);

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

describe('DoRoad', () => {
  it('deteriorates to river for bridge-shape roads', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.RoadEffect = 10;

    const context = createSimContext({
      store,
      rng: new StubRng([0, 31]),
    });

    const x = 5;
    const y = 10;
    store.write('map', indexFor(x, y), Tile.HBRIDGE | TileFlag.BURNBIT);

    const onRoad = createRoadHandler(state, context);
    mapScanSlice(state, context, x, x + 1, { onRoad });

    const map = store.getLayer('map') as Uint16Array;
    expect(map[indexFor(x, y)]).toBe(Tile.RIVER);
    expect(state.RoadTotal).toBe(1);
  });

  it('deteriorates to rubble for standard road shapes', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.RoadEffect = 10;

    const context = createSimContext({
      store,
      rng: new StubRng([0, 31, 2]),
    });

    const x = 6;
    const y = 8;
    store.write('map', indexFor(x, y), Tile.ROADS | TileFlag.BURNBIT);

    const onRoad = createRoadHandler(state, context);
    mapScanSlice(state, context, x, x + 1, { onRoad });

    const map = store.getLayer('map') as Uint16Array;
    expect(map[indexFor(x, y)]).toBe(Tile.RUBBLE + 2 + TileFlag.BULLBIT);
    expect(state.RoadTotal).toBe(1);
  });

  it('skips deterioration when conductive', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.RoadEffect = 10;

    const context = createSimContext({
      store,
      rng: new StubRng([0, 31]),
    });

    const x = 4;
    const y = 6;
    const tile = Tile.ROADS | TileFlag.BURNBIT | TileFlag.CONDBIT;
    store.write('map', indexFor(x, y), tile);
    store.write('trfDensity', trfIndexFor(x, y), 0);

    const onRoad = createRoadHandler(state, context);
    mapScanSlice(state, context, x, x + 1, { onRoad });

    const map = store.getLayer('map') as Uint16Array;
    expect(map[indexFor(x, y)]).toBe(tile);
    expect(state.RoadTotal).toBe(1);
  });

  it('skips deterioration when RoadEffect is healthy', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.RoadEffect = 30;

    const context = createSimContext({
      store,
      rng: new StubRng([0, 31]),
    });

    const x = 7;
    const y = 9;
    const tile = Tile.ROADS | TileFlag.BURNBIT;
    store.write('map', indexFor(x, y), tile);
    store.write('trfDensity', trfIndexFor(x, y), 0);

    const onRoad = createRoadHandler(state, context);
    mapScanSlice(state, context, x, x + 1, { onRoad });

    const map = store.getLayer('map') as Uint16Array;
    expect(map[indexFor(x, y)]).toBe(tile);
    expect(state.RoadTotal).toBe(1);
  });

  it('rewrites traffic density with DenTab and ANIMBIT logic', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.RoadEffect = 32;

    const context = createSimContext({
      store,
      rng: new StubRng([]),
    });

    const x = 10;
    const y = 12;
    store.write('map', indexFor(x, y), Tile.ROADS | TileFlag.BURNBIT | TileFlag.CONDBIT);
    store.write('trfDensity', trfIndexFor(x, y), 200);

    const onRoad = createRoadHandler(state, context);
    mapScanSlice(state, context, x, x + 1, { onRoad });

    const map = store.getLayer('map') as Uint16Array;
    const shape = (Tile.ROADS - Tile.ROADBASE) & 15;
    const expected = shape + Tile.HTRFBASE + TileFlag.BURNBIT + TileFlag.CONDBIT + TileFlag.ANIMBIT;
    expect(map[indexFor(x, y)]).toBe(expected);
    expect(state.RoadTotal).toBe(1);
  });

  it('rewrites to low density and clears ANIMBIT', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.RoadEffect = 32;

    const context = createSimContext({
      store,
      rng: new StubRng([]),
    });

    const x = 9;
    const y = 14;
    const shape = 3;
    const tile = Tile.LTRFBASE + shape + TileFlag.BURNBIT + TileFlag.ANIMBIT;
    store.write('map', indexFor(x, y), tile);
    store.write('trfDensity', trfIndexFor(x, y), 0);

    const onRoad = createRoadHandler(state, context);
    mapScanSlice(state, context, x, x + 1, { onRoad });

    const map = store.getLayer('map') as Uint16Array;
    const expected = Tile.ROADBASE + shape + TileFlag.BURNBIT;
    expect(map[indexFor(x, y)]).toBe(expected);
    expect(state.RoadTotal).toBe(1);
  });

  it('rewrites to medium density with ANIMBIT set', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.RoadEffect = 32;

    const context = createSimContext({
      store,
      rng: new StubRng([]),
    });

    const x = 13;
    const y = 16;
    const shape = 6;
    const tile = Tile.ROADBASE + shape + TileFlag.BURNBIT;
    store.write('map', indexFor(x, y), tile);
    store.write('trfDensity', trfIndexFor(x, y), 64);

    const onRoad = createRoadHandler(state, context);
    mapScanSlice(state, context, x, x + 1, { onRoad });

    const map = store.getLayer('map') as Uint16Array;
    const expected = Tile.LTRFBASE + shape + TileFlag.BURNBIT + TileFlag.ANIMBIT;
    expect(map[indexFor(x, y)]).toBe(expected);
    expect(state.RoadTotal).toBe(1);
  });

  it('does not rewrite when tile density matches traffic density', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.RoadEffect = 32;

    const context = createSimContext({
      store,
      rng: new StubRng([]),
    });

    const x = 11;
    const y = 18;
    const shape = 4;
    const tile = Tile.LTRFBASE + shape + TileFlag.BURNBIT + TileFlag.ANIMBIT;
    store.write('map', indexFor(x, y), tile);
    store.write('trfDensity', trfIndexFor(x, y), 64);

    const onRoad = createRoadHandler(state, context);
    mapScanSlice(state, context, x, x + 1, { onRoad });

    const map = store.getLayer('map') as Uint16Array;
    expect(map[indexFor(x, y)]).toBe(tile);
    expect(state.RoadTotal).toBe(1);
  });

  it('adds extra RoadTotal count for heavy traffic tiles', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.RoadEffect = 32;

    const context = createSimContext({
      store,
      rng: new StubRng([]),
    });

    const x = 17;
    const y = 22;
    const tile = Tile.HTRFBASE + 1 + TileFlag.BURNBIT;
    store.write('map', indexFor(x, y), tile);
    store.write('trfDensity', trfIndexFor(x, y), 192);

    const onRoad = createRoadHandler(state, context);
    mapScanSlice(state, context, x, x + 1, { onRoad });

    const map = store.getLayer('map') as Uint16Array;
    expect(map[indexFor(x, y)]).toBe(tile);
    expect(state.RoadTotal).toBe(2);
  });

  it('short-circuits when DoBridge returns true', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.RoadEffect = 32;

    const context = createSimContext({
      store,
      rng: new StubRng([]),
    });

    const x = 15;
    const y = 20;
    const tile = Tile.ROADS;
    store.write('map', indexFor(x, y), tile);
    store.write('trfDensity', trfIndexFor(x, y), 200);

    let bridgeCalls = 0;
    const onRoad = createRoadHandler(state, context, {
      doBridge: () => {
        bridgeCalls += 1;
        return true;
      },
    });

    mapScanSlice(state, context, x, x + 1, { onRoad });

    const map = store.getLayer('map') as Uint16Array;
    expect(map[indexFor(x, y)]).toBe(tile);
    expect(state.RoadTotal).toBe(5);
    expect(bridgeCalls).toBe(1);
  });

  it('continues traffic rendering when DoBridge returns false', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.RoadEffect = 32;

    const context = createSimContext({
      store,
      rng: new StubRng([]),
    });

    const x = 19;
    const y = 24;
    const tile = Tile.ROADS;
    store.write('map', indexFor(x, y), tile);
    store.write('trfDensity', trfIndexFor(x, y), 200);

    const onRoad = createRoadHandler(state, context, {
      doBridge: () => false,
    });

    mapScanSlice(state, context, x, x + 1, { onRoad });

    const map = store.getLayer('map') as Uint16Array;
    const shape = (Tile.ROADS - Tile.ROADBASE) & 15;
    const expected = shape + Tile.HTRFBASE + TileFlag.ANIMBIT;
    expect(map[indexFor(x, y)]).toBe(expected);
    expect(state.RoadTotal).toBe(5);
  });
});
