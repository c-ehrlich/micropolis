import { describe, expect, it } from 'vitest';

import { PowerMap, Tile, TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { createFireHandler } from '../systems/disasters.ts';
import { fireAnalysis } from '../systems/fire-coverage.ts';
import { mapScanSlice } from '../systems/map-scan.ts';
import { createZoneHandler } from '../systems/zones.ts';

const { WORLD_Y, SmY } = World;
const { POWERMAPROW } = PowerMap;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;
const smallIndex = (x: number, y: number) => (x >> 3) * SmY + (y >> 3);

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

describe('Fire Coverage E2E', () => {
  it('burns out a fire when coverage drives the rate to 1', () => {
    const store = createClassicMapStore();
    const rng = new StubRng([0, 1, 1, 1, 1, 2, 0]);
    const context = createSimContext({ store, rng });
    const state = createSimState();

    store.beginTick();

    const x = 8;
    const y = 8;

    store.write('map', indexFor(x, y), Tile.FIRESTATION | TileFlag.ZONEBIT | TileFlag.BNCNBIT);
    store.write('map', indexFor(x - 1, y - 2), Tile.ROADS);

    const powerWord = (x >> 4) + y * POWERMAPROW;
    store.write('power', powerWord, 1 << (x & 15));

    mapScanSlice(state, context, x, x + 1, { onZone: createZoneHandler(state, context) });
    fireAnalysis(state, context);

    const fireRate = store.getLayer('fireRate') as Int16Array;
    expect(fireRate[smallIndex(x, y)]).toBeGreaterThan(100);

    store.write('map', indexFor(x, y), Tile.FIREBASE);

    mapScanSlice(state, context, x, x + 1, { onFire: createFireHandler(context) });

    const map = store.getLayer('map') as Uint16Array;
    expect(map[indexFor(x, y)]).toBe(Tile.RUBBLE + TileFlag.BULLBIT);

    store.commitTick();
  });
});
