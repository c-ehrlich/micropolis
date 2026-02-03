import { Tile, TileFlag } from '../core/constants.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import type { MapScanContext } from './map-scan.ts';

const { RAILBASE, RIVER, RUBBLE } = Tile;
const { BULLBIT, CONDBIT } = TileFlag;

export function doRail(scan: MapScanContext, state: SimState, context: SimContext): void {
  state.RailTotal += 1;
  context.hooks.generateTrain(scan.x, scan.y);

  if (state.RoadEffect < 30) {
    const rng = context.rng;
    if ((rng.next16() & 511) === 0) {
      if ((scan.tile & CONDBIT) === 0) {
        if (state.RoadEffect < (rng.next16() & 31)) {
          if (scan.tileId < RAILBASE + 2) {
            scan.writeTile(RIVER);
          } else {
            scan.writeTile(RUBBLE + (rng.next16() & 3) + BULLBIT);
          }
        }
      }
    }
  }
}

export function createRailHandler(state: SimState, context: SimContext) {
  return (scan: MapScanContext) => doRail(scan, state, context);
}
