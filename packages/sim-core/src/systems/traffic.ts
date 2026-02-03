import { Tile, TileMask, World } from '../core/constants.ts';
import type { MicropolisRng } from '../core/rng.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';

const { WORLD_X, WORLD_Y, HWLDY } = World;
const { LOMASK } = TileMask;
const { ROADBASE, POWERBASE, LASTRAIL, RAILHPOWERV, COMBASE, LHTHR, NUCLEAR, PORT } = Tile;

const MAXDIS = 30;
const COP_SPRITE = 2;

const PERIM_X = [-1, 0, 1, 2, 2, 2, 1, 0, -1, -2, -2, -2] as const;
const PERIM_Y = [-2, -2, -2, -1, 0, 1, 2, 2, 2, 1, 0, -1] as const;

const TARGET_LOW = [COMBASE, LHTHR, LHTHR] as const;
const TARGET_HIGH = [NUCLEAR, PORT, COMBASE] as const;

export type TrafficSource = 0 | 1 | 2;
export type TrafficResult = -1 | 0 | 1;

export interface TrafficCursor {
  x: number;
  y: number;
  source: TrafficSource;
  lastDir: number;
  posStackN: number;
  posStackX: number[];
  posStackY: number[];
}

interface CopSprite {
  control: number;
  dest_x: number;
  dest_y: number;
}

const isCopSprite = (sprite: unknown): sprite is CopSprite => {
  if (!sprite || typeof sprite !== 'object') {
    return false;
  }
  const candidate = sprite as Partial<CopSprite>;
  return (
    typeof candidate.control === 'number' &&
    typeof candidate.dest_x === 'number' &&
    typeof candidate.dest_y === 'number'
  );
};

const inBounds = (x: number, y: number): boolean => x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y;

const mapIndex = (x: number, y: number): number => x * WORLD_Y + y;
const trfIndex = (x: number, y: number): number => (x >> 1) * HWLDY + (y >> 1);

export const createTrafficCursor = (
  x: number,
  y: number,
  source: TrafficSource,
): TrafficCursor => ({
  x,
  y,
  source,
  lastDir: 5,
  posStackN: 0,
  posStackX: new Array<number>(MAXDIS + 1).fill(0),
  posStackY: new Array<number>(MAXDIS + 1).fill(0),
});

/**
 * Road eligibility check for the full traffic simulation.
 * Mirrors `RoadTest` in `ref/micropolis/src/sim/s_traf.c`.
 */
export const roadTest = (tile: number): boolean => {
  const id = tile & LOMASK;
  if (id < ROADBASE) {
    return false;
  }
  if (id > LASTRAIL) {
    return false;
  }
  if (id >= POWERBASE && id < RAILHPOWERV) {
    return false;
  }
  return true;
};

export const findPRoad = (map: Uint16Array, cursor: TrafficCursor): boolean => {
  const baseX = cursor.x;
  const baseY = cursor.y;
  for (let i = 0; i < 12; i += 1) {
    const dx = PERIM_X[i] ?? 0;
    const dy = PERIM_Y[i] ?? 0;
    const tx = baseX + dx;
    const ty = baseY + dy;
    if (!inBounds(tx, ty)) {
      continue;
    }
    if (roadTest(map[mapIndex(tx, ty)] ?? 0)) {
      cursor.x = tx;
      cursor.y = ty;
      return true;
    }
  }
  return false;
};

const moveMap = (cursor: TrafficCursor, dir: number): boolean => {
  switch (dir) {
    case 0:
      if (cursor.y > 0) {
        cursor.y -= 1;
        return true;
      }
      if (cursor.y < 0) {
        cursor.y = 0;
      }
      return false;
    case 1:
      if (cursor.x < WORLD_X - 1) {
        cursor.x += 1;
        return true;
      }
      if (cursor.x > WORLD_X - 1) {
        cursor.x = WORLD_X - 1;
      }
      return false;
    case 2:
      if (cursor.y < WORLD_Y - 1) {
        cursor.y += 1;
        return true;
      }
      if (cursor.y > WORLD_Y - 1) {
        cursor.y = WORLD_Y - 1;
      }
      return false;
    case 3:
      if (cursor.x > 0) {
        cursor.x -= 1;
        return true;
      }
      if (cursor.x < 0) {
        cursor.x = 0;
      }
      return false;
    case 4:
      return true;
    default:
      return false;
  }
};

const getFromMap = (map: Uint16Array, cursor: TrafficCursor, dir: number): number => {
  switch (dir) {
    case 0:
      if (cursor.y > 0) {
        return map[mapIndex(cursor.x, cursor.y - 1)] ?? 0;
      }
      return 0;
    case 1:
      if (cursor.x < WORLD_X - 1) {
        return map[mapIndex(cursor.x + 1, cursor.y)] ?? 0;
      }
      return 0;
    case 2:
      if (cursor.y < WORLD_Y - 1) {
        return map[mapIndex(cursor.x, cursor.y + 1)] ?? 0;
      }
      return 0;
    case 3:
      if (cursor.x > 0) {
        return map[mapIndex(cursor.x - 1, cursor.y)] ?? 0;
      }
      return 0;
    default:
      return 0;
  }
};

const pushPos = (cursor: TrafficCursor): void => {
  cursor.posStackN += 1;
  cursor.posStackX[cursor.posStackN] = cursor.x;
  cursor.posStackY[cursor.posStackN] = cursor.y;
};

const pullPos = (cursor: TrafficCursor): void => {
  cursor.x = cursor.posStackX[cursor.posStackN] ?? cursor.x;
  cursor.y = cursor.posStackY[cursor.posStackN] ?? cursor.y;
  cursor.posStackN -= 1;
};

export const tryGo = (
  map: Uint16Array,
  rng: MicropolisRng,
  cursor: TrafficCursor,
  step: number,
): boolean => {
  const rdir = rng.next16() & 3;
  for (let i = rdir; i < rdir + 4; i += 1) {
    const dir = i & 3;
    if (dir === cursor.lastDir) {
      continue;
    }
    if (roadTest(getFromMap(map, cursor, dir))) {
      moveMap(cursor, dir);
      cursor.lastDir = (dir + 2) & 3;
      if (step & 1) {
        pushPos(cursor);
      }
      return true;
    }
  }
  return false;
};

export const driveDone = (map: Uint16Array, cursor: TrafficCursor): boolean => {
  const low = TARGET_LOW[cursor.source];
  const high = TARGET_HIGH[cursor.source];

  if (cursor.y > 0) {
    const tile = map[mapIndex(cursor.x, cursor.y - 1)] ?? 0;
    const id = tile & LOMASK;
    if (id >= low && id <= high) {
      return true;
    }
  }
  if (cursor.x < WORLD_X - 1) {
    const tile = map[mapIndex(cursor.x + 1, cursor.y)] ?? 0;
    const id = tile & LOMASK;
    if (id >= low && id <= high) {
      return true;
    }
  }
  if (cursor.y < WORLD_Y - 1) {
    const tile = map[mapIndex(cursor.x, cursor.y + 1)] ?? 0;
    const id = tile & LOMASK;
    if (id >= low && id <= high) {
      return true;
    }
  }
  if (cursor.x > 0) {
    const tile = map[mapIndex(cursor.x - 1, cursor.y)] ?? 0;
    const id = tile & LOMASK;
    if (id >= low && id <= high) {
      return true;
    }
  }
  return false;
};

export const tryDrive = (map: Uint16Array, rng: MicropolisRng, cursor: TrafficCursor): boolean => {
  cursor.lastDir = 5;
  for (let z = 0; z < MAXDIS; z += 1) {
    if (tryGo(map, rng, cursor, z)) {
      if (driveDone(map, cursor)) {
        return true;
      }
    } else {
      if (cursor.posStackN) {
        cursor.posStackN -= 1;
        z += 3;
      } else {
        return false;
      }
    }
  }
  return false;
};

export const setTrafMem = (
  state: SimState,
  context: SimContext,
  map: Uint16Array,
  trfDensity: Uint8Array,
  cursor: TrafficCursor,
): void => {
  while (cursor.posStackN > 0) {
    pullPos(cursor);
    if (!inBounds(cursor.x, cursor.y)) {
      continue;
    }
    const tile = map[mapIndex(cursor.x, cursor.y)] ?? 0;
    const id = tile & LOMASK;
    if (id >= ROADBASE && id < POWERBASE) {
      const index = trfIndex(cursor.x, cursor.y);
      let z = (trfDensity[index] ?? 0) + 50;
      if (z > 240 && context.rng.rand(5) === 0) {
        z = 240;
        state.TrafMaxX = cursor.x << 4;
        state.TrafMaxY = cursor.y << 4;
        const sprite = context.hooks.getSprite(COP_SPRITE);
        if (isCopSprite(sprite) && sprite.control === -1) {
          sprite.dest_x = state.TrafMaxX;
          sprite.dest_y = state.TrafMaxY;
        }
      }
      const wrapped = z & 0xff;
      context.store.write('trfDensity', index, wrapped);
    }
  }
};

/**
 * Full traffic generation: finds a perimeter road, attempts a drive, and updates traffic density.
 * Port of `MakeTraf` in `ref/micropolis/src/sim/s_traf.c`.
 */
export const makeTraf = (
  state: SimState,
  context: SimContext,
  startX: number,
  startY: number,
  source: TrafficSource,
): TrafficResult => {
  const map = context.store.getLayer('map') as Uint16Array;
  const trfDensity = context.store.getLayer('trfDensity') as Uint8Array;
  const cursor = createTrafficCursor(startX, startY, source);
  if (!findPRoad(map, cursor)) {
    return -1;
  }
  if (tryDrive(map, context.rng, cursor)) {
    setTrafMem(state, context, map, trfDensity, cursor);
    return 1;
  }
  return 0;
};

export const decTrafficMem = (_state: SimState, context: SimContext): void => {
  const trfDensity = context.store.getLayer('trfDensity') as Uint8Array;
  const length = trfDensity.length;
  for (let i = 0; i < length; i += 1) {
    const z = trfDensity[i] ?? 0;
    if (z === 0) {
      continue;
    }
    let next = z;
    if (z > 24) {
      next = z > 200 ? z - 34 : z - 24;
    } else {
      next = 0;
    }
    if (next !== z) {
      context.store.write('trfDensity', i, next);
    }
  }
};
