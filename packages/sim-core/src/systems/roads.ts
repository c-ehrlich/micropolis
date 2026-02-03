import { assertDefined } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import type { MapScanContext } from './map-scan.ts';

const { HWLDY } = World;
const { ALLBITS } = TileMask;
const { ANIMBIT, BULLBIT, BURNBIT, CONDBIT } = TileFlag;
const { ROADBASE, LTRFBASE, HTRFBASE, RIVER, RUBBLE } = Tile;

const DENTAB = [ROADBASE, LTRFBASE, HTRFBASE] as const;

export type BridgeHandler = (scan: MapScanContext, state: SimState, context: SimContext) => boolean;

export interface RoadHandlerOptions {
  doBridge?: BridgeHandler;
}

export function createRoadHandler(
  state: SimState,
  context: SimContext,
  options: RoadHandlerOptions = {},
): (scan: MapScanContext) => void {
  const trfDensity = context.store.getLayer('trfDensity') as Uint8Array;
  const doBridge = options.doBridge ?? (() => false);
  return (scan) => doRoad(scan, state, context, trfDensity, doBridge);
}

export function doRoad(
  scan: MapScanContext,
  state: SimState,
  context: SimContext,
  trfDensity: Uint8Array,
  doBridge: BridgeHandler,
): void {
  state.RoadTotal += 1;

  if (state.RoadEffect < 30) {
    if ((context.rng.next16() & 511) === 0) {
      if ((scan.flags & CONDBIT) === 0) {
        if (state.RoadEffect < (context.rng.next16() & 31)) {
          const shape = scan.tileId & 15;
          if (shape < 2 || shape === 15) {
            scan.writeTile(RIVER);
          } else {
            scan.writeTile(RUBBLE + (context.rng.next16() & 3) + BULLBIT);
          }
          return;
        }
      }
    }
  }

  if ((scan.flags & BURNBIT) === 0) {
    state.RoadTotal += 4;
    if (doBridge(scan, state, context)) {
      return;
    }
  }

  let tden = 0;
  if (scan.tileId < LTRFBASE) {
    tden = 0;
  } else if (scan.tileId < HTRFBASE) {
    tden = 1;
  } else {
    tden = 2;
    state.RoadTotal += 1;
  }

  const trfIndex = (scan.x >> 1) * HWLDY + (scan.y >> 1);
  let density = (trfDensity[trfIndex] ?? 0) >> 6;
  if (density > 1) {
    density -= 1;
  }

  if (tden !== density) {
    const shape = (scan.tileId - ROADBASE) & 15;
    const d = DENTAB[density];
    assertDefined(d);
    let value = shape + d;
    value += scan.flags & (ALLBITS & ~ANIMBIT);
    if (density) {
      value += ANIMBIT;
    }
    scan.writeTile(value);
  }
}
