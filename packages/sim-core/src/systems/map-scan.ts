import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import type { MapStore } from '../core/map-store.ts';
import type { MicropolisRng } from '../core/rng.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import { setZPowerAt } from './power.ts';

const { WORLD_X, WORLD_Y } = World;
const { LOMASK, ALLBITS } = TileMask;
const { BULLBIT, CONDBIT, ZONEBIT } = TileFlag;
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
  state: SimState;
  rng: MicropolisRng;
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
  state: SimState,
  context: SimContext,
  phase: number,
  handlers?: MapScanHandlers,
  options: MapScanOptions = {},
): boolean {
  const slice = getMapScanSlice(phase);
  if (!slice) {
    return false;
  }
  mapScanSlice(state, context, slice.x1, slice.x2, handlers, options);
  return true;
}

export function mapScanSlice(
  state: SimState,
  context: SimContext,
  x1: number,
  x2: number,
  handlers?: MapScanHandlers,
  options: MapScanOptions = {},
): void {
  if (x1 < 0 || x2 > WORLD_X || x2 < x1) {
    throw new Error(`mapScanSlice bounds out of range: [${x1}, ${x2})`);
  }

  const map = context.store.getLayer('map') as Uint16Array;
  const rng = context.rng;
  const newPower = options.newPower ?? state.NewPower !== 0;
  const power = newPower ? (context.store.getLayer('power') as Uint16Array) : null;

  const onFire = handlers?.onFire ?? noop;
  const onFlood = handlers?.onFlood ?? noop;
  const onRadTile = handlers?.onRadTile ?? noop;
  const onConductive = handlers?.onConductive ?? noop;
  const onRoad = handlers?.onRoad ?? noop;
  const onZone = handlers?.onZone ?? noop;
  const onRail = handlers?.onRail ?? noop;
  const onTinyExplosion = handlers?.onTinyExplosion ?? noop;

  const scanContext: MapScanContext = {
    store: context.store,
    state,
    rng,
    map,
    x: 0,
    y: 0,
    index: 0,
    tile: 0,
    tileId: 0,
    flags: 0,
    writeTile: noop,
  };

  scanContext.writeTile = (value: number) => context.store.write('map', scanContext.index, value);

  for (let x = x1; x < x2; x += 1) {
    const baseIndex = x * WORLD_Y;
    for (let y = 0; y < WORLD_Y; y += 1) {
      const index = baseIndex + y;
      const tile = map[index] ?? 0;
      const tileId = tile & LOMASK;
      state.CChr9 = tileId;
      if (tile === 0) {
        continue;
      }
      if (tileId < FLOOD) {
        continue;
      }

      const flags = tile & ALLBITS;
      scanContext.x = x;
      scanContext.y = y;
      scanContext.index = index;
      scanContext.tile = tile;
      scanContext.tileId = tileId;
      scanContext.flags = flags;

      if (tileId < ROADBASE) {
        if (tileId >= FIREBASE) {
          state.FirePop += 1;
          if ((rng.next16() & 3) === 0) {
            onFire(scanContext);
          }
          continue;
        }
        if (tileId < RADTILE) {
          onFlood(scanContext);
          continue;
        }
        onRadTile(scanContext);
        continue;
      }

      if (newPower && (flags & CONDBIT) !== 0) {
        if (power) {
          setZPowerAt(context.store, power, x, y, index, tile);
        }
        onConductive(scanContext);
      }

      if (tileId >= ROADBASE && tileId < POWERBASE) {
        onRoad(scanContext);
        continue;
      }

      if ((flags & ZONEBIT) !== 0) {
        onZone(scanContext);
        continue;
      }

      if (tileId >= RAILBASE && tileId < RESBASE) {
        onRail(scanContext);
        continue;
      }

      if (tileId >= SOMETINYEXP && tileId <= LASTTINYEXP) {
        onTinyExplosion(scanContext);
        const rubble = Tile.RUBBLE + (rng.next16() & 3) + BULLBIT;
        context.store.write('map', index, rubble);
      }
    }
  }
}
