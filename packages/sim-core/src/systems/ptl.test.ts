import { describe, expect, it } from 'vitest';

import { Tile, World } from '../core/constants.ts';
import { MAP_FLAGS } from '../core/map-flags.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { ptlScan } from './ptl.ts';

const { WORLD_Y, HWLDY, QWY } = World;

const mapIndex = (x: number, y: number): number => x * WORLD_Y + y;
const halfIndex = (x: number, y: number): number => x * HWLDY + y;
const quarterIndex = (x: number, y: number): number => x * QWY + y;

const averageNonZero = (values: Uint8Array): number => {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (value) {
      sum += value;
      count += 1;
    }
  }
  return count ? Math.floor(sum / count) : 0;
};

describe('PTLScan', () => {
  it('computes land value, pollution, and terrain for a small setup', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.CCx2 = 0;
    state.CCy2 = 0;
    state.DonDither = 0;

    const context = createSimContext({ store });

    const map = store.getLayer('map') as Uint16Array;
    const terrainMem = store.getLayer('terrainMem') as Uint8Array;
    const pollutionMem = store.getLayer('pollutionMem') as Uint8Array;
    const crimeMem = store.getLayer('crimeMem') as Uint8Array;

    terrainMem[quarterIndex(0, 0)] = 10;
    pollutionMem[halfIndex(1, 1)] = 20;
    crimeMem[halfIndex(1, 1)] = 0;

    map[mapIndex(0, 0)] = Tile.RIVER;
    map[mapIndex(2, 2)] = Tile.ROADS;
    map[mapIndex(2, 3)] = Tile.IND1;
    map[mapIndex(3, 2)] = Tile.RADTILE;

    ptlScan(state, context);

    const tem = store.getLayer('tem') as Uint8Array;
    const qtem = store.getLayer('qtem') as Uint8Array;
    const landValueMem = store.getLayer('landValueMem') as Uint8Array;
    const pollutionAfter = store.getLayer('pollutionMem') as Uint8Array;
    const terrainAfter = store.getLayer('terrainMem') as Uint8Array;

    expect(qtem[quarterIndex(0, 0)]).toBe(15);
    expect(terrainAfter[quarterIndex(0, 0)]).toBe(7);

    expect(landValueMem[halfIndex(1, 1)]).toBe(118);
    expect(landValueMem[halfIndex(0, 0)]).toBe(0);

    expect(tem[halfIndex(1, 1)]).toBe(78);
    expect(pollutionAfter[halfIndex(1, 1)]).toBe(78);
    expect(pollutionAfter[halfIndex(3, 1)]).toBe(15);

    expect(state.PolMaxX).toBe(2);
    expect(state.PolMaxY).toBe(2);

    expect(state.PolluteAverage).toBe(averageNonZero(pollutionAfter));
    expect(state.LVAverage).toBe(averageNonZero(landValueMem));

    // s_scan.c PTLScan: NewMapFlags[DYMAP|PLMAP|LVMAP] = 1.
    expect(state.NewMapFlags[MAP_FLAGS.DYMAP]).toBe(1);
    expect(state.NewMapFlags[MAP_FLAGS.PLMAP]).toBe(1);
    expect(state.NewMapFlags[MAP_FLAGS.LVMAP]).toBe(1);
  });
});
