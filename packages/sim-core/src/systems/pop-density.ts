import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import type { MapStore } from '../core/map-store.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import { countFreeZoneHouses, czPop, izPop, rzPop } from './zones.ts';

const { WORLD_X, WORLD_Y, HWLDX, HWLDY, SmX, SmY } = World;
const { ZONEBIT } = TileFlag;
const { LOMASK } = TileMask;

/**
 * Compute a half-resolution (2x2) index into HWLD arrays.
 * Mirrors the HWLD indexing used throughout `PopDenScan` in `ref/micropolis/src/sim/s_scan.c`.
 */
const halfIndex = (x: number, y: number) => x * HWLDY + y;

/**
 * Clamp smoothing accumulator output to the unsigned byte range.
 * Matches the `z > 255` guard in `DoSmooth`/`DoSmooth2` from `ref/micropolis/src/sim/s_scan.c`.
 */
const clamp255 = (value: number) => (value > 255 ? 255 : value);

/**
 * Clear the PopDenScan scratch buffer.
 * Mirrors `ClrTemArray` in `ref/micropolis/src/sim/s_scan.c`.
 */
export function clearTemArray(tem: Uint8Array): void {
  tem.fill(0);
}

/**
 * Smooth data from `tem` into `tem2`.
 * Mirrors `DoSmooth` in `ref/micropolis/src/sim/s_scan.c` (including dithered path).
 */
export function doSmooth(tem: Uint8Array, tem2: Uint8Array, donDither = 0): void {
  if ((donDither & 2) !== 0) {
    let y = 0;
    let z = 0;
    let dir = 1;
    for (let x = 0; x < HWLDX; x += 1) {
      for (; y !== HWLDY && y !== -1; y += dir) {
        z +=
          (tem[halfIndex(x === 0 ? x : x - 1, y)] ?? 0) +
          (tem[halfIndex(x === HWLDX - 1 ? x : x + 1, y)] ?? 0) +
          (tem[halfIndex(x, y === 0 ? 0 : y - 1)] ?? 0) +
          (tem[halfIndex(x, y === HWLDY - 1 ? y : y + 1)] ?? 0) +
          (tem[halfIndex(x, y)] ?? 0);
        tem2[halfIndex(x, y)] = (z >>> 2) & 0xff;
        z &= 3;
      }
      dir = -dir;
      y += dir;
    }
    return;
  }

  for (let x = 0; x < HWLDX; x += 1) {
    const base = x * HWLDY;
    for (let y = 0; y < HWLDY; y += 1) {
      let z = 0;
      if (x > 0) z += tem[halfIndex(x - 1, y)] ?? 0;
      if (x < HWLDX - 1) z += tem[halfIndex(x + 1, y)] ?? 0;
      if (y > 0) z += tem[halfIndex(x, y - 1)] ?? 0;
      if (y < HWLDY - 1) z += tem[halfIndex(x, y + 1)] ?? 0;
      z = (z + (tem[base + y] ?? 0)) >> 2;
      tem2[base + y] = clamp255(z);
    }
  }
}

/**
 * Smooth data from `tem2` into `tem`.
 * Mirrors `DoSmooth2` in `ref/micropolis/src/sim/s_scan.c` (including dithered path).
 */
export function doSmooth2(tem: Uint8Array, tem2: Uint8Array, donDither = 0): void {
  if ((donDither & 4) !== 0) {
    let y = 0;
    let z = 0;
    let dir = 1;
    for (let x = 0; x < HWLDX; x += 1) {
      for (; y !== HWLDY && y !== -1; y += dir) {
        z +=
          (tem2[halfIndex(x === 0 ? x : x - 1, y)] ?? 0) +
          (tem2[halfIndex(x === HWLDX - 1 ? x : x + 1, y)] ?? 0) +
          (tem2[halfIndex(x, y === 0 ? 0 : y - 1)] ?? 0) +
          (tem2[halfIndex(x, y === HWLDY - 1 ? y : y + 1)] ?? 0) +
          (tem2[halfIndex(x, y)] ?? 0);
        tem[halfIndex(x, y)] = ((z & 0xff) >>> 2) & 0xff;
        z &= 3;
      }
      dir = -dir;
      y += dir;
    }
    return;
  }

  for (let x = 0; x < HWLDX; x += 1) {
    const base = x * HWLDY;
    for (let y = 0; y < HWLDY; y += 1) {
      let z = 0;
      if (x > 0) z += tem2[halfIndex(x - 1, y)] ?? 0;
      if (x < HWLDX - 1) z += tem2[halfIndex(x + 1, y)] ?? 0;
      if (y > 0) z += tem2[halfIndex(x, y - 1)] ?? 0;
      if (y < HWLDY - 1) z += tem2[halfIndex(x, y + 1)] ?? 0;
      z = (z + (tem2[base + y] ?? 0)) >> 2;
      tem[base + y] = clamp255(z);
    }
  }
}

/**
 * Resolve population density contribution for a zone center.
 * Mirrors `GetPDen` in `ref/micropolis/src/sim/s_scan.c`.
 */
export function getPDen(tileId: number, map: Uint16Array, x: number, y: number): number {
  if (tileId === Tile.FREEZ) {
    return countFreeZoneHouses(map, x, y);
  }
  if (tileId < Tile.COMBASE) {
    return rzPop(tileId);
  }
  if (tileId < Tile.INDBASE) {
    return czPop(tileId) << 3;
  }
  if (tileId < Tile.PORTBASE) {
    return izPop(tileId) << 3;
  }
  return 0;
}

/**
 * Manhattan distance to the city center (clamped to 32).
 * Mirrors `GetDisCC` in `ref/micropolis/src/sim/s_scan.c`.
 */
export function getDisCC(state: SimState, x: number, y: number): number {
  const xdis = x > state.CCx2 ? x - state.CCx2 : state.CCx2 - x;
  const ydis = y > state.CCy2 ? y - state.CCy2 : state.CCy2 - y;
  const z = xdis + ydis;
  return z > 32 ? 32 : z;
}

/**
 * Compute commercial desirability by distance to the city center.
 * Mirrors `DistIntMarket` in `ref/micropolis/src/sim/s_scan.c`.
 */
export function distIntMarket(state: SimState, store: MapStore): void {
  for (let x = 0; x < SmX; x += 1) {
    const base = x * SmY;
    for (let y = 0; y < SmY; y += 1) {
      let z = getDisCC(state, x << 2, y << 2);
      z = z << 2;
      z = 64 - z;
      store.write('comRate', base + y, z);
    }
  }
}

/**
 * Populate PopDensity and ComRate, plus city center updates.
 * Mirrors `PopDenScan` in `ref/micropolis/src/sim/s_scan.c` (1:1 port).
 */
export function popDenScan(state: SimState, context: SimContext): void {
  const store = context.store;
  const map = store.getLayer('map') as Uint16Array;
  const tem = store.getLayer('tem') as Uint8Array;
  const tem2 = store.getLayer('tem2') as Uint8Array;
  clearTemArray(tem);

  let xTot = 0;
  let yTot = 0;
  let zTot = 0;

  for (let x = 0; x < WORLD_X; x += 1) {
    const base = x * WORLD_Y;
    for (let y = 0; y < WORLD_Y; y += 1) {
      const tile = map[base + y] ?? 0;
      if ((tile & ZONEBIT) === 0) {
        continue;
      }
      const tileId = tile & LOMASK;
      let z = getPDen(tileId, map, x, y) << 3;
      if (z > 254) {
        z = 254;
      }
      tem[halfIndex(x >> 1, y >> 1)] = z;
      xTot += x;
      yTot += y;
      zTot += 1;
    }
  }

  doSmooth(tem, tem2, state.DonDither);
  doSmooth2(tem, tem2, state.DonDither);
  doSmooth(tem, tem2, state.DonDither);

  for (let x = 0; x < HWLDX; x += 1) {
    const base = x * HWLDY;
    for (let y = 0; y < HWLDY; y += 1) {
      const index = base + y;
      const value = (tem2[index] ?? 0) << 1;
      store.write('popDensity', index, value);
    }
  }

  distIntMarket(state, store);

  if (zTot > 0) {
    state.CCx = Math.trunc(xTot / zTot);
    state.CCy = Math.trunc(yTot / zTot);
  } else {
    state.CCx = HWLDX;
    state.CCy = HWLDY;
  }
  state.CCx2 = state.CCx >> 1;
  state.CCy2 = state.CCy >> 1;
}
