import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import type { MapStore } from '../core/map-store.ts';

const { WORLD_X, WORLD_Y } = World;
const { LOMASK, ALLBITS } = TileMask;
const { CONDBIT, ZONEBIT } = TileFlag;
const {
  FIREBASE,
  FLOOD,
  LASTTINYEXP,
  POWERBASE,
  RADTILE,
  RAILBASE,
  RESBASE,
  ROADBASE,
  SOMETINYEXP,
} = Tile;

export interface MapScanSlice {
  x1: number;
  x2: number;
}

export interface MapScanContext {
  store: MapStore;
  map: Uint16Array;
  x: number;
  y: number;
  index: number;
  tile: number;
  tileId: number;
  flags: number;
  writeTile: (value: number) => void;
}

export interface MapScanHandlers {
  onFire?: (context: MapScanContext) => void;
  onFlood?: (context: MapScanContext) => void;
  onRadTile?: (context: MapScanContext) => void;
  onConductive?: (context: MapScanContext) => void;
  onRoad?: (context: MapScanContext) => void;
  onZone?: (context: MapScanContext) => void;
  onRail?: (context: MapScanContext) => void;
  onTinyExplosion?: (context: MapScanContext) => void;
}

export interface MapScanOptions {
  newPower?: boolean;
}

const noop = () => {};

export function getMapScanSlice(phase: number, worldX: number = WORLD_X): MapScanSlice | null {
  if (phase < 1 || phase > 8) {
    return null;
  }
  const x1 = Math.floor(((phase - 1) * worldX) / 8);
  const x2 = Math.floor((phase * worldX) / 8);
  return { x1, x2 };
}

export function runMapScanPhase(
  store: MapStore,
  phase: number,
  handlers?: MapScanHandlers,
  options: MapScanOptions = {},
): boolean {
  const slice = getMapScanSlice(phase);
  if (!slice) {
    return false;
  }
  mapScanSlice(store, slice.x1, slice.x2, handlers, options);
  return true;
}

export function mapScanSlice(
  store: MapStore,
  x1: number,
  x2: number,
  handlers?: MapScanHandlers,
  options: MapScanOptions = {},
): void {
  if (x1 < 0 || x2 > WORLD_X || x2 < x1) {
    throw new Error(`mapScanSlice bounds out of range: [${x1}, ${x2})`);
  }

  const map = store.getLayer('map') as Uint16Array;
  const newPower = options.newPower ?? false;

  const onFire = handlers?.onFire ?? noop;
  const onFlood = handlers?.onFlood ?? noop;
  const onRadTile = handlers?.onRadTile ?? noop;
  const onConductive = handlers?.onConductive ?? noop;
  const onRoad = handlers?.onRoad ?? noop;
  const onZone = handlers?.onZone ?? noop;
  const onRail = handlers?.onRail ?? noop;
  const onTinyExplosion = handlers?.onTinyExplosion ?? noop;

  const context: MapScanContext = {
    store,
    map,
    x: 0,
    y: 0,
    index: 0,
    tile: 0,
    tileId: 0,
    flags: 0,
    writeTile: noop,
  };

  context.writeTile = (value: number) => store.write('map', context.index, value);

  for (let x = x1; x < x2; x += 1) {
    const baseIndex = x * WORLD_Y;
    for (let y = 0; y < WORLD_Y; y += 1) {
      const index = baseIndex + y;
      const tile = map[index] ?? 0;
      if (tile === 0) {
        continue;
      }
      const tileId = tile & LOMASK;
      if (tileId < FLOOD) {
        continue;
      }

      const flags = tile & ALLBITS;
      context.x = x;
      context.y = y;
      context.index = index;
      context.tile = tile;
      context.tileId = tileId;
      context.flags = flags;

      if (tileId < ROADBASE) {
        if (tileId >= FIREBASE) {
          onFire(context);
          continue;
        }
        if (tileId < RADTILE) {
          onFlood(context);
          continue;
        }
        onRadTile(context);
        continue;
      }

      if (newPower && (flags & CONDBIT) !== 0) {
        onConductive(context);
      }

      if (tileId >= ROADBASE && tileId < POWERBASE) {
        onRoad(context);
        continue;
      }

      if ((flags & ZONEBIT) !== 0) {
        onZone(context);
        continue;
      }

      if (tileId >= RAILBASE && tileId < RESBASE) {
        onRail(context);
        continue;
      }

      if (tileId >= SOMETINYEXP && tileId <= LASTTINYEXP) {
        onTinyExplosion(context);
      }
    }
  }
}
