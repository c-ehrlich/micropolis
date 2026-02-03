import { describe, expect, it } from 'vitest';

import { assertDefined } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { doBridge } from './bridges.ts';
import type { MapScanContext } from './map-scan.ts';

const { WORLD_Y } = World;
const { ALLBITS, LOMASK } = TileMask;
const { BULLBIT } = TileFlag;
const {
  BRWH,
  BRWV,
  CHANNEL,
  HBRDG0,
  HBRDG1,
  HBRDG2,
  HBRDG3,
  HBRIDGE,
  RIVER,
  VBRDG0,
  VBRDG1,
  VBRDG2,
  VBRDG3,
  VBRIDGE,
} = Tile;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

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

const makeScan = (
  context: ReturnType<typeof createSimContext>,
  state: ReturnType<typeof createSimState>,
  x: number,
  y: number,
) => {
  const map = context.store.getLayer('map') as Uint16Array;
  const index = indexFor(x, y);
  const tile = map[index] ?? 0;

  const scan: MapScanContext = {
    store: context.store,
    state,
    rng: context.rng,
    map,
    x,
    y,
    index,
    tile,
    tileId: tile & LOMASK,
    flags: tile & ALLBITS,
    writeTile: (value: number) => context.store.write('map', index, value),
  };

  return scan;
};

const VDX = [0, 1, 0, 0, 0, 0, 1] as const;
const VDY = [-2, -2, -1, 0, 1, 2, 2] as const;
const VBRTAB = [
  VBRDG0 | BULLBIT,
  VBRDG1 | BULLBIT,
  RIVER,
  BRWV | BULLBIT,
  RIVER,
  VBRDG2 | BULLBIT,
  VBRDG3 | BULLBIT,
] as const;
const VBRTAB2 = [
  VBRIDGE | BULLBIT,
  RIVER,
  VBRIDGE | BULLBIT,
  VBRIDGE | BULLBIT,
  VBRIDGE | BULLBIT,
  VBRIDGE | BULLBIT,
  RIVER,
] as const;

const HDX = [-2, 2, -2, -1, 0, 1, 2] as const;
const HDY = [-1, -1, 0, 0, 0, 0, 0] as const;
const HBRTAB = [
  HBRDG1 | BULLBIT,
  HBRDG3 | BULLBIT,
  HBRDG0 | BULLBIT,
  RIVER,
  BRWH | BULLBIT,
  RIVER,
  HBRDG2 | BULLBIT,
] as const;
const HBRTAB2 = [
  RIVER,
  RIVER,
  HBRIDGE | BULLBIT,
  HBRIDGE | BULLBIT,
  HBRIDGE | BULLBIT,
  HBRIDGE | BULLBIT,
  HBRIDGE | BULLBIT,
] as const;

const setPattern = (
  store: ReturnType<typeof createClassicMapStore>,
  baseX: number,
  baseY: number,
  dx: readonly number[],
  dy: readonly number[],
  pattern: readonly number[],
) => {
  for (let z = 0; z < 7; z += 1) {
    const dxz = dx[z];
    const dyz = dy[z];
    assertDefined(dxz);
    assertDefined(dyz);
    const x = baseX + dxz;
    const y = baseY + dyz;

    const pz = pattern[z];
    assertDefined(pz);
    store.write('map', indexFor(x, y), pz);
  }
};

describe('DoBridge', () => {
  it('closes a vertical bridge when the boat is far and RNG matches', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const context = createSimContext({
      store,
      rng: new StubRng([0]),
    });

    const baseX = 10;
    const baseY = 10;
    setPattern(store, baseX, baseY, VDX, VDY, VBRTAB);

    const scan = makeScan(context, state, baseX, baseY);
    const result = doBridge(scan, context, () => 400);

    expect(result).toBe(true);

    const map = store.getLayer('map') as Uint16Array;
    for (let z = 0; z < 7; z += 1) {
      const dxz = VDX[z];
      const dyz = VDY[z];
      assertDefined(dxz);
      assertDefined(dyz);
      const x = baseX + dxz;
      const y = baseY + dyz;
      const tile = map[indexFor(x, y)];
      assertDefined(tile);
      const expected = VBRTAB2[z];
      assertDefined(expected);
      expect(tile).toBe(expected);
    }
  });

  it('opens a horizontal bridge when the boat is near and a channel is above', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const context = createSimContext({
      store,
      rng: new StubRng([]),
    });

    const baseX = 12;
    const baseY = 14;
    setPattern(store, baseX, baseY, HDX, HDY, HBRTAB2);
    store.write('map', indexFor(baseX, baseY - 1), CHANNEL);

    const scan = makeScan(context, state, baseX, baseY);
    const result = doBridge(scan, context, () => 200);

    expect(result).toBe(true);

    const map = store.getLayer('map') as Uint16Array;
    for (let z = 0; z < 7; z += 1) {
      const dxz = HDX[z];
      const dyz = HDY[z];
      assertDefined(dxz);
      assertDefined(dyz);
      const x = baseX + dxz;
      const y = baseY + dyz;
      const tile = map[indexFor(x, y)];
      assertDefined(tile);
      const expected = HBRTAB[z];
      assertDefined(expected);
      expect(tile).toBe(expected);
    }
  });

  it('does not open a horizontal bridge without a channel above', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    const context = createSimContext({
      store,
      rng: new StubRng([]),
    });

    const baseX = 18;
    const baseY = 16;
    setPattern(store, baseX, baseY, HDX, HDY, HBRTAB2);
    store.write('map', indexFor(baseX, baseY - 1), RIVER);

    const scan = makeScan(context, state, baseX, baseY);
    const result = doBridge(scan, context, () => 200);

    expect(result).toBe(false);

    const map = store.getLayer('map') as Uint16Array;
    for (let z = 0; z < 7; z += 1) {
      const dxz = HDX[z];
      const dyz = HDY[z];
      assertDefined(dxz);
      assertDefined(dyz);
      const x = baseX + dxz;
      const y = baseY + dyz;
      const tile = map[indexFor(x, y)];
      assertDefined(tile);
      const expected = HBRTAB2[z];
      assertDefined(expected);
      expect(tile).toBe(expected);
    }
  });
});
