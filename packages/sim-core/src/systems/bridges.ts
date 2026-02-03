import { assertDefined } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import type { MapScanContext } from './map-scan.ts';
import type { BridgeHandler } from './roads.ts';

const { WORLD_X, WORLD_Y } = World;
const { LOMASK } = TileMask;
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

const SHAPE_MASK = 15;

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

const DEFAULT_BOAT_DISTANCE = 99999;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < WORLD_X && y < WORLD_Y;

export interface BridgeHandlerOptions {
  getBoatDistance?: () => number;
}

export function createBridgeHandler(
  _state: SimState,
  context: SimContext,
  options: BridgeHandlerOptions = {},
): BridgeHandler {
  const getBoatDistance =
    options.getBoatDistance ?? context.hooks.getBoatDistance ?? (() => DEFAULT_BOAT_DISTANCE);

  return (scan) => doBridge(scan, context, getBoatDistance);
}

export function doBridge(
  scan: MapScanContext,
  context: SimContext,
  getBoatDistance: () => number,
): boolean {
  const { map, store } = scan;
  const baseX = scan.x;
  const baseY = scan.y;

  if (scan.tileId === BRWV) {
    if ((context.rng.next16() & 3) === 0 && getBoatDistance() > 340) {
      for (let z = 0; z < 7; z += 1) {
        const vdx = VDX[z];
        const vdy = VDY[z];
        assertDefined(vdx);
        assertDefined(vdy);
        const x = baseX + vdx;
        const y = baseY + vdy;
        if (!inBounds(x, y)) {
          continue;
        }
        const index = indexFor(x, y);
        const vt1 = VBRTAB[z];
        const vt2 = VBRTAB2[z];
        assertDefined(vt1);
        assertDefined(vt2);
        if (((map[index] ?? 0) & LOMASK) === (vt1 & LOMASK)) {
          store.write('map', index, vt2);
        }
      }
    }
    return true;
  }

  if (scan.tileId === BRWH) {
    if ((context.rng.next16() & 3) === 0 && getBoatDistance() > 340) {
      for (let z = 0; z < 7; z += 1) {
        const hdx = HDX[z];
        const hdy = HDY[z];
        assertDefined(hdx);
        assertDefined(hdy);
        const x = baseX + hdx;
        const y = baseY + hdy;
        if (!inBounds(x, y)) {
          continue;
        }
        const index = indexFor(x, y);
        const ht1 = HBRTAB[z];
        const ht2 = HBRTAB2[z];
        assertDefined(ht1);
        assertDefined(ht2);
        if (((map[index] ?? 0) & LOMASK) === (ht1 & LOMASK)) {
          store.write('map', index, ht2);
        }
      }
    }
    return true;
  }

  const boatDistance = getBoatDistance();
  if (boatDistance < 300 || (context.rng.next16() & 7) === 0) {
    if ((scan.tileId & 1) !== 0) {
      if (baseX < WORLD_X - 1) {
        const channelIndex = indexFor(baseX + 1, baseY);
        if ((map[channelIndex] ?? 0) === CHANNEL) {
          for (let z = 0; z < 7; z += 1) {
            const vdx = VDX[z];
            const vdy = VDY[z];
            assertDefined(vdx);
            assertDefined(vdy);
            const x = baseX + vdx;
            const y = baseY + vdy;
            if (!inBounds(x, y)) {
              continue;
            }
            const index = indexFor(x, y);
            const value = map[index] ?? 0;
            const vt1 = VBRTAB[z];
            const vt2 = VBRTAB2[z];
            assertDefined(vt1);
            assertDefined(vt2);
            if (value === CHANNEL || (value & SHAPE_MASK) === (vt2 & SHAPE_MASK)) {
              store.write('map', index, vt1);
            }
          }
          return true;
        }
      }
      return false;
    }

    if (baseY > 0) {
      const channelIndex = indexFor(baseX, baseY - 1);
      if ((map[channelIndex] ?? 0) === CHANNEL) {
        for (let z = 0; z < 7; z += 1) {
          const hdx = HDX[z];
          const hdy = HDY[z];
          assertDefined(hdx);
          assertDefined(hdy);
          const x = baseX + hdx;
          const y = baseY + hdy;
          if (!inBounds(x, y)) {
            continue;
          }
          const index = indexFor(x, y);
          const value = map[index] ?? 0;
          const ht1 = HBRTAB[z];
          const ht2 = HBRTAB2[z];
          assertDefined(ht1);
          assertDefined(ht2);
          if (value === CHANNEL || (value & SHAPE_MASK) === (ht2 & SHAPE_MASK)) {
            store.write('map', index, ht1);
          }
        }
        return true;
      }
    }
    return false;
  }

  return false;
}
