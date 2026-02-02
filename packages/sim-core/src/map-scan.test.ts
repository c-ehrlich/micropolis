import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, World } from './constants.ts';
import { getMapScanSlice, mapScanSlice, runMapScanPhase } from './map-scan.ts';
import { createClassicMapStore } from './map-store.ts';

const { WORLD_X, WORLD_Y } = World;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

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
    const store = createClassicMapStore();
    store.beginTick();

    fillMap(store, Tile.ROADS);

    const slice = getMapScanSlice(3);
    if (!slice) {
      throw new Error('missing slice for phase 3');
    }

    mapScanSlice(store, slice.x1, slice.x2, {
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
    const store = createClassicMapStore();
    store.beginTick();

    fillMap(store, Tile.ROADS);

    const ran = runMapScanPhase(store, 7, {
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

    const ranOutside = runMapScanPhase(store, 12, {
      onRoad: (context) => context.writeTile(Tile.DIRT),
    });
    expect(ranOutside).toBe(false);
  });
});

describe('MapScan dispatch ordering', () => {
  it('invokes conductive handler before road handler on conductive road tiles', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const x = 10;
    const y = 10;
    store.write('map', indexFor(x, y), Tile.ROADS | TileFlag.CONDBIT);

    const calls: string[] = [];
    mapScanSlice(
      store,
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
    const store = createClassicMapStore();
    store.beginTick();

    const x = 12;
    const y = 10;
    store.write('map', indexFor(x, y), Tile.ROADS | TileFlag.CONDBIT);

    const calls: string[] = [];
    mapScanSlice(
      store,
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

  it('routes fire, flood, and radiation tiles to their handlers', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const x = 20;
    const y = 10;
    const index = indexFor(x, y);

    const calls: string[] = [];
    const handlers = {
      onFire: () => calls.push('fire'),
      onFlood: () => calls.push('flood'),
      onRadTile: () => calls.push('rad'),
    };

    store.write('map', index, Tile.FIREBASE);
    mapScanSlice(store, x, x + 1, handlers);

    store.write('map', index, Tile.FLOOD);
    mapScanSlice(store, x, x + 1, handlers);

    store.write('map', index, Tile.RADTILE);
    mapScanSlice(store, x, x + 1, handlers);

    expect(calls).toEqual(['fire', 'flood', 'rad']);
  });

  it('routes zone tiles before rail tiles when ZONEBIT is set', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const x = 25;
    const y = 10;
    store.write('map', indexFor(x, y), Tile.RAILBASE | TileFlag.ZONEBIT);

    const calls: string[] = [];
    mapScanSlice(store, x, x + 1, {
      onZone: () => calls.push('zone'),
      onRail: () => calls.push('rail'),
    });

    expect(calls).toEqual(['zone']);
  });

  it('routes only SOMETINYEXP..LASTTINYEXP to the tiny explosion handler', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const x = 30;
    const y = 10;
    const index = indexFor(x, y);

    const calls: string[] = [];
    const handlers = {
      onTinyExplosion: () => calls.push('tiny'),
    };

    store.write('map', index, Tile.TINYEXP);
    mapScanSlice(store, x, x + 1, handlers);

    store.write('map', index, Tile.SOMETINYEXP);
    mapScanSlice(store, x, x + 1, handlers);

    store.write('map', index, Tile.LASTTINYEXP);
    mapScanSlice(store, x, x + 1, handlers);

    expect(calls).toEqual(['tiny', 'tiny']);
  });

  it('skips tiles below the FLOOD threshold', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const x = 35;
    const y = 10;
    store.write('map', indexFor(x, y), Tile.RIVER);

    const calls: string[] = [];
    mapScanSlice(store, x, x + 1, {
      onFlood: () => calls.push('flood'),
      onFire: () => calls.push('fire'),
      onRoad: () => calls.push('road'),
    });

    expect(calls).toEqual([]);
  });
});

describe('MapScan bounds validation', () => {
  it('throws when slice bounds are invalid', () => {
    const store = createClassicMapStore();
    store.beginTick();

    expect(() => mapScanSlice(store, -1, 5)).toThrow('mapScanSlice bounds out of range');
    expect(() => mapScanSlice(store, 0, WORLD_X + 1)).toThrow('mapScanSlice bounds out of range');
    expect(() => mapScanSlice(store, 8, 4)).toThrow('mapScanSlice bounds out of range');
  });
});
