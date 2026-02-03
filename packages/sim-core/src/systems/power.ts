import { assertDefined } from '../core/assert.ts';
import { PowerMap, Tile, TileFlag, TileMask } from '../core/constants.ts';
import type { MapStore } from '../core/map-store.ts';

const { POWERMAPROW, PWRMAPSIZE } = PowerMap;
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
  const layer = power[powerWord];
  assertDefined(layer);
  const powered = isPlant || (powerWord < PWRMAPSIZE && (layer & (1 << (x & 15))) !== 0);

  const nextTile = powered ? tile | PWRBIT : tile & ~PWRBIT;
  if (nextTile !== tile) {
    store.write('map', index, nextTile);
  }
  return powered;
}
