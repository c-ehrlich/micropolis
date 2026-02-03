import { assertDefined } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import type { MapScanContext } from './map-scan.ts';

const { WORLD_X, WORLD_Y, SmX, SmY } = World;
const { LOMASK } = TileMask;
const { ANIMBIT, BULLBIT, BURNBIT, ZONEBIT } = TileFlag;
const { AIRPORT, FIRE, FLOOD, IZB, PORTBASE, ROADBASE, RUBBLE, WOODS5 } = Tile;

const FIRE_DX = [-1, 0, 1, 0] as const;
const FIRE_DY = [0, -1, 0, 1] as const;
const FLOOD_DX = [0, 1, 0, -1] as const;
const FLOOD_DY = [-1, 0, 1, 0] as const;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;
const rateIndex = (x: number, y: number) => x * SmY + y;
const inBounds = (x: number, y: number) => x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y;

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
