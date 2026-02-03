import { PowerMap, Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import type { MapStore } from '../core/map-store.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';

const { POWERMAPROW, PWRMAPSIZE, PWRSTKSIZE } = PowerMap;
const { WORLD_X, WORLD_Y } = World;
const { LOMASK } = TileMask;
const { PWRBIT } = TileFlag;

export function setZPowerAt(
  store: MapStore,
  power: Uint16Array,
  x: number,
  y: number,
  index: number,
  tile: number,
): boolean {
  const tileId = tile & LOMASK;
  const isPlant = tileId === Tile.NUCLEAR || tileId === Tile.POWERPLANT;
  const powerWord = (x >> 4) + y * POWERMAPROW;
  const layer = powerWord < PWRMAPSIZE ? (power[powerWord] ?? 0) : 0;
  const powered = isPlant || (powerWord < PWRMAPSIZE && (layer & (1 << (x & 15))) !== 0);

  const nextTile = powered ? tile | PWRBIT : tile & ~PWRBIT;
  if (nextTile !== tile) {
    store.write('map', index, nextTile);
  }
  return powered;
}

export function pushPowerStack(state: SimState, x: number, y: number): void {
  if (state.PowerStackNum < PWRSTKSIZE - 2) {
    state.PowerStackNum += 1;
    state.PowerStackX[state.PowerStackNum] = x;
    state.PowerStackY[state.PowerStackNum] = y;
  }
}

export function pullPowerStack(state: SimState): { x: number; y: number } | null {
  if (state.PowerStackNum > 0) {
    const x = state.PowerStackX[state.PowerStackNum] ?? 0;
    const y = state.PowerStackY[state.PowerStackNum] ?? 0;
    state.PowerStackNum -= 1;
    return { x, y };
  }
  return null;
}

interface MoveResult {
  x: number;
  y: number;
  moved: boolean;
}

function moveMapSim(dir: number, x: number, y: number): MoveResult {
  switch (dir) {
    case 0:
      if (y > 0) {
        return { x, y: y - 1, moved: true };
      }
      return { x, y: 0, moved: false };
    case 1:
      if (x < WORLD_X - 1) {
        return { x: x + 1, y, moved: true };
      }
      return { x: WORLD_X - 1, y, moved: false };
    case 2:
      if (y < WORLD_Y - 1) {
        return { x, y: y + 1, moved: true };
      }
      return { x, y: WORLD_Y - 1, moved: false };
    case 3:
      if (x > 0) {
        return { x: x - 1, y, moved: true };
      }
      return { x: 0, y, moved: false };
    case 4:
      return { x, y, moved: true };
    default:
      return { x, y, moved: false };
  }
}

function setPowerBit(power: Uint16Array, x: number, y: number): void {
  const powerWord = (x >> 4) + y * POWERMAPROW;
  if (powerWord >= PWRMAPSIZE) {
    return;
  }
  power[powerWord] |= 1 << (x & 15);
}

function testForCond(
  map: Uint16Array,
  power: Uint16Array,
  x: number,
  y: number,
  dir: number,
  lastTileId: number,
): boolean {
  const moved = moveMapSim(dir, x, y);
  if (!moved.moved) {
    return false;
  }

  const nx = moved.x;
  const ny = moved.y;
  const tile = map[nx * WORLD_Y + ny] ?? 0;
  if ((tile & TileFlag.CONDBIT) === 0) {
    return false;
  }
  if (lastTileId === Tile.NUCLEAR || lastTileId === Tile.POWERPLANT) {
    return false;
  }

  const powerWord = (nx >> 4) + ny * POWERMAPROW;
  if (powerWord >= PWRMAPSIZE) {
    return true;
  }
  const layer = power[powerWord] ?? 0;
  return (layer & (1 << (nx & 15))) === 0;
}

export interface PowerScanOptions {
  lastTileId?: number;
}

export function doPowerScan(
  state: SimState,
  context: SimContext,
  options: PowerScanOptions = {},
): void {
  const map = context.store.getLayer('map') as Uint16Array;
  const power = context.store.getLayer('power') as Uint16Array;
  power.fill(0);

  const maxPower = state.CoalPop * 700 + state.NuclearPop * 2000;
  let numPower = 0;
  const lastTileId = options.lastTileId ?? state.CChr9;

  while (state.PowerStackNum > 0) {
    const start = pullPowerStack(state);
    if (!start) {
      break;
    }
    let x = start.x;
    let y = start.y;
    let aDir = 4;
    let conNum = 0;

    do {
      numPower += 1;
      if (numPower > maxPower) {
        context.hooks.sendMes(40);
        return;
      }

      const moved = moveMapSim(aDir, x, y);
      x = moved.x;
      y = moved.y;
      setPowerBit(power, x, y);

      conNum = 0;
      let dir = 0;
      while (dir < 4 && conNum < 2) {
        if (testForCond(map, power, x, y, dir, lastTileId)) {
          conNum += 1;
          aDir = dir;
        }
        dir += 1;
      }
      if (conNum > 1) {
        pushPowerStack(state, x, y);
      }
    } while (conNum > 0);
  }
}
