import { World } from '../core/constants.ts';
import { markFireAnalysisMapFlags } from '../core/map-invalidation.ts';
import type { MapStore } from '../core/map-store.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';

const { SmX, SmY } = World;

const indexFor = (x: number, y: number): number => x * SmY + y;

export function smoothFSMap(store: MapStore, fireStMap: Int16Array, sTem: Int16Array): void {
  for (let x = 0; x < SmX; x += 1) {
    const baseIndex = x * SmY;
    for (let y = 0; y < SmY; y += 1) {
      let edge = 0;
      if (x) {
        edge += fireStMap[indexFor(x - 1, y)] ?? 0;
      }
      if (x < SmX - 1) {
        edge += fireStMap[indexFor(x + 1, y)] ?? 0;
      }
      if (y) {
        edge += fireStMap[baseIndex + y - 1] ?? 0;
      }
      if (y < SmY - 1) {
        edge += fireStMap[baseIndex + y + 1] ?? 0;
      }
      edge = (edge >> 2) + (fireStMap[baseIndex + y] ?? 0);
      const value = edge >> 1;
      store.write('sTem', baseIndex + y, value);
    }
  }

  for (let x = 0; x < SmX; x += 1) {
    const baseIndex = x * SmY;
    for (let y = 0; y < SmY; y += 1) {
      const value = sTem[baseIndex + y] ?? 0;
      store.write('fireStMap', baseIndex + y, value);
    }
  }
}

export function fireAnalysis(state: SimState, context: SimContext): void {
  const store = context.store;
  const fireStMap = store.getLayer('fireStMap') as Int16Array;
  const sTem = store.getLayer('sTem') as Int16Array;

  smoothFSMap(store, fireStMap, sTem);
  smoothFSMap(store, fireStMap, sTem);
  smoothFSMap(store, fireStMap, sTem);

  for (let x = 0; x < SmX; x += 1) {
    const baseIndex = x * SmY;
    for (let y = 0; y < SmY; y += 1) {
      const value = fireStMap[baseIndex + y] ?? 0;
      store.write('fireRate', baseIndex + y, value);
    }
  }

  markFireAnalysisMapFlags(state);
}
