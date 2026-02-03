import { Tile, TileMask, World } from '../core/constants.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import { doSmooth, doSmooth2, getDisCC } from './pop-density.ts';

const { WORLD_Y, HWLDX, HWLDY, QWX, QWY } = World;
const { LOMASK } = TileMask;
const {
  FIREBASE,
  HTRFBASE,
  LASTIND,
  LASTPOWERPLANT,
  LTRFBASE,
  PORTBASE,
  POWERBASE,
  RADTILE,
  ROADBASE,
  RUBBLE,
} = Tile;

const mapIndex = (x: number, y: number): number => x * WORLD_Y + y;
const halfIndex = (x: number, y: number): number => x * HWLDY + y;
const quarterIndex = (x: number, y: number): number => x * QWY + y;

const toByte = (value: number): number => value & 0xff;

export function getPValue(loc: number): number {
  if (loc < POWERBASE) {
    if (loc >= HTRFBASE) {
      return 75;
    }
    if (loc >= LTRFBASE) {
      return 50;
    }
    if (loc < ROADBASE) {
      if (loc > FIREBASE) {
        return 90;
      }
      if (loc >= RADTILE) {
        return 255;
      }
    }
    return 0;
  }
  if (loc <= LASTIND) {
    return 0;
  }
  if (loc < PORTBASE) {
    return 50;
  }
  if (loc <= LASTPOWERPLANT) {
    return 100;
  }
  return 0;
}

export function smoothTerrain(state: SimState, terrainMem: Uint8Array, qtem: Uint8Array): void {
  if ((state.DonDither & 1) !== 0) {
    let y = 0;
    let z = 0;
    let dir = 1;

    for (let x = 0; x < QWX; x += 1) {
      for (; y !== QWY && y !== -1; y += dir) {
        const xl = x === 0 ? x : x - 1;
        const xr = x === QWX - 1 ? x : x + 1;
        const yu = y === 0 ? 0 : y - 1;
        const yd = y === QWY - 1 ? y : y + 1;
        const idx = quarterIndex(x, y);

        z +=
          (qtem[quarterIndex(xl, y)] ?? 0) +
          (qtem[quarterIndex(xr, y)] ?? 0) +
          (qtem[quarterIndex(x, yu)] ?? 0) +
          (qtem[quarterIndex(x, yd)] ?? 0) +
          ((qtem[idx] ?? 0) << 2);

        terrainMem[idx] = toByte(z >>> 3);
        z &= 7;
      }
      dir = -dir;
      y += dir;
    }
    return;
  }

  for (let x = 0; x < QWX; x += 1) {
    for (let y = 0; y < QWY; y += 1) {
      let z = 0;
      if (x > 0) {
        z += qtem[quarterIndex(x - 1, y)] ?? 0;
      }
      if (x < QWX - 1) {
        z += qtem[quarterIndex(x + 1, y)] ?? 0;
      }
      if (y > 0) {
        z += qtem[quarterIndex(x, y - 1)] ?? 0;
      }
      if (y < QWY - 1) {
        z += qtem[quarterIndex(x, y + 1)] ?? 0;
      }
      const value = toByte((z >> 2) + (qtem[quarterIndex(x, y)] ?? 0));
      terrainMem[quarterIndex(x, y)] = value >> 1;
    }
  }
}

export function ptlScan(state: SimState, context: SimContext): void {
  const map = context.store.getLayer('map') as Uint16Array;
  const tem = context.store.getLayer('tem') as Uint8Array;
  const tem2 = context.store.getLayer('tem2') as Uint8Array;
  const qtem = context.store.getLayer('qtem') as Uint8Array;
  const landValueMem = context.store.getLayer('landValueMem') as Uint8Array;
  const pollutionMem = context.store.getLayer('pollutionMem') as Uint8Array;
  const terrainMem = context.store.getLayer('terrainMem') as Uint8Array;
  const crimeMem = context.store.getLayer('crimeMem') as Uint8Array;

  qtem.fill(0);

  let lvTot = 0;
  let lvNum = 0;

  for (let x = 0; x < HWLDX; x += 1) {
    for (let y = 0; y < HWLDY; y += 1) {
      let plevel = 0;
      let lvFlag = 0;
      const zx = x << 1;
      const zy = y << 1;
      const qIdx = quarterIndex(x >> 1, y >> 1);

      for (let mx = zx; mx <= zx + 1; mx += 1) {
        for (let my = zy; my <= zy + 1; my += 1) {
          const loc = (map[mapIndex(mx, my)] ?? 0) & LOMASK;
          if (!loc) {
            continue;
          }
          if (loc < RUBBLE) {
            qtem[qIdx] = (qtem[qIdx] ?? 0) + 15;
            continue;
          }
          plevel += getPValue(loc);
          if (loc >= ROADBASE) {
            lvFlag += 1;
          }
        }
      }

      if (plevel > 255) {
        plevel = 255;
      }
      tem[halfIndex(x, y)] = plevel;

      if (lvFlag) {
        let dis = 34 - getDisCC(state, x, y);
        dis <<= 2;
        dis += terrainMem[qIdx] ?? 0;
        dis -= pollutionMem[halfIndex(x, y)] ?? 0;
        if ((crimeMem[halfIndex(x, y)] ?? 0) > 190) {
          dis -= 20;
        }
        if (dis > 250) {
          dis = 250;
        }
        if (dis < 1) {
          dis = 1;
        }
        landValueMem[halfIndex(x, y)] = dis;
        lvTot += dis;
        lvNum += 1;
      } else {
        landValueMem[halfIndex(x, y)] = 0;
      }
    }
  }

  state.LVAverage = lvNum ? Math.floor(lvTot / lvNum) : 0;

  doSmooth(tem, tem2, state.DonDither);
  doSmooth2(tem, tem2, state.DonDither);

  let pmax = 0;
  let pnum = 0;
  let ptot = 0;

  for (let x = 0; x < HWLDX; x += 1) {
    for (let y = 0; y < HWLDY; y += 1) {
      const idx = halfIndex(x, y);
      const z = tem[idx] ?? 0;
      pollutionMem[idx] = z;
      if (z) {
        pnum += 1;
        ptot += z;
        if (z > pmax || (z === pmax && (context.rng.next16() & 3) === 0)) {
          pmax = z;
          state.PolMaxX = x << 1;
          state.PolMaxY = y << 1;
        }
      }
    }
  }

  state.PolluteAverage = pnum ? Math.floor(ptot / pnum) : 0;

  smoothTerrain(state, terrainMem, qtem);
}
