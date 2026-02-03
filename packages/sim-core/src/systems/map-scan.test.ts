import { describe, expect, it } from 'vitest';

import { PowerMap, Tile, TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { getMapScanSlice, mapScanSlice, runMapScanPhase } from './map-scan.ts';

const { WORLD_X, WORLD_Y } = World;
const { POWERMAPROW } = PowerMap;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

const createHarness = (seed = 1) => {
  const store = createClassicMapStore();
  const rng = createRng(seed);
  const context = createSimContext({ store, rng });
  const state = createSimState();
  return { store, context, state, rng };
};

const fillMap = (store: ReturnType<typeof createClassicMapStore>, value: number) => {
  for (let x = 0; x < WORLD_X; x += 1) {
    for (let y = 0; y < WORLD_Y; y += 1) {
      store.write('map', indexFor(x, y), value);
    }
  }
};

describe('MapScan slices', () => {
  it('returns expected x ranges for phases 1..8', () => {
    const expected = [
      { x1: 0, x2: 15 },
      { x1: 15, x2: 30 },
      { x1: 30, x2: 45 },
      { x1: 45, x2: 60 },
      { x1: 60, x2: 75 },
      { x1: 75, x2: 90 },
      { x1: 90, x2: 105 },
      { x1: 105, x2: 120 },
    ];

    expected.forEach((slice, index) => {
      expect(getMapScanSlice(index + 1)).toEqual(slice);
    });
  });

  it('returns null for phases outside 1..8', () => {
    expect(getMapScanSlice(0)).toBeNull();
    expect(getMapScanSlice(9)).toBeNull();
    expect(getMapScanSlice(-3)).toBeNull();
  });
});

describe('MapScan slice mutations', () => {
  it('only mutates tiles within the slice bounds', () => {
    const { store, context, state } = createHarness();
    store.beginTick();

    fillMap(store, Tile.ROADS);

    const slice = getMapScanSlice(3);
    if (!slice) {
      throw new Error('missing slice for phase 3');
    }

    mapScanSlice(state, context, slice.x1, slice.x2, {
      onRoad: (context) => context.writeTile(Tile.RIVER),
    });

    const map = store.getLayer('map') as Uint16Array;

    for (let x = 0; x < WORLD_X; x += 1) {
      for (let y = 0; y < WORLD_Y; y += 1) {
        const tile = map[indexFor(x, y)];
        if (x >= slice.x1 && x < slice.x2) {
          expect(tile).toBe(Tile.RIVER);
        } else {
          expect(tile).toBe(Tile.ROADS);
        }
      }
    }
  });

  it('runMapScanPhase applies the phase slice and ignores other phases', () => {
    const { store, context, state } = createHarness();
    store.beginTick();

    fillMap(store, Tile.ROADS);

    const ran = runMapScanPhase(state, context, 7, {
      onRoad: (context) => context.writeTile(Tile.RIVER),
    });

    expect(ran).toBe(true);

    const slice = getMapScanSlice(7);
    if (!slice) {
      throw new Error('missing slice for phase 7');
    }

    const map = store.getLayer('map') as Uint16Array;

    for (let x = 0; x < WORLD_X; x += 1) {
      for (let y = 0; y < WORLD_Y; y += 1) {
        const tile = map[indexFor(x, y)];
        if (x >= slice.x1 && x < slice.x2) {
          expect(tile).toBe(Tile.RIVER);
        } else {
          expect(tile).toBe(Tile.ROADS);
        }
      }
    }

    const ranOutside = runMapScanPhase(state, context, 12, {
      onRoad: (context) => context.writeTile(Tile.DIRT),
    });
    expect(ranOutside).toBe(false);
  });
});

describe('MapScan dispatch ordering', () => {
  it('invokes conductive handler before road handler on conductive road tiles', () => {
    const { store, context, state } = createHarness();
    store.beginTick();

    const x = 10;
    const y = 10;
    store.write('map', indexFor(x, y), Tile.ROADS | TileFlag.CONDBIT);

    const calls: string[] = [];
    mapScanSlice(
      state,
      context,
      x,
      x + 1,
      {
        onConductive: () => calls.push('conductive'),
        onRoad: () => calls.push('road'),
      },
      { newPower: true },
    );

    expect(calls).toEqual(['conductive', 'road']);
  });

  it('gates conductive handler on newPower', () => {
    const { store, context, state } = createHarness();
    store.beginTick();

    const x = 12;
    const y = 10;
    store.write('map', indexFor(x, y), Tile.ROADS | TileFlag.CONDBIT);

    const calls: string[] = [];
    mapScanSlice(
      state,
      context,
      x,
      x + 1,
      {
        onConductive: () => calls.push('conductive'),
        onRoad: () => calls.push('road'),
      },
      { newPower: false },
    );

    expect(calls).toEqual(['road']);
  });

  it('defaults to state.NewPower when newPower option is omitted', () => {
    const first = createHarness();
    first.state.NewPower = 0;
    first.store.beginTick();

    const x = 13;
    const y = 10;
    first.store.write('map', indexFor(x, y), Tile.ROADS | TileFlag.CONDBIT);

    const firstCalls: string[] = [];
    mapScanSlice(first.state, first.context, x, x + 1, {
      onConductive: () => firstCalls.push('conductive'),
      onRoad: () => firstCalls.push('road'),
    });

    expect(firstCalls).toEqual(['road']);

    const second = createHarness();
    second.state.NewPower = 1;
    second.store.beginTick();
    second.store.write('map', indexFor(x, y), Tile.ROADS | TileFlag.CONDBIT);

    const secondCalls: string[] = [];
    mapScanSlice(second.state, second.context, x, x + 1, {
      onConductive: () => secondCalls.push('conductive'),
      onRoad: () => secondCalls.push('road'),
    });

    expect(secondCalls).toEqual(['conductive', 'road']);
  });

  it('updates PWRBIT on conductive tiles when NewPower is set', () => {
    const { store, context, state } = createHarness();
    state.NewPower = 1;
    store.beginTick();

    const powered = { x: 8, y: 12 };
    const unpowered = { x: 9, y: 12 };
    const baseTile = Tile.ROADS | TileFlag.CONDBIT;

    store.write('map', indexFor(powered.x, powered.y), baseTile);
    store.write('map', indexFor(unpowered.x, unpowered.y), baseTile | TileFlag.PWRBIT);

    const powerLayer = store.getLayer('power') as Uint16Array;
    const powerWord = (powered.x >> 4) + powered.y * POWERMAPROW;
    powerLayer[powerWord] |= 1 << (powered.x & 15);

    mapScanSlice(state, context, powered.x, powered.x + 2);

    const map = store.getLayer('map') as Uint16Array;
    expect(map[indexFor(powered.x, powered.y)] & TileFlag.PWRBIT).toBe(TileFlag.PWRBIT);
    expect(map[indexFor(unpowered.x, unpowered.y)] & TileFlag.PWRBIT).toBe(0);
  });

  it('increments FirePop and gates fire handler by RNG', () => {
    const x = 20;
    const y = 10;
    const index = indexFor(x, y);

    const first = createHarness(1);
    first.store.beginTick();
    first.store.write('map', index, Tile.FIREBASE);
    const firstCalls: string[] = [];
    mapScanSlice(first.state, first.context, x, x + 1, {
      onFire: () => firstCalls.push('fire'),
    });
    expect(first.state.FirePop).toBe(1);
    expect(firstCalls).toEqual([]);

    const second = createHarness(5);
    second.store.beginTick();
    second.store.write('map', index, Tile.FIREBASE);
    const secondCalls: string[] = [];
    mapScanSlice(second.state, second.context, x, x + 1, {
      onFire: () => secondCalls.push('fire'),
    });
    expect(second.state.FirePop).toBe(1);
    expect(secondCalls).toEqual(['fire']);
  });

  it('increments FirePop only for fire tiles within the slice', () => {
    const { store, context, state } = createHarness(1);
    store.beginTick();

    const insideA = { x: 22, y: 10 };
    const insideB = { x: 23, y: 10 };
    const outside = { x: 24, y: 10 };

    store.write('map', indexFor(insideA.x, insideA.y), Tile.FIREBASE);
    store.write('map', indexFor(insideB.x, insideB.y), Tile.FIREBASE);
    store.write('map', indexFor(outside.x, outside.y), Tile.FIREBASE);

    mapScanSlice(state, context, insideA.x, insideB.x + 1);

    expect(state.FirePop).toBe(2);
  });

  it('routes flood and radiation tiles to their handlers', () => {
    const { store, context, state } = createHarness();
    store.beginTick();

    const x = 20;
    const y = 10;
    const index = indexFor(x, y);

    const calls: string[] = [];
    const handlers = {
      onFlood: () => calls.push('flood'),
      onRadTile: () => calls.push('rad'),
    };

    store.write('map', index, Tile.FLOOD);
    mapScanSlice(state, context, x, x + 1, handlers);

    store.write('map', index, Tile.RADTILE);
    mapScanSlice(state, context, x, x + 1, handlers);

    expect(calls).toEqual(['flood', 'rad']);
  });

  it('routes zone tiles before rail tiles when ZONEBIT is set', () => {
    const { store, context, state } = createHarness();
    store.beginTick();

    const x = 25;
    const y = 10;
    store.write('map', indexFor(x, y), Tile.RAILBASE | TileFlag.ZONEBIT);

    const calls: string[] = [];
    mapScanSlice(state, context, x, x + 1, {
      onZone: () => calls.push('zone'),
      onRail: () => calls.push('rail'),
    });

    expect(calls).toEqual(['zone']);
  });

  it('rewrites SOMETINYEXP..LASTTINYEXP to rubble with BULLBIT', () => {
    const { store, context, state } = createHarness(1);
    store.beginTick();

    const x = 30;
    const y = 10;
    const index = indexFor(x, y);

    store.write('map', index, Tile.SOMETINYEXP);
    mapScanSlice(state, context, x, x + 1);

    const map = store.getLayer('map') as Uint16Array;
    expect(map[index]).toBe(Tile.RUBBLE + 2 + TileFlag.BULLBIT);
  });

  it('rewrites LASTTINYEXP using the RNG rubble variant', () => {
    const { store, context, state } = createHarness(10);
    store.beginTick();

    const x = 30;
    const y = 11;
    const index = indexFor(x, y);

    store.write('map', index, Tile.LASTTINYEXP);
    mapScanSlice(state, context, x, x + 1);

    const map = store.getLayer('map') as Uint16Array;
    expect(map[index]).toBe(Tile.RUBBLE + 0 + TileFlag.BULLBIT);
  });

  it('does not rewrite tiny explosions outside the slice', () => {
    const { store, context, state } = createHarness();
    store.beginTick();

    const x = 40;
    const y = 10;
    const index = indexFor(x, y);

    store.write('map', index, Tile.SOMETINYEXP);
    mapScanSlice(state, context, x + 1, x + 2);

    const map = store.getLayer('map') as Uint16Array;
    expect(map[index]).toBe(Tile.SOMETINYEXP);
  });

  it('leaves TINYEXP tiles untouched', () => {
    const { store, context, state } = createHarness();
    store.beginTick();

    const x = 31;
    const y = 10;
    const index = indexFor(x, y);

    store.write('map', index, Tile.TINYEXP);
    mapScanSlice(state, context, x, x + 1);

    const map = store.getLayer('map') as Uint16Array;
    expect(map[index]).toBe(Tile.TINYEXP);
  });

  it('skips tiles below the FLOOD threshold', () => {
    const { store, context, state } = createHarness();
    store.beginTick();

    const x = 35;
    const y = 10;
    store.write('map', indexFor(x, y), Tile.RIVER);

    const calls: string[] = [];
    mapScanSlice(state, context, x, x + 1, {
      onFlood: () => calls.push('flood'),
      onFire: () => calls.push('fire'),
      onRoad: () => calls.push('road'),
    });

    expect(calls).toEqual([]);
  });

  it('does not dispatch conductive handling for tiles below FLOOD', () => {
    const { store, context, state } = createHarness();
    state.NewPower = 1;
    store.beginTick();

    const x = 36;
    const y = 10;
    store.write('map', indexFor(x, y), Tile.RIVER | TileFlag.CONDBIT);

    const calls: string[] = [];
    mapScanSlice(state, context, x, x + 1, {
      onConductive: () => calls.push('conductive'),
    });

    expect(calls).toEqual([]);
  });
});

describe('MapScan bounds validation', () => {
  it('throws when slice bounds are invalid', () => {
    const { store, context, state } = createHarness();
    store.beginTick();

    expect(() => mapScanSlice(state, context, -1, 5)).toThrow('mapScanSlice bounds out of range');
    expect(() => mapScanSlice(state, context, 0, WORLD_X + 1)).toThrow(
      'mapScanSlice bounds out of range',
    );
    expect(() => mapScanSlice(state, context, 8, 4)).toThrow('mapScanSlice bounds out of range');
  });
});
