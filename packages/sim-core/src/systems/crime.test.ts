import { describe, expect, it } from 'vitest';

import { World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { crimeScan, smoothPSMap } from './crime.ts';

const { HWLDY, SmY } = World;

const hwIndex = (x: number, y: number): number => x * HWLDY + y;
const smIndex = (x: number, y: number): number => x * SmY + y;

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
}

describe('SmoothPSMap', () => {
  it('averages four neighbors and halves', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const policeMap = store.getLayer('policeMap') as Int16Array;
    const sTem = store.getLayer('sTem') as Int16Array;

    policeMap[smIndex(1, 1)] = 16;

    smoothPSMap(policeMap, sTem);

    expect(policeMap[smIndex(1, 1)]).toBe(8);
    expect(policeMap[smIndex(1, 0)]).toBe(2);
  });
});

describe('CrimeScan', () => {
  it('smooths police coverage three times before snapshotting', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const context = createSimContext({ store, rng: new StubRng([]) });

    const policeMap = store.getLayer('policeMap') as Int16Array;
    policeMap[smIndex(0, 0)] = 32;

    crimeScan(state, context);

    const policeMapEffect = store.getLayer('policeMapEffect') as Int16Array;
    expect(policeMapEffect[smIndex(0, 0)]).toBe(5);
  });

  it('computes crime values, averages, and snapshots police coverage', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const context = createSimContext({ store, rng: new StubRng([0]) });

    const landValue = store.getLayer('landValueMem') as Uint8Array;
    const popDensity = store.getLayer('popDensity') as Uint8Array;
    const policeMap = store.getLayer('policeMap') as Int16Array;

    policeMap.fill(10);

    const a = hwIndex(2, 3);
    const b = hwIndex(4, 5);
    landValue[a] = 100;
    popDensity[a] = 20;
    landValue[b] = 100;
    popDensity[b] = 20;

    crimeScan(state, context);

    const crimeMem = store.getLayer('crimeMem') as Uint8Array;
    expect(crimeMem[a]).toBe(38);
    expect(crimeMem[b]).toBe(38);
    expect(state.CrimeAverage).toBe(38);
    expect(state.CrimeMaxX).toBe(8);
    expect(state.CrimeMaxY).toBe(10);

    const policeMapEffect = store.getLayer('policeMapEffect') as Int16Array;
    expect(policeMapEffect[smIndex(0, 0)]).toBe(10);
  });

  it('clamps computed crime into [0, 250]', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const context = createSimContext({ store, rng: new StubRng([]) });

    const landValue = store.getLayer('landValueMem') as Uint8Array;
    const popDensity = store.getLayer('popDensity') as Uint8Array;

    const high = hwIndex(1, 1);
    landValue[high] = 1;
    popDensity[high] = 250;

    const low = hwIndex(2, 1);
    landValue[low] = 255;
    popDensity[low] = 0;

    crimeScan(state, context);

    const crimeMem = store.getLayer('crimeMem') as Uint8Array;
    expect(crimeMem[high]).toBe(250);
    expect(crimeMem[low]).toBe(0);
    expect(state.CrimeAverage).toBe(125);
  });
});
