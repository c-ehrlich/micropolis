import { assertDefined } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import type { MapScanContext } from './map-scan.ts';
import { createZoneSystem, doMeltdown } from './zones.ts';

const { WORLD_X, WORLD_Y, SmX, SmY } = World;
const { LOMASK } = TileMask;
const { ANIMBIT, BULLBIT, BURNBIT, ZONEBIT } = TileFlag;
const {
  AIRPORT,
  CHANNEL,
  FIRE,
  FLOOD,
  IZB,
  LHTHR,
  LASTZONE,
  NUCLEAR,
  PORTBASE,
  RESBASE,
  ROADBASE,
  RUBBLE,
  TREEBASE,
  WOODS5,
} = Tile;

const FIRE_DX = [-1, 0, 1, 0] as const;
const FIRE_DY = [0, -1, 0, 1] as const;
const FLOOD_DX = [0, 1, 0, -1] as const;
const FLOOD_DY = [-1, 0, 1, 0] as const;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;
const rateIndex = (x: number, y: number) => x * SmY + y;
const inBounds = (x: number, y: number) => x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y;

const DISASTER_CHANCE = [10 * 48, 5 * 48, 60] as const;

export function createFireHandler(context: SimContext): (scan: MapScanContext) => void {
  const fireRate = context.store.getLayer('fireRate') as Int16Array;
  const rateOGMem = context.store.getLayer('rateOGMem') as Int16Array;
  return (scan) => doFire(scan, context, fireRate, rateOGMem);
}

export function createFloodHandler(
  state: SimState,
  context: SimContext,
): (scan: MapScanContext) => void {
  const rateOGMem = context.store.getLayer('rateOGMem') as Int16Array;
  return (scan) => doFlood(scan, state, context, rateOGMem);
}

export function createRadHandler(): (scan: MapScanContext) => void {
  return (scan) => doRadTile(scan);
}

export function fireZone(
  context: SimContext,
  map: Uint16Array,
  rateOGMem: Int16Array,
  xloc: number,
  yloc: number,
  tile: number,
): void {
  const rx = xloc >> 3;
  const ry = yloc >> 3;
  if (rx >= 0 && rx < SmX && ry >= 0 && ry < SmY) {
    const idx = rateIndex(rx, ry);
    const next = (rateOGMem[idx] ?? 0) - 20;
    rateOGMem[idx] = next;
    context.store.write('rateOGMem', idx, next);
  }

  let xymax = 4;
  const zoneId = tile & LOMASK;
  if (zoneId < PORTBASE) {
    xymax = 2;
  } else if (zoneId === AIRPORT) {
    xymax = 5;
  }

  for (let x = -1; x < xymax; x += 1) {
    for (let y = -1; y < xymax; y += 1) {
      const xt = xloc + x;
      const yt = yloc + y;
      if (!inBounds(xt, yt)) {
        continue;
      }
      const index = indexFor(xt, yt);
      const value = map[index] ?? 0;
      if ((value & LOMASK) >= ROADBASE) {
        context.store.write('map', index, value | BULLBIT);
      }
    }
  }
}

export function doFire(
  scan: MapScanContext,
  context: SimContext,
  fireRate: Int16Array,
  rateOGMem: Int16Array,
): void {
  const map = scan.map;
  const rng = scan.rng;

  for (let z = 0; z < 4; z += 1) {
    if ((rng.next16() & 7) !== 0) {
      continue;
    }
    const dx = FIRE_DX[z];
    const dy = FIRE_DY[z];
    assertDefined(dx);
    assertDefined(dy);
    const xt = scan.x + dx;
    const yt = scan.y + dy;
    if (!inBounds(xt, yt)) {
      continue;
    }
    const index = indexFor(xt, yt);
    const tile = map[index] ?? 0;
    if ((tile & BURNBIT) === 0) {
      continue;
    }
    if ((tile & ZONEBIT) !== 0) {
      fireZone(context, map, rateOGMem, xt, yt, tile);
      if ((tile & LOMASK) > IZB) {
        context.hooks.makeExplosionAt((xt << 4) + 8, (yt << 4) + 8);
      }
    }
    const fireTile = FIRE + (rng.next16() & 3) + ANIMBIT;
    context.store.write('map', index, fireTile);
  }

  const rx = scan.x >> 3;
  const ry = scan.y >> 3;
  let rate = 10;
  if (rx >= 0 && rx < SmX && ry >= 0 && ry < SmY) {
    const z = fireRate[rateIndex(rx, ry)] ?? 0;
    if (z !== 0) {
      rate = 3;
      if (z > 20) {
        rate = 2;
      }
      if (z > 100) {
        rate = 1;
      }
    }
  }

  if (rng.rand(rate) === 0) {
    const rubble = RUBBLE + (rng.next16() & 3) + BULLBIT;
    scan.writeTile(rubble);
  }
}

export function doRadTile(scan: MapScanContext): void {
  if ((scan.rng.next16() & 4095) === 0) {
    scan.writeTile(Tile.DIRT);
  }
}

export function doFlood(
  scan: MapScanContext,
  state: SimState,
  context: SimContext,
  rateOGMem: Int16Array,
): void {
  const map = scan.map;
  const rng = scan.rng;

  if (state.FloodCnt > 0) {
    for (let z = 0; z < 4; z += 1) {
      if ((rng.next16() & 7) !== 0) {
        continue;
      }
      const dx = FLOOD_DX[z];
      const dy = FLOOD_DY[z];
      assertDefined(dx);
      assertDefined(dy);
      const xt = scan.x + dx;
      const yt = scan.y + dy;
      if (!inBounds(xt, yt)) {
        continue;
      }
      const index = indexFor(xt, yt);
      const tile = map[index] ?? 0;
      const tileId = tile & LOMASK;
      if ((tile & BURNBIT) !== 0 || tile === 0 || (tileId >= WOODS5 && tileId < FLOOD)) {
        if ((tile & ZONEBIT) !== 0) {
          fireZone(context, map, rateOGMem, xt, yt, tile);
        }
        const floodTile = FLOOD + rng.rand(2);
        context.store.write('map', index, floodTile);
      }
    }
  } else if ((rng.next16() & 15) === 0) {
    scan.writeTile(Tile.DIRT);
  }
}

/**
 * Disaster dispatcher for random and scenario-based events.
 * Mirrors `DoDisasters` in `ref/micropolis/src/sim/s_disast.c` (1:1 port).
 */
export function doDisasters(state: SimState, context: SimContext): void {
  if (state.FloodCnt > 0) {
    state.FloodCnt -= 1;
  }

  if (state.DisasterEvent !== 0) {
    scenarioDisaster(state, context);
  }

  let level = state.GameLevel;
  if (level > 2) {
    level = 0;
  }
  const chance = DISASTER_CHANCE[level] ?? DISASTER_CHANCE[0];

  if (state.NoDisasters) {
    return;
  }

  if (context.rng.rand(chance) !== 0) {
    return;
  }

  const pick = context.rng.rand(8);
  switch (pick) {
    case 0:
    case 1:
      setFire(state, context);
      return;
    case 2:
    case 3:
      makeFlood(state, context);
      return;
    case 4:
      return;
    case 5:
      makeTornado(context);
      return;
    case 6:
      makeEarthquake(state, context);
      return;
    case 7:
    case 8:
      if (state.PolluteAverage > 60) {
        makeMonster(context);
      }
  }
}

/**
 * Scenario-specific disaster scripting dispatcher.
 * Mirrors `ScenarioDisaster` in `ref/micropolis/src/sim/s_disast.c` (1:1 port).
 */
export function scenarioDisaster(state: SimState, context: SimContext): void {
  switch (state.DisasterEvent) {
    case 1:
      break;
    case 2:
      if (state.DisasterWait === 1) {
        makeEarthquake(state, context);
      }
      break;
    case 3:
      dropFireBombs(context);
      break;
    case 4:
      break;
    case 5:
      if (state.DisasterWait === 1) {
        makeMonster(context);
      }
      break;
    case 6:
      break;
    case 7:
      if (state.DisasterWait === 1) {
        makeMeltdown(state, context);
      }
      break;
    case 8:
      if (state.DisasterWait % 24 === 0) {
        makeFlood(state, context);
      }
      break;
    default:
      break;
  }

  if (state.DisasterWait) {
    state.DisasterWait -= 1;
  } else {
    state.DisasterEvent = 0;
  }
}

/**
 * Finds the first nuclear plant tile and triggers a meltdown.
 * Mirrors `MakeMeltdown` in `ref/micropolis/src/sim/s_disast.c` (1:1 port).
 */
export function makeMeltdown(state: SimState, context: SimContext): void {
  const map = context.store.getLayer('map') as Uint16Array;
  const system = createZoneSystem(state, context);

  for (let x = 0; x < WORLD_X - 1; x += 1) {
    for (let y = 0; y < WORLD_Y - 1; y += 1) {
      const tile = map[indexFor(x, y)] ?? 0;
      if ((tile & LOMASK) === NUCLEAR) {
        doMeltdown(system, x, y);
        return;
      }
    }
  }
}

/**
 * Earthquake event handler: shakes the city and damages vulnerable tiles.
 * Mirrors `MakeEarthquake` in `ref/micropolis/src/sim/s_disast.c` (1:1 port).
 */
export function makeEarthquake(state: SimState, context: SimContext): void {
  const rng = context.rng;
  const store = context.store;
  const map = store.getLayer('map') as Uint16Array;

  context.hooks.doEarthQuake();
  context.hooks.sendMesAt(-23, state.CCx, state.CCy);

  const time = rng.rand(700) + 300;
  for (let z = 0; z < time; z += 1) {
    const x = rng.rand(WORLD_X - 1);
    const y = rng.rand(WORLD_Y - 1);
    if (!inBounds(x, y)) {
      continue;
    }
    const index = indexFor(x, y);
    const tile = map[index] ?? 0;
    if (!isVulnerable(tile)) {
      continue;
    }
    if ((z & 0x3) !== 0) {
      store.write('map', index, RUBBLE + (rng.next16() & 3) + BULLBIT);
    } else {
      store.write('map', index, FIRE + (rng.next16() & 7) + ANIMBIT);
    }
  }
}

/**
 * Random arson event that ignites a single zone tile.
 * Mirrors `SetFire` in `ref/micropolis/src/sim/s_disast.c` (1:1 port).
 */
export function setFire(state: SimState, context: SimContext): void {
  const rng = context.rng;
  const store = context.store;
  const map = store.getLayer('map') as Uint16Array;
  const x = rng.rand(WORLD_X - 1);
  const y = rng.rand(WORLD_Y - 1);
  const index = indexFor(x, y);
  const tile = map[index] ?? 0;

  if ((tile & ZONEBIT) !== 0) {
    return;
  }
  const tileId = tile & LOMASK;
  if (tileId <= LHTHR || tileId >= LASTZONE) {
    return;
  }

  store.write('map', index, FIRE + ANIMBIT + (rng.next16() & 7));
  state.CrashX = x;
  state.CrashY = y;
  context.hooks.sendMesAt(-20, x, y);
}

/**
 * Attempts to ignite a burnable, non-zone tile up to 40 times.
 * Mirrors `MakeFire` in `ref/micropolis/src/sim/s_disast.c` (1:1 port).
 */
export function makeFire(context: SimContext): void {
  const rng = context.rng;
  const store = context.store;
  const map = store.getLayer('map') as Uint16Array;

  for (let t = 0; t < 40; t += 1) {
    const x = rng.rand(WORLD_X - 1);
    const y = rng.rand(WORLD_Y - 1);
    const index = indexFor(x, y);
    const tile = map[index] ?? 0;
    if ((tile & ZONEBIT) !== 0 || (tile & BURNBIT) === 0) {
      continue;
    }
    const tileId = tile & LOMASK;
    if (tileId <= TREEBASE || tileId >= LASTZONE) {
      continue;
    }

    store.write('map', index, FIRE + ANIMBIT + (rng.next16() & 7));
    context.hooks.sendMesAt(20, x, y);
    return;
  }
}

/**
 * Attempts to create a flood from a river edge tile.
 * Mirrors `MakeFlood` in `ref/micropolis/src/sim/s_disast.c` (1:1 port).
 */
export function makeFlood(state: SimState, context: SimContext): void {
  const rng = context.rng;
  const store = context.store;
  const map = store.getLayer('map') as Uint16Array;

  for (let z = 0; z < 300; z += 1) {
    const x = rng.rand(WORLD_X - 1);
    const y = rng.rand(WORLD_Y - 1);
    const index = indexFor(x, y);
    const tileId = (map[index] ?? 0) & LOMASK;
    if (tileId <= CHANNEL || tileId >= TREEBASE) {
      continue;
    }
    for (let t = 0; t < 4; t += 1) {
      const dx = FLOOD_DX[t];
      const dy = FLOOD_DY[t];
      assertDefined(dx);
      assertDefined(dy);
      const xx = x + dx;
      const yy = y + dy;
      if (!inBounds(xx, yy)) {
        continue;
      }
      const neighborIndex = indexFor(xx, yy);
      const neighbor = map[neighborIndex] ?? 0;
      if (neighbor !== 0 && ((neighbor & BULLBIT) === 0 || (neighbor & BURNBIT) === 0)) {
        continue;
      }
      store.write('map', neighborIndex, FLOOD);
      state.FloodCnt = 30;
      state.FloodX = xx;
      state.FloodY = yy;
      context.hooks.sendMesAt(-42, xx, yy);
      return;
    }
  }
}

/**
 * Scenario firebomb handler; forwards to the UI/scripting layer.
 * Mirrors `DropFireBombs` in `ref/micropolis/src/sim/w_stubs.c` (1:1 port via hook).
 */
export function dropFireBombs(context: SimContext): void {
  context.hooks.dropFireBombs();
}

/**
 * Dispatches a tornado sprite via the external sprite system.
 * Mirrors `MakeTornado` in `ref/micropolis/src/sim/w_sprite.c` (1:1 port via hook).
 */
function makeTornado(context: SimContext): void {
  context.hooks.makeTornado();
}

/**
 * Dispatches a monster sprite via the external sprite system.
 * Mirrors `MakeMonster` in `ref/micropolis/src/sim/w_sprite.c` (1:1 port via hook).
 */
function makeMonster(context: SimContext): void {
  context.hooks.makeMonster();
}

/**
 * Vulnerability predicate for earthquake damage.
 * Mirrors `Vunerable` in `ref/micropolis/src/sim/s_disast.c` (1:1 port).
 */
function isVulnerable(tile: number): boolean {
  const tileId = tile & LOMASK;
  if (tileId < RESBASE || tileId > LASTZONE || (tile & ZONEBIT) !== 0) {
    return false;
  }
  return true;
}
