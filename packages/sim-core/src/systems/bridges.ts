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
        const x = baseX + VDX[z];
        const y = baseY + VDY[z];
        if (!inBounds(x, y)) {
          continue;
        }
        const index = indexFor(x, y);
        if (((map[index] ?? 0) & LOMASK) === (VBRTAB[z] & LOMASK)) {
          store.write('map', index, VBRTAB2[z]);
        }
      }
    }
    return true;
  }

  if (scan.tileId === BRWH) {
    if ((context.rng.next16() & 3) === 0 && getBoatDistance() > 340) {
      for (let z = 0; z < 7; z += 1) {
        const x = baseX + HDX[z];
        const y = baseY + HDY[z];
        if (!inBounds(x, y)) {
          continue;
        }
        const index = indexFor(x, y);
        if (((map[index] ?? 0) & LOMASK) === (HBRTAB[z] & LOMASK)) {
          store.write('map', index, HBRTAB2[z]);
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
            const x = baseX + VDX[z];
            const y = baseY + VDY[z];
            if (!inBounds(x, y)) {
              continue;
            }
            const index = indexFor(x, y);
            const value = map[index] ?? 0;
            if (value === CHANNEL || (value & SHAPE_MASK) === (VBRTAB2[z] & SHAPE_MASK)) {
              store.write('map', index, VBRTAB[z]);
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
          const x = baseX + HDX[z];
          const y = baseY + HDY[z];
          if (!inBounds(x, y)) {
            continue;
          }
          const index = indexFor(x, y);
          const value = map[index] ?? 0;
          if (value === CHANNEL || (value & SHAPE_MASK) === (HBRTAB2[z] & SHAPE_MASK)) {
            store.write('map', index, HBRTAB[z]);
          }
        }
        return true;
      }
    }
    return false;
  }

  return false;
}
