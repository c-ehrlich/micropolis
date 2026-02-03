import { World } from '../core/constants.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';

const { HWLDX, HWLDY, SmX, SmY } = World;

const smIndex = (x: number, y: number): number => x * SmY + y;

/**
 * Police coverage smoothing pass.
 * Mirrors `SmoothPSMap` in `ref/micropolis/src/sim/s_scan.c` (1:1 port).
 */
export function smoothPSMap(policeMap: Int16Array, sTem: Int16Array): void {
  for (let x = 0; x < SmX; x += 1) {
    for (let y = 0; y < SmY; y += 1) {
      let edge = 0;
      if (x > 0) {
        edge += policeMap[smIndex(x - 1, y)] ?? 0;
      }
      if (x < SmX - 1) {
        edge += policeMap[smIndex(x + 1, y)] ?? 0;
      }
      if (y > 0) {
        edge += policeMap[smIndex(x, y - 1)] ?? 0;
      }
      if (y < SmY - 1) {
        edge += policeMap[smIndex(x, y + 1)] ?? 0;
      }
      edge = (edge >> 2) + (policeMap[smIndex(x, y)] ?? 0);
      sTem[smIndex(x, y)] = edge >> 1;
    }
  }

  for (let x = 0; x < SmX; x += 1) {
    for (let y = 0; y < SmY; y += 1) {
      policeMap[smIndex(x, y)] = sTem[smIndex(x, y)] ?? 0;
    }
  }
}

/**
 * Compute crime map, averages, and police coverage snapshot.
 * Mirrors `CrimeScan` in `ref/micropolis/src/sim/s_scan.c` (1:1 port; integer
 * division uses Math.floor on non-negative totals to match C truncation).
 */
export function crimeScan(state: SimState, context: SimContext): void {
  const store = context.store;
  const landValue = store.getLayer('landValueMem') as Uint8Array;
  const popDensity = store.getLayer('popDensity') as Uint8Array;
  const crimeMem = store.getLayer('crimeMem') as Uint8Array;
  const policeMap = store.getLayer('policeMap') as Int16Array;
  const policeMapEffect = store.getLayer('policeMapEffect') as Int16Array;
  const sTem = store.getLayer('sTem') as Int16Array;

  smoothPSMap(policeMap, sTem);
  smoothPSMap(policeMap, sTem);
  smoothPSMap(policeMap, sTem);

  let totz = 0;
  let numz = 0;
  let cmax = 0;

  for (let x = 0; x < HWLDX; x += 1) {
    const baseIndex = x * HWLDY;
    const policeBase = (x >> 2) * SmY;
    for (let y = 0; y < HWLDY; y += 1) {
      const index = baseIndex + y;
      const land = landValue[index] ?? 0;
      if (land !== 0) {
        numz += 1;
        let z = 128 - land;
        z += popDensity[index] ?? 0;
        if (z > 300) {
          z = 300;
        }
        z -= policeMap[policeBase + (y >> 2)] ?? 0;
        if (z > 250) {
          z = 250;
        }
        if (z < 0) {
          z = 0;
        }

        if (crimeMem[index] !== z) {
          store.write('crimeMem', index, z);
        }

        totz += z;
        if (z > cmax || (z === cmax && (context.rng.next16() & 3) === 0)) {
          cmax = z;
          state.CrimeMaxX = x << 1;
          state.CrimeMaxY = y << 1;
        }
      } else if (crimeMem[index] !== 0) {
        store.write('crimeMem', index, 0);
      }
    }
  }

  state.CrimeAverage = numz > 0 ? Math.floor(totz / numz) : 0;

  for (let x = 0; x < SmX; x += 1) {
    for (let y = 0; y < SmY; y += 1) {
      const index = smIndex(x, y);
      const value = policeMap[index] ?? 0;
      if (policeMapEffect[index] !== value) {
        store.write('policeMapEffect', index, value);
      }
    }
  }
}
