import { assertDefined } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import type { MapScanContext } from './map-scan.ts';
import type { BridgeHandler } from './roads.ts';

const { WORLD_X, WORLD_Y } = World;
const { LOMASK } = TileMask;
const { BULLBIT } = TileFlag;
const {
  BRWH,
  BRWV,
  CHANNEL,
  HBRDG0,
  HBRDG1,
  HBRDG2,
  HBRDG3,
  HBRIDGE,
  RIVER,
  VBRDG0,
  VBRDG1,
  VBRDG2,
  VBRDG3,
  VBRIDGE,
} = Tile;

const SHAPE_MASK = 15;
const SHIP_SPRITE_TYPE = 4;
const OPEN_DISTANCE_THRESHOLD = 300;
const CLOSE_DISTANCE_THRESHOLD = 340;

const HDX = [-2, 2, -2, -1, 0, 1, 2] as const;
const HDY = [-1, -1, 0, 0, 0, 0, 0] as const;
const HBRTAB = [
  HBRDG1 | BULLBIT,
  HBRDG3 | BULLBIT,
  HBRDG0 | BULLBIT,
  RIVER,
  BRWH | BULLBIT,
  RIVER,
  HBRDG2 | BULLBIT,
] as const;
const HBRTAB2 = [
  RIVER,
  RIVER,
  HBRIDGE | BULLBIT,
  HBRIDGE | BULLBIT,
  HBRIDGE | BULLBIT,
  HBRIDGE | BULLBIT,
  HBRIDGE | BULLBIT,
] as const;

const VDX = [0, 1, 0, 0, 0, 0, 1] as const;
const VDY = [-2, -2, -1, 0, 1, 2, 2] as const;
const VBRTAB = [
  VBRDG0 | BULLBIT,
  VBRDG1 | BULLBIT,
  RIVER,
  BRWV | BULLBIT,
  RIVER,
  VBRDG2 | BULLBIT,
  VBRDG3 | BULLBIT,
] as const;
const VBRTAB2 = [
  VBRIDGE | BULLBIT,
  RIVER,
  VBRIDGE | BULLBIT,
  VBRIDGE | BULLBIT,
  VBRIDGE | BULLBIT,
  VBRIDGE | BULLBIT,
  RIVER,
] as const;

const DEFAULT_BOAT_DISTANCE = 99999;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < WORLD_X && y < WORLD_Y;

interface ShipSpriteState {
  x: number;
  y: number;
  x_hot: number;
  y_hot: number;
  frame: number;
}

/**
 * Runtime ship-sprite shape guard used by bridge proximity checks.
 * Mirrors `GetSprite(SHI)` object access in `ref/micropolis/src/sim/w_sprite.c`
 * and `GetBoatDis` field usage in `ref/micropolis/src/sim/s_sim.c`.
 */
const isShipSpriteState = (value: unknown): value is ShipSpriteState => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const sprite = value as Partial<ShipSpriteState>;
  return (
    typeof sprite.x === 'number' &&
    typeof sprite.y === 'number' &&
    typeof sprite.x_hot === 'number' &&
    typeof sprite.y_hot === 'number' &&
    typeof sprite.frame === 'number'
  );
};

/**
 * Ship distance probe for one scanned bridge tile.
 * Mirrors `GetBoatDis` in `ref/micropolis/src/sim/s_sim.c`:
 * computes Manhattan distance from current map-tile center to active ship hotspot.
 *
 * Port note:
 * - C iterates a sprite linked-list.
 * - sim-core keeps one active sprite per type (`GetSprite` parity), so this reads
 *   the current `SHI` sprite slot directly.
 */
const getBoatDistanceFromSprite = (scan: MapScanContext, context: SimContext): number => {
  const sprite = context.hooks.getSprite(SHIP_SPRITE_TYPE);
  if (!isShipSpriteState(sprite) || sprite.frame === 0) {
    return DEFAULT_BOAT_DISTANCE;
  }

  const mx = (scan.x << 4) + 8;
  const my = (scan.y << 4) + 8;

  let dx = sprite.x + sprite.x_hot - mx;
  if (dx < 0) {
    dx = -dx;
  }
  let dy = sprite.y + sprite.y_hot - my;
  if (dy < 0) {
    dy = -dy;
  }

  return dx + dy;
};

/**
 * Resolves bridge boat-distance input with C-compatible fallback semantics.
 * Mirrors `GetBoatDis` use sites in `DoBridge` (`ref/micropolis/src/sim/s_sim.c`).
 *
 * Port note:
 * - Existing host hooks default `getBoatDistance` to sentinel `99999`.
 * - When that default is detected, this falls back to sprite-derived distance
 *   so bridges still react to nearby ships like the C runtime.
 */
const resolveBoatDistance = (
  scan: MapScanContext,
  context: SimContext,
  override?: () => number,
): number => {
  if (override) {
    return override();
  }

  const hookDistance = context.hooks.getBoatDistance();
  if (hookDistance !== DEFAULT_BOAT_DISTANCE) {
    return hookDistance;
  }

  return getBoatDistanceFromSprite(scan, context);
};

export interface BridgeHandlerOptions {
  getBoatDistance?: () => number;
}

/**
 * Bridge handler factory for road-map scan dispatch.
 * Mirrors `DoRoad` -> `DoBridge` call wiring in `ref/micropolis/src/sim/s_sim.c`.
 */
export function createBridgeHandler(
  _state: SimState,
  context: SimContext,
  options: BridgeHandlerOptions = {},
): BridgeHandler {
  return (scan) =>
    doBridge(scan, context, () => resolveBoatDistance(scan, context, options.getBoatDistance));
}

/**
 * Bridge open/close transition logic for road scan tiles.
 * Mirrors `DoBridge` in `ref/micropolis/src/sim/s_sim.c` (1:1 tables/conditions).
 */
export function doBridge(
  scan: MapScanContext,
  context: SimContext,
  getBoatDistance: () => number,
): boolean {
  const { map, store } = scan;
  const baseX = scan.x;
  const baseY = scan.y;

  if (scan.tileId === BRWV) {
    if ((context.rng.next16() & 3) === 0 && getBoatDistance() > CLOSE_DISTANCE_THRESHOLD) {
      for (let z = 0; z < 7; z += 1) {
        const vdx = VDX[z];
        const vdy = VDY[z];
        assertDefined(vdx);
        assertDefined(vdy);
        const x = baseX + vdx;
        const y = baseY + vdy;
        if (!inBounds(x, y)) {
          continue;
        }
        const index = indexFor(x, y);
        const vt1 = VBRTAB[z];
        const vt2 = VBRTAB2[z];
        assertDefined(vt1);
        assertDefined(vt2);
        if (((map[index] ?? 0) & LOMASK) === (vt1 & LOMASK)) {
          store.write('map', index, vt2);
        }
      }
    }
    return true;
  }

  if (scan.tileId === BRWH) {
    if ((context.rng.next16() & 3) === 0 && getBoatDistance() > CLOSE_DISTANCE_THRESHOLD) {
      for (let z = 0; z < 7; z += 1) {
        const hdx = HDX[z];
        const hdy = HDY[z];
        assertDefined(hdx);
        assertDefined(hdy);
        const x = baseX + hdx;
        const y = baseY + hdy;
        if (!inBounds(x, y)) {
          continue;
        }
        const index = indexFor(x, y);
        const ht1 = HBRTAB[z];
        const ht2 = HBRTAB2[z];
        assertDefined(ht1);
        assertDefined(ht2);
        if (((map[index] ?? 0) & LOMASK) === (ht1 & LOMASK)) {
          store.write('map', index, ht2);
        }
      }
    }
    return true;
  }

  const boatDistance = getBoatDistance();
  if (boatDistance < OPEN_DISTANCE_THRESHOLD || (context.rng.next16() & 7) === 0) {
    if ((scan.tileId & 1) !== 0) {
      if (baseX < WORLD_X - 1) {
        const channelIndex = indexFor(baseX + 1, baseY);
        if ((map[channelIndex] ?? 0) === CHANNEL) {
          for (let z = 0; z < 7; z += 1) {
            const vdx = VDX[z];
            const vdy = VDY[z];
            assertDefined(vdx);
            assertDefined(vdy);
            const x = baseX + vdx;
            const y = baseY + vdy;
            if (!inBounds(x, y)) {
              continue;
            }
            const index = indexFor(x, y);
            const value = map[index] ?? 0;
            const vt1 = VBRTAB[z];
            const vt2 = VBRTAB2[z];
            assertDefined(vt1);
            assertDefined(vt2);
            if (value === CHANNEL || (value & SHAPE_MASK) === (vt2 & SHAPE_MASK)) {
              store.write('map', index, vt1);
            }
          }
          return true;
        }
      }
      return false;
    }

    if (baseY > 0) {
      const channelIndex = indexFor(baseX, baseY - 1);
      if ((map[channelIndex] ?? 0) === CHANNEL) {
        for (let z = 0; z < 7; z += 1) {
          const hdx = HDX[z];
          const hdy = HDY[z];
          assertDefined(hdx);
          assertDefined(hdy);
          const x = baseX + hdx;
          const y = baseY + hdy;
          if (!inBounds(x, y)) {
            continue;
          }
          const index = indexFor(x, y);
          const value = map[index] ?? 0;
          const ht1 = HBRTAB[z];
          const ht2 = HBRTAB2[z];
          assertDefined(ht1);
          assertDefined(ht2);
          if (value === CHANNEL || (value & SHAPE_MASK) === (ht2 & SHAPE_MASK)) {
            store.write('map', index, ht1);
          }
        }
        return true;
      }
    }
    return false;
  }

  return false;
}
