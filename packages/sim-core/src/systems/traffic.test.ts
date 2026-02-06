import {
  runCoreOracleInitNewCity,
  runCoreOracleMakeTraf,
} from '@city/micropolis-c-harness/core-parity';
import { describe, expect, it } from 'vitest';

import { Tile, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { decTrafficMem, makeTraf } from './traffic.ts';

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

  override rand(range: number): number {
    if (range <= 0) {
      return 0;
    }
    return this.next16() % (range + 1);
  }
}

describe('Traffic system', () => {
  it('returns -1 when no perimeter road is found', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const context = createSimContext({ store, rng: new StubRng([0]) });

    const result = makeTraf(state, context, 10, 10, 0);

    expect(result).toBe(-1);
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    expect(trfDensity.every((value) => value === 0)).toBe(true);
  });

  it('uses deterministic paths to update traffic density', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const context = createSimContext({ store, rng: new StubRng([0, 0]) });

    const centerX = 9;
    const centerY = 10;
    const startX = centerX - 1;
    const startY = centerY - 2;

    store.write('map', indexFor(startX, startY), Tile.ROADS);
    store.write('map', indexFor(startX + 1, startY), Tile.ROADS);
    store.write('map', indexFor(startX + 2, startY), Tile.ROADS);
    store.write('map', indexFor(startX + 3, startY), Tile.COMBASE);

    const result = makeTraf(state, context, centerX, centerY, 0);

    expect(result).toBe(1);
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    expect(trfDensity[trfIndexFor(startX + 2, startY)]).toBe(50);
    expect(trfDensity[trfIndexFor(startX + 1, startY)]).toBe(0);
  });

  it('fails deterministically when a random branch leads to a dead end', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const context = createSimContext({ store, rng: new StubRng([2, 0]) });

    const centerX = 9;
    const centerY = 10;
    const startX = centerX - 1;
    const startY = centerY - 2;

    store.write('map', indexFor(startX, startY), Tile.ROADS);
    store.write('map', indexFor(startX + 1, startY), Tile.ROADS);
    store.write('map', indexFor(startX, startY + 1), Tile.ROADS);
    store.write('map', indexFor(startX + 3, startY), Tile.COMBASE);

    const result = makeTraf(state, context, centerX, centerY, 0);

    expect(result).toBe(0);
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    expect(trfDensity.every((value) => value === 0)).toBe(true);
  });

  it('caps density and updates traffic max when congestion spikes', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const sprite = { control: -1, dest_x: 0, dest_y: 0 };
    const context = createSimContext({
      store,
      rng: new StubRng([0, 0, 0]),
      hooks: {
        getSprite: (type) => (type === 2 ? sprite : null),
      },
    });

    const centerX = 9;
    const centerY = 10;
    const startX = centerX - 1;
    const startY = centerY - 2;
    const pushX = startX + 2;
    const pushY = startY;

    store.write('map', indexFor(startX, startY), Tile.ROADS);
    store.write('map', indexFor(startX + 1, startY), Tile.ROADS);
    store.write('map', indexFor(pushX, pushY), Tile.ROADS);
    store.write('map', indexFor(startX + 3, startY), Tile.COMBASE);
    store.write('trfDensity', trfIndexFor(pushX, pushY), 200);

    const result = makeTraf(state, context, centerX, centerY, 0);

    expect(result).toBe(1);
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    expect(trfDensity[trfIndexFor(pushX, pushY)]).toBe(240);
    expect(state.TrafMaxX).toBe(pushX << 4);
    expect(state.TrafMaxY).toBe(pushY << 4);
    expect(sprite.dest_x).toBe(pushX << 4);
    expect(sprite.dest_y).toBe(pushY << 4);
  });

  it('decays traffic memory according to thresholds', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const context = createSimContext({ store });

    store.write('trfDensity', 0, 24);
    store.write('trfDensity', 1, 25);
    store.write('trfDensity', 2, 200);
    store.write('trfDensity', 3, 201);

    decTrafficMem(state, context);

    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    expect(trfDensity[0]).toBe(0);
    expect(trfDensity[1]).toBe(1);
    expect(trfDensity[2]).toBe(176);
    expect(trfDensity[3]).toBe(167);
  });
});

describe('Traffic parity against C oracle (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  it('matches C MakeTraf result, traffic deltas, and traffic maxima', () => {
    const seed = 0x00c0ffee;
    const centerX = 9;
    const centerY = 10;
    const startX = centerX - 1;
    const startY = centerY - 2;
    const pushX = startX + 2;
    const pushY = startY;

    const oracleBefore = runCoreOracleInitNewCity({ seed });
    oracleBefore.map[indexFor(startX, startY)] = Tile.ROADS;
    oracleBefore.map[indexFor(startX + 1, startY)] = Tile.ROADS;
    oracleBefore.map[indexFor(pushX, pushY)] = Tile.ROADS;
    oracleBefore.map[indexFor(startX + 3, startY)] = Tile.COMBASE;
    oracleBefore.trfDensity[trfIndexFor(pushX, pushY)] = 200;
    oracleBefore.copControl = -1;
    oracleBefore.copDestX = 0;
    oracleBefore.copDestY = 0;

    const oracleResult = runCoreOracleMakeTraf({
      state: oracleBefore,
      x: centerX,
      y: centerY,
      source: 0,
    });

    const store = createClassicMapStore();
    const state = createSimState();
    const sprite = { control: -1, dest_x: 0, dest_y: 0 };
    const context = createSimContext({
      store,
      rng: new MicropolisRng(seed),
      hooks: {
        getSprite: (type) => (type === 2 ? sprite : null),
      },
    });

    store.beginTick();
    (store.getLayer('map') as Uint16Array).set(oracleBefore.map);
    (store.getLayer('trfDensity') as Uint8Array).set(oracleBefore.trfDensity);
    const tsResult = makeTraf(state, context, centerX, centerY, 0);

    // `SetTrafMem` in `ref/micropolis/src/sim/s_traf.c` adds 50 traffic and caps at
    // 240 with a `Rand(5)` branch; this assertion confirms those exact C constants.
    expect(tsResult).toBe(oracleResult.result);
    expect(Array.from(store.getLayer('trfDensity') as Uint8Array)).toEqual(
      Array.from(oracleResult.state.trfDensity),
    );
    expect(state.TrafMaxX).toBe(oracleResult.state.TrafMaxX);
    expect(state.TrafMaxY).toBe(oracleResult.state.TrafMaxY);
    expect(sprite.dest_x).toBe(oracleResult.state.copDestX);
    expect(sprite.dest_y).toBe(oracleResult.state.copDestY);
    store.commitTick();
  });

  it('matches C MakeTraf no-road result (-1)', () => {
    const seed = 0x0000beef;
    const centerX = 10;
    const centerY = 10;

    const oracleBefore = runCoreOracleInitNewCity({ seed });
    const oracleResult = runCoreOracleMakeTraf({
      state: oracleBefore,
      x: centerX,
      y: centerY,
      source: 0,
    });

    const store = createClassicMapStore();
    const state = createSimState();
    const context = createSimContext({
      store,
      rng: new MicropolisRng(seed),
    });

    store.beginTick();
    (store.getLayer('map') as Uint16Array).set(oracleBefore.map);
    (store.getLayer('trfDensity') as Uint8Array).set(oracleBefore.trfDensity);
    const tsResult = makeTraf(state, context, centerX, centerY, 0);

    // `MakeTraf` in `ref/micropolis/src/sim/s_traf.c` returns `-1` when `FindPRoad`
    // fails on all 12 perimeter probes.
    expect(tsResult).toBe(-1);
    expect(tsResult).toBe(oracleResult.result);
    expect(Array.from(store.getLayer('trfDensity') as Uint8Array)).toEqual(
      Array.from(oracleResult.state.trfDensity),
    );
    store.commitTick();
  });
});
