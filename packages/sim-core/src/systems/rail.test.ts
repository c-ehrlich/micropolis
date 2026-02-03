import { describe, expect, it, vi } from 'vitest';

import { Tile, TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { mapScanSlice } from './map-scan.ts';
import { createRailHandler } from './rail.ts';

const { WORLD_Y } = World;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

describe('DoRail', () => {
  it('increments RailTotal and calls GenerateTrain', () => {
    const store = createClassicMapStore();
    const generateTrain = vi.fn();
    const context = createSimContext({ store, hooks: { generateTrain } });
    const state = createSimState();

    const x = 10;
    const y = 12;

    store.beginTick();
    store.write('map', indexFor(x, y), Tile.RAILBASE);

    mapScanSlice(state, context, x, x + 1, { onRail: createRailHandler(state, context) });

    const map = store.getLayer('map') as Uint16Array;
    expect(state.RailTotal).toBe(1);
    expect(generateTrain).toHaveBeenCalledWith(x, y);
    expect(map[indexFor(x, y)]).toBe(Tile.RAILBASE);
  });

  it('deterministically decays straight rail to river', () => {
    const store = createClassicMapStore();
    const rng = createRng(711);
    const context = createSimContext({ store, rng });
    const state = createSimState();
    state.RoadEffect = 10;

    const x = 4;
    const y = 7;

    store.beginTick();
    store.write('map', indexFor(x, y), Tile.HRAIL);

    mapScanSlice(state, context, x, x + 1, { onRail: createRailHandler(state, context) });

    const map = store.getLayer('map') as Uint16Array;
    expect(state.RailTotal).toBe(1);
    expect(map[indexFor(x, y)]).toBe(Tile.RIVER);
  });

  it('deterministically decays non-straight rail to rubble', () => {
    const store = createClassicMapStore();
    const rng = createRng(711);
    const context = createSimContext({ store, rng });
    const state = createSimState();
    state.RoadEffect = 10;

    const expectedRng = createRng(711);
    expectedRng.next16();
    expectedRng.next16();
    const expectedTile = Tile.RUBBLE + (expectedRng.next16() & 3) + TileFlag.BULLBIT;

    const x = 6;
    const y = 9;

    store.beginTick();
    store.write('map', indexFor(x, y), Tile.LHRAIL);

    mapScanSlice(state, context, x, x + 1, { onRail: createRailHandler(state, context) });

    const map = store.getLayer('map') as Uint16Array;
    expect(state.RailTotal).toBe(1);
    expect(map[indexFor(x, y)]).toBe(expectedTile);
  });

  it('does not decay when RoadEffect is 30 or higher', () => {
    const store = createClassicMapStore();
    const rng = createRng(711);
    const context = createSimContext({ store, rng });
    const state = createSimState();
    state.RoadEffect = 30;

    const x = 8;
    const y = 4;

    store.beginTick();
    store.write('map', indexFor(x, y), Tile.HRAIL);

    mapScanSlice(state, context, x, x + 1, { onRail: createRailHandler(state, context) });

    const map = store.getLayer('map') as Uint16Array;
    expect(state.RailTotal).toBe(1);
    expect(map[indexFor(x, y)]).toBe(Tile.HRAIL);
  });

  it('does not decay when CONDBIT is set even if rng gate fires', () => {
    const store = createClassicMapStore();
    const rng = createRng(711);
    const context = createSimContext({ store, rng });
    const state = createSimState();
    state.RoadEffect = 10;

    const x = 9;
    const y = 5;

    store.beginTick();
    store.write('map', indexFor(x, y), Tile.HRAIL | TileFlag.CONDBIT);

    mapScanSlice(state, context, x, x + 1, { onRail: createRailHandler(state, context) });

    const map = store.getLayer('map') as Uint16Array;
    expect(state.RailTotal).toBe(1);
    expect(map[indexFor(x, y)]).toBe(Tile.HRAIL | TileFlag.CONDBIT);
  });

  it('does not decay when rng gate does not fire', () => {
    const store = createClassicMapStore();
    const rng = createRng(1);
    const context = createSimContext({ store, rng });
    const state = createSimState();
    state.RoadEffect = 10;

    const x = 11;
    const y = 6;

    store.beginTick();
    store.write('map', indexFor(x, y), Tile.HRAIL);

    mapScanSlice(state, context, x, x + 1, { onRail: createRailHandler(state, context) });

    const map = store.getLayer('map') as Uint16Array;
    expect(state.RailTotal).toBe(1);
    expect(map[indexFor(x, y)]).toBe(Tile.HRAIL);
  });

  it('calls GenerateTrain even when decay happens', () => {
    const store = createClassicMapStore();
    const rng = createRng(711);
    const generateTrain = vi.fn();
    const context = createSimContext({ store, rng, hooks: { generateTrain } });
    const state = createSimState();
    state.RoadEffect = 10;

    const x = 13;
    const y = 8;

    store.beginTick();
    store.write('map', indexFor(x, y), Tile.HRAIL);

    mapScanSlice(state, context, x, x + 1, { onRail: createRailHandler(state, context) });

    expect(generateTrain).toHaveBeenCalledWith(x, y);
  });

  it('increments RailTotal for each rail tile scanned', () => {
    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();
    state.RoadEffect = 32;

    const x = 14;
    const ys = [2, 3, 4];

    store.beginTick();
    for (const y of ys) {
      store.write('map', indexFor(x, y), Tile.HRAIL);
    }

    mapScanSlice(state, context, x, x + 1, { onRail: createRailHandler(state, context) });

    expect(state.RailTotal).toBe(ys.length);
  });
});
