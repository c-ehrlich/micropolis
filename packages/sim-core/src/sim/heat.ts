import { TileFlag, TileMask, World } from '../core/constants.ts';
import type { MapStore } from '../core/map-store.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';

const { WORLD_X, WORLD_Y } = World;
const { LOMASK } = TileMask;

const HEAT_FLAGS = TileFlag.ANIMBIT | TileFlag.BURNBIT | TileFlag.BULLBIT;
const SRCCOL = WORLD_Y + 2;
const DSTCOL = WORLD_Y;
const CELL_SRC_LENGTH = (WORLD_X + 2) * SRCCOL;
const ECOMASK = 0x3fc;

interface HeatScratch {
  cellSrc: Int16Array;
  accumulator: number;
}

const heatScratch = new WeakMap<SimContext, HeatScratch>();

/**
 * Resolve heat scratch buffers for the current context.
 * Mirrors the static `CellSrc` allocation and accumulator `a` in
 * `sim_heat` from `ref/micropolis/src/sim/sim.c` (1:1 port).
 */
function getHeatScratch(context: SimContext): HeatScratch {
  const existing = heatScratch.get(context);
  if (existing) {
    return existing;
  }
  const scratch: HeatScratch = {
    cellSrc: new Int16Array(CELL_SRC_LENGTH),
    accumulator: 0,
  };
  heatScratch.set(context, scratch);
  return scratch;
}

/**
 * Populate CellSrc according to the heat_wrap rules.
 * Mirrors the wrap handling switch in `sim_heat` from `ref/micropolis/src/sim/sim.c` (1:1 port).
 */
function applyHeatWrap(cellSrc: Int16Array, map: Uint16Array, heatWrap: number): void {
  switch (heatWrap) {
    case 0:
      return;
    case 1:
      for (let x = 0; x < WORLD_X; x += 1) {
        const srcBase = (x + 1) * SRCCOL + 1;
        const dstBase = x * DSTCOL;
        for (let y = 0; y < WORLD_Y; y += 1) {
          cellSrc[srcBase + y] = map[dstBase + y] ?? 0;
        }
      }
      return;
    case 2:
      for (let x = 0; x < WORLD_X; x += 1) {
        const srcBase = (x + 1) * SRCCOL + 1;
        cellSrc[srcBase - 1] = cellSrc[srcBase + WORLD_Y - 1] ?? 0;
        cellSrc[srcBase + WORLD_Y] = cellSrc[srcBase] ?? 0;
      }
      cellSrc.set(cellSrc.subarray(WORLD_X * SRCCOL, WORLD_X * SRCCOL + SRCCOL), 0);
      cellSrc.set(cellSrc.subarray(SRCCOL, SRCCOL + SRCCOL), (WORLD_X + 1) * SRCCOL);
      return;
    case 3:
      for (let x = 0; x < WORLD_X; x += 1) {
        const srcBase = (x + 1) * SRCCOL + 1;
        const dstBase = x * DSTCOL;
        for (let y = 0; y < WORLD_Y; y += 1) {
          cellSrc[srcBase + y] = map[dstBase + y] ?? 0;
        }
        cellSrc[srcBase - 1] = cellSrc[srcBase + WORLD_Y - 1] ?? 0;
        cellSrc[srcBase + WORLD_Y] = cellSrc[srcBase] ?? 0;
      }
      cellSrc.set(cellSrc.subarray(WORLD_X * SRCCOL, WORLD_X * SRCCOL + SRCCOL), 0);
      cellSrc.set(cellSrc.subarray(SRCCOL, SRCCOL + SRCCOL), (WORLD_X + 1) * SRCCOL);
      return;
    case 4:
      for (let x = 0; x < WORLD_X; x += 1) {
        const srcBase = (x + 1) * SRCCOL + 1;
        const dstBase = x * DSTCOL;
        for (let y = 0; y < WORLD_Y; y += 1) {
          cellSrc[srcBase + y] = map[dstBase + y] ?? 0;
        }
        cellSrc[srcBase - 1] = cellSrc[srcBase] ?? 0;
        cellSrc[srcBase + WORLD_Y] = cellSrc[srcBase + WORLD_Y - 1] ?? 0;
      }
      cellSrc.set(
        cellSrc.subarray(WORLD_X * SRCCOL, WORLD_X * SRCCOL + SRCCOL),
        (WORLD_X + 1) * SRCCOL,
      );
      cellSrc.set(cellSrc.subarray(SRCCOL, SRCCOL + SRCCOL), 0);
  }
}

/**
 * Execute heat_rule 0 output over the map.
 * Mirrors the HEAT macro path in `sim_heat` from `ref/micropolis/src/sim/sim.c` (1:1 port).
 */
function applyHeatRule0(
  cellSrc: Int16Array,
  store: MapStore,
  heatFlow: number,
  accumulator: number,
): number {
  let a = accumulator | 0;
  for (let x = 0; x < WORLD_X; x += 1) {
    const mapColumn = x * DSTCOL;
    const srcColumn = (x + 1) * SRCCOL + 1;
    if ((x & 1) === 0) {
      for (let y = 0; y < WORLD_Y; y += 1) {
        const srcIndex = srcColumn + y;
        const nw = cellSrc[srcIndex - SRCCOL - 1] ?? 0;
        const n = cellSrc[srcIndex - 1] ?? 0;
        const ne = cellSrc[srcIndex + SRCCOL - 1] ?? 0;
        const w = cellSrc[srcIndex - SRCCOL] ?? 0;
        const e = cellSrc[srcIndex + SRCCOL] ?? 0;
        const sw = cellSrc[srcIndex - SRCCOL + 1] ?? 0;
        const s = cellSrc[srcIndex + 1] ?? 0;
        const se = cellSrc[srcIndex + SRCCOL + 1] ?? 0;
        a = (a + nw + n + ne + w + e + sw + s + se + heatFlow) | 0;
        const value = ((a >> 3) & LOMASK) | HEAT_FLAGS;
        store.write('map', mapColumn + y, value);
        a &= 7;
      }
      continue;
    }

    for (let y = WORLD_Y - 1; y >= 0; y -= 1) {
      const srcIndex = srcColumn + y;
      const nw = cellSrc[srcIndex - SRCCOL - 1] ?? 0;
      const n = cellSrc[srcIndex - 1] ?? 0;
      const ne = cellSrc[srcIndex + SRCCOL - 1] ?? 0;
      const w = cellSrc[srcIndex - SRCCOL] ?? 0;
      const e = cellSrc[srcIndex + SRCCOL] ?? 0;
      const sw = cellSrc[srcIndex - SRCCOL + 1] ?? 0;
      const s = cellSrc[srcIndex + 1] ?? 0;
      const se = cellSrc[srcIndex + SRCCOL + 1] ?? 0;
      a = (a + nw + n + ne + w + e + sw + s + se + heatFlow) | 0;
      const value = ((a >> 3) & LOMASK) | HEAT_FLAGS;
      store.write('map', mapColumn + y, value);
      a &= 7;
    }
  }
  return a;
}

/**
 * Execute heat_rule 1 output over the map.
 * Mirrors the ECO macro path in `sim_heat` from `ref/micropolis/src/sim/sim.c` (1:1 port).
 */
function applyHeatRule1(cellSrc: Int16Array, store: MapStore, heatFlow: number): void {
  const fl = heatFlow | 0;
  for (let x = 0; x < WORLD_X; x += 1) {
    const mapColumn = x * DSTCOL;
    const srcColumn = (x + 1) * SRCCOL + 1;
    const yStart = (x & 1) === 0 ? 0 : WORLD_Y - 1;
    const yEnd = (x & 1) === 0 ? WORLD_Y : -1;
    const yStep = (x & 1) === 0 ? 1 : -1;
    for (let y = yStart; y !== yEnd; y += yStep) {
      const srcIndex = srcColumn + y;
      let c = cellSrc[srcIndex] ?? 0;
      let n = cellSrc[srcIndex - 1] ?? 0;
      let s = cellSrc[srcIndex + 1] ?? 0;
      let w = cellSrc[srcIndex - SRCCOL] ?? 0;
      let e = cellSrc[srcIndex + SRCCOL] ?? 0;
      let nw = cellSrc[srcIndex - SRCCOL - 1] ?? 0;
      let ne = cellSrc[srcIndex + SRCCOL - 1] ?? 0;
      let sw = cellSrc[srcIndex - SRCCOL + 1] ?? 0;
      let se = cellSrc[srcIndex + SRCCOL + 1] ?? 0;

      c -= fl;
      n -= fl;
      s -= fl;
      e -= fl;
      w -= fl;
      ne -= fl;
      nw -= fl;
      se -= fl;
      sw -= fl;

      let sum =
        (c & 1) + (n & 1) + (s & 1) + (e & 1) + (w & 1) + (ne & 1) + (nw & 1) + (se & 1) + (sw & 1);

      let cell: number;
      if (sum > 5 || sum === 4) {
        const neighborSum2 =
          (n & 2) + (s & 2) + (e & 2) + (w & 2) + (ne & 2) + (nw & 2) + (se & 2) + (sw & 2);
        const brainCell = ((c >> 1) & 3) === 0 && neighborSum2 === 4 ? 2 : 0;
        cell = ((c << 1) & ECOMASK) | brainCell | 1;
      } else {
        sum =
          ((n & 2) + (s & 2) + (e & 2) + (w & 2) + (ne & 2) + (nw & 2) + (se & 2) + (sw & 2)) >> 1;
        const antiLife = (c & 2) !== 0 ? (sum !== 5 ? 2 : 0) : sum !== 5 && sum !== 6 ? 2 : 0;
        cell = (((c ^ 2) << 1) & ECOMASK) | antiLife;
      }

      const value = ((fl + cell) & LOMASK) | HEAT_FLAGS;
      store.write('map', mapColumn + y, value);
    }
  }
}

/**
 * Run one heat simulation step against the map.
 * Mirrors `sim_heat` in `ref/micropolis/src/sim/sim.c` (1:1 port) with the CLIPPER
 * loop expressed as a zig-zag column scan for clarity.
 */
export function simHeat(state: SimState, context: SimContext): void {
  const map = context.store.getLayer('map') as Uint16Array;
  const scratch = getHeatScratch(context);

  applyHeatWrap(scratch.cellSrc, map, state.HeatWrap);

  if (state.HeatRule === 0) {
    scratch.accumulator = applyHeatRule0(
      scratch.cellSrc,
      context.store,
      state.HeatFlow,
      scratch.accumulator,
    );
    return;
  }
  if (state.HeatRule === 1) {
    applyHeatRule1(scratch.cellSrc, context.store, state.HeatFlow);
  }
}
