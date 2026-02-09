import { getOrThrow } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import type { MapStore } from '../core/map-store.ts';
import type { MicropolisRng } from '../core/rng.ts';

const {
  AIRPORT,
  AIRPORTBASE,
  BRWH,
  BRWV,
  CHANNEL,
  COALBASE,
  COALSMOKE3,
  COMBASE,
  DIRT,
  FIRESTBASE,
  FIRSTRIVEDGE,
  FOUNTAIN,
  HBRDG0,
  HBRDG1,
  HBRDG2,
  HBRDG3,
  HBRIDGE,
  HPOWER,
  HRAIL,
  HRAILROAD,
  HROADPOWER,
  INDBASE,
  INTERSECTION,
  LASTPOWERPLANT,
  LASTPORT,
  LASTRUBBLE,
  LASTTINYEXP,
  LASTZONE,
  LHPOWER,
  LHRAIL,
  LVPOWER,
  LVRAIL,
  NUCLEAR,
  NUCLEARBASE,
  POLICESTBASE,
  POLICESTATION,
  PORT,
  PORTBASE,
  POWERBASE,
  POWERPLANT,
  RADTILE,
  RAILHPOWERV,
  RAILVPOWERH,
  RIVER,
  REDGE,
  RESBASE,
  ROADBASE,
  ROADS,
  SOMETINYEXP,
  STADIUM,
  STADIUMBASE,
  TELEBASE,
  TINYEXP,
  VBRDG0,
  VBRDG1,
  VBRDG2,
  VBRDG3,
  VBRIDGE,
  VPOWER,
  VRAIL,
  VRAILROAD,
  VROADPOWER,
  WOODS2,
} = Tile;
const { ANIMBIT, BNCNBIT, BULLBIT, BURNBIT, CONDBIT, ZONEBIT } = TileFlag;
const { LOMASK } = TileMask;
const { WORLD_X, WORLD_Y } = World;

/**
 * Tool-state ids used by Micropolis tool dispatch.
 * Mirrors tool ordering consumed by `road_tool`/`rail_tool`/`wire_tool`/etc in
 * `ref/micropolis/src/sim/w_tool.c` (1:1 state ids).
 */
export const TOOL_STATE = {
  res: 0,
  com: 1,
  ind: 2,
  fire: 3,
  query: 4,
  police: 5,
  wire: 6,
  bulldoze: 7,
  rail: 8,
  road: 9,
  chalk: 10,
  eraser: 11,
  stadium: 12,
  park: 13,
  seaport: 14,
  coal: 15,
  nuclear: 16,
  airport: 17,
  network: 18,
} as const;

export type ToolName = keyof typeof TOOL_STATE;

/**
 * Tool base costs indexed by `tool_state`.
 * Mirrors `CostOf[]` in `ref/micropolis/src/sim/w_tool.c` (1:1 values/order).
 */
export const TOOL_COST: readonly number[] = [
  100, 100, 100, 500, 0, 500, 5, 1, 20, 10, 0, 0, 5000, 10, 3000, 3000, 5000, 10000, 100, 0,
];

/**
 * Tool footprint size indexed by `tool_state`.
 * Mirrors `toolSize[]` in `ref/micropolis/src/sim/w_tool.c` (1:1 values/order).
 */
export const TOOL_SIZE: readonly number[] = [
  3, 3, 3, 3, 1, 3, 1, 1, 1, 1, 0, 0, 4, 1, 4, 4, 4, 6, 1, 0,
];

/**
 * Tool cursor offset indexed by `tool_state`.
 * Mirrors `toolOffset[]` in `ref/micropolis/src/sim/w_tool.c` (1:1 values/order).
 */
export const TOOL_OFFSET: readonly number[] = [
  1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0,
];

export const ROAD_TABLE: readonly number[] = [
  66, 67, 66, 68, 67, 67, 69, 73, 66, 71, 66, 72, 70, 75, 74, 76,
];

export const RAIL_TABLE: readonly number[] = [
  226, 227, 226, 228, 227, 227, 229, 233, 226, 231, 226, 232, 230, 235, 234, 236,
];

export const WIRE_TABLE: readonly number[] = [
  210, 211, 210, 212, 211, 211, 213, 217, 210, 215, 210, 216, 214, 219, 218, 220,
];

export type ToolResult = 'ok' | 'out-of-bounds' | 'no-funds' | 'reject';

export interface ToolOutcome {
  result: ToolResult;
  code: number;
}

export interface ToolAction {
  tool: ToolName;
  x: number;
  y: number;
  simStep: number;
  order: number;
  tickId: number;
  seq: number;
}

export type ToolActionInput = Omit<ToolAction, 'seq'>;

export class ToolQueue {
  private actions: ToolAction[] = [];
  private nextSeq = 0;

  enqueue(action: ToolActionInput): ToolAction {
    const stamped = { ...action, seq: this.nextSeq };
    this.nextSeq += 1;
    this.actions.push(stamped);
    return stamped;
  }

  drainSorted(): ToolAction[] {
    const sorted = [...this.actions].sort(compareToolActions);
    this.actions.length = 0;
    return sorted;
  }

  get size(): number {
    return this.actions.length;
  }
}

export interface ToolContext {
  store: MapStore;
  rng: MicropolisRng;
  funds: number;
  autoBulldoze: boolean;
  doAnimation: boolean;
  players: number;
  overrideCost: boolean;
  expensive: number;
  superUser: boolean;
}

export function createToolContext(options: {
  store: MapStore;
  rng: MicropolisRng;
  funds?: number;
  autoBulldoze?: boolean;
  doAnimation?: boolean;
  players?: number;
  overrideCost?: boolean;
  expensive?: number;
  superUser?: boolean;
}): ToolContext {
  return {
    store: options.store,
    rng: options.rng,
    funds: options.funds ?? 0,
    autoBulldoze: options.autoBulldoze ?? false,
    doAnimation: options.doAnimation ?? true,
    players: options.players ?? 1,
    overrideCost: options.overrideCost ?? false,
    expensive: options.expensive ?? 1000,
    superUser: options.superUser ?? false,
  };
}

export function compareToolActions(a: ToolAction, b: ToolAction): number {
  if (a.simStep !== b.simStep) {
    return a.simStep - b.simStep;
  }
  if (a.order !== b.order) {
    return a.order - b.order;
  }
  return a.seq - b.seq;
}

export function sortToolActions(actions: ToolAction[]): ToolAction[] {
  return [...actions].sort(compareToolActions);
}

export function applyToolQueue(context: ToolContext, queue: ToolQueue): ToolOutcome[] {
  const actions = queue.drainSorted();
  return actions.map((action) => applyToolAction(context, action));
}

export function applyToolAction(context: ToolContext, action: ToolAction): ToolOutcome {
  const map = context.store.getLayer('map') as Uint16Array;
  const code = doTool(context, map, action.tool, action.x, action.y);
  return { result: toolResultFromCode(code), code };
}

export function toolResultFromCode(code: number): ToolResult {
  switch (code) {
    case 1:
      return 'ok';
    case -1:
      return 'out-of-bounds';
    case -2:
      return 'no-funds';
    default:
      return 'reject';
  }
}

export function connecTile(
  context: ToolContext,
  map: Uint16Array,
  x: number,
  y: number,
  command: number,
): number {
  if (!testBounds(x, y)) {
    return 0;
  }

  if (command >= 2 && command <= 4) {
    if (context.autoBulldoze && context.funds > 0) {
      const current = tileAt(map, x, y);
      if (current & BULLBIT) {
        const normalized = neutralizeRoad(current);
        if (
          (normalized >= TINYEXP && normalized <= LASTTINYEXP) ||
          (normalized < ROADBASE && normalized !== 0)
        ) {
          spend(context, 1);
          setTile(context, map, x, y, 0);
        }
      }
    }
  }

  let result = 1;

  switch (command) {
    case 0:
      fixZone(context, map, x, y);
      break;
    case 1:
      result = layDoze(context, map, x, y);
      fixZone(context, map, x, y);
      break;
    case 2:
      result = layRoad(context, map, x, y);
      fixZone(context, map, x, y);
      break;
    case 3:
      result = layRail(context, map, x, y);
      fixZone(context, map, x, y);
      break;
    case 4:
      result = layWire(context, map, x, y);
      fixZone(context, map, x, y);
      break;
    default:
      break;
  }

  return result;
}

function doTool(
  context: ToolContext,
  map: Uint16Array,
  tool: ToolName,
  x: number,
  y: number,
): number {
  switch (tool) {
    case 'query':
      return testBounds(x, y) ? 1 : -1;
    case 'bulldoze':
      return bulldozerTool(context, map, x, y);
    case 'road':
      return roadTool(context, map, x, y);
    case 'rail':
      return railTool(context, map, x, y);
    case 'wire':
      return wireTool(context, map, x, y);
    case 'park':
      return parkTool(context, map, x, y);
    case 'res':
      return check3x3Tool(context, map, x, y, RESBASE, TOOL_STATE.res);
    case 'com':
      return check3x3Tool(context, map, x, y, COMBASE, TOOL_STATE.com);
    case 'ind':
      return check3x3Tool(context, map, x, y, INDBASE, TOOL_STATE.ind);
    case 'police':
      return check3x3Tool(context, map, x, y, POLICESTBASE, TOOL_STATE.police);
    case 'fire':
      return check3x3Tool(context, map, x, y, FIRESTBASE, TOOL_STATE.fire);
    case 'stadium':
      return check4x4Tool(context, map, x, y, STADIUMBASE, false, TOOL_STATE.stadium);
    case 'coal':
      return check4x4Tool(context, map, x, y, COALBASE, true, TOOL_STATE.coal);
    case 'nuclear':
      return check4x4Tool(context, map, x, y, NUCLEARBASE, true, TOOL_STATE.nuclear);
    case 'seaport':
      return check4x4Tool(context, map, x, y, PORTBASE, false, TOOL_STATE.seaport);
    case 'airport':
      return check6x6Tool(context, map, x, y, AIRPORTBASE, TOOL_STATE.airport);
    case 'network':
      return networkTool(context, map, x, y);
    case 'chalk':
    case 'eraser':
      return testBounds(x, y) ? 1 : -1;
    default:
      return 0;
  }
}

function roadTool(context: ToolContext, map: Uint16Array, x: number, y: number): number {
  if (!testBounds(x, y)) {
    return -1;
  }
  return connecTile(context, map, x, y, 2);
}

function railTool(context: ToolContext, map: Uint16Array, x: number, y: number): number {
  if (!testBounds(x, y)) {
    return -1;
  }
  return connecTile(context, map, x, y, 3);
}

function wireTool(context: ToolContext, map: Uint16Array, x: number, y: number): number {
  if (!testBounds(x, y)) {
    return -1;
  }
  return connecTile(context, map, x, y, 4);
}

function parkTool(context: ToolContext, map: Uint16Array, x: number, y: number): number {
  if (!testBounds(x, y)) {
    return -1;
  }
  return putDownPark(context, map, x, y);
}

function bulldozerTool(context: ToolContext, map: Uint16Array, x: number, y: number): number {
  if (!testBounds(x, y)) {
    return -1;
  }

  const index = indexFor(x, y);
  const current = getOrThrow(map[index]);
  const tile = current & LOMASK;
  let result = 1;

  if (current & ZONEBIT) {
    if (context.funds > 0) {
      spend(context, 1);
      switch (checkSize(tile)) {
        case 3:
          put3x3Rubble(context, map, x, y);
          break;
        case 4:
          put4x4Rubble(context, map, x, y);
          break;
        case 6:
          put6x6Rubble(context, map, x, y);
          break;
        default:
          break;
      }
    }
  } else {
    const bigZone = checkBigZone(tile);
    if (bigZone) {
      if (context.funds > 0) {
        spend(context, 1);
        switch (bigZone.size) {
          case 4:
            put4x4Rubble(context, map, x + bigZone.dx, y + bigZone.dy);
            break;
          case 6:
            put6x6Rubble(context, map, x + bigZone.dx, y + bigZone.dy);
            break;
          default:
            break;
        }
      }
    } else if (tile === RIVER || tile === REDGE || tile === CHANNEL) {
      if (context.funds >= 6) {
        result = connecTile(context, map, x, y, 1);
        const updated = getOrThrow(map[index]) & LOMASK;
        if (tile !== updated) {
          spend(context, 5);
        }
      } else {
        result = 0;
      }
    } else {
      result = connecTile(context, map, x, y, 1);
    }
  }

  return result;
}

function check3x3Tool(
  context: ToolContext,
  map: Uint16Array,
  x: number,
  y: number,
  base: number,
  toolState: number,
): number {
  if (!testBounds(x, y)) {
    return -1;
  }
  return check3x3(context, map, x, y, base, toolState);
}

function check4x4Tool(
  context: ToolContext,
  map: Uint16Array,
  x: number,
  y: number,
  base: number,
  aniFlag: boolean,
  toolState: number,
): number {
  if (!testBounds(x, y)) {
    return -1;
  }
  return check4x4(context, map, x, y, base, aniFlag, toolState);
}

function check6x6Tool(
  context: ToolContext,
  map: Uint16Array,
  x: number,
  y: number,
  base: number,
  toolState: number,
): number {
  if (!testBounds(x, y)) {
    return -1;
  }
  return check6x6(context, map, x, y, base, toolState);
}

function networkTool(context: ToolContext, map: Uint16Array, x: number, y: number): number {
  if (!testBounds(x, y)) {
    return -1;
  }
  return putDownNetwork(context, map, x, y);
}

function putDownPark(context: ToolContext, map: Uint16Array, x: number, y: number): number {
  const parkCost = getOrThrow(TOOL_COST[TOOL_STATE.park]);
  if (context.funds - parkCost < 0) {
    return -2;
  }

  const value = context.rng.rand(4);
  const tile =
    value === 4 ? FOUNTAIN | BURNBIT | BULLBIT | ANIMBIT : (value + WOODS2) | BURNBIT | BULLBIT;

  if (tileAt(map, x, y) === 0) {
    spend(context, parkCost);
    setTile(context, map, x, y, tile);
    return 1;
  }

  return -1;
}

function putDownNetwork(context: ToolContext, map: Uint16Array, x: number, y: number): number {
  const networkCost = getOrThrow(TOOL_COST[TOOL_STATE.network]);
  let tile = tileAt(map, x, y) & LOMASK;

  if (context.funds > 0 && tally(tile)) {
    setTile(context, map, x, y, 0);
    tile = 0;
    spend(context, 1);
  }

  if (tile === 0) {
    if (context.funds - networkCost >= 0) {
      setTile(context, map, x, y, TELEBASE | CONDBIT | BURNBIT | BULLBIT | ANIMBIT);
      spend(context, networkCost);
      return 1;
    }
    return -2;
  }

  return -1;
}

function checkSize(tile: number): number {
  if (
    (tile >= RESBASE - 1 && tile <= PORTBASE - 1) ||
    (tile >= LASTPOWERPLANT + 1 && tile <= POLICESTATION + 4)
  ) {
    return 3;
  }
  if (
    (tile >= PORTBASE && tile <= LASTPORT) ||
    (tile >= COALBASE && tile <= LASTPOWERPLANT) ||
    (tile >= STADIUMBASE && tile <= LASTZONE)
  ) {
    return 4;
  }
  return 0;
}

function checkBigZone(tile: number): { size: number; dx: number; dy: number } | null {
  switch (tile) {
    case POWERPLANT:
    case PORT:
    case NUCLEAR:
    case STADIUM:
      return { size: 4, dx: 0, dy: 0 };
    case POWERPLANT + 1:
    case COALSMOKE3:
    case COALSMOKE3 + 1:
    case COALSMOKE3 + 2:
    case PORT + 1:
    case NUCLEAR + 1:
    case STADIUM + 1:
      return { size: 4, dx: -1, dy: 0 };
    case POWERPLANT + 4:
    case PORT + 4:
    case NUCLEAR + 4:
    case STADIUM + 4:
      return { size: 4, dx: 0, dy: -1 };
    case POWERPLANT + 5:
    case PORT + 5:
    case NUCLEAR + 5:
    case STADIUM + 5:
      return { size: 4, dx: -1, dy: -1 };
    case AIRPORT:
      return { size: 6, dx: 0, dy: 0 };
    case AIRPORT + 1:
      return { size: 6, dx: -1, dy: 0 };
    case AIRPORT + 2:
      return { size: 6, dx: -2, dy: 0 };
    case AIRPORT + 3:
      return { size: 6, dx: -3, dy: 0 };
    case AIRPORT + 6:
      return { size: 6, dx: 0, dy: -1 };
    case AIRPORT + 7:
      return { size: 6, dx: -1, dy: -1 };
    case AIRPORT + 8:
      return { size: 6, dx: -2, dy: -1 };
    case AIRPORT + 9:
      return { size: 6, dx: -3, dy: -1 };
    case AIRPORT + 12:
      return { size: 6, dx: 0, dy: -2 };
    case AIRPORT + 13:
      return { size: 6, dx: -1, dy: -2 };
    case AIRPORT + 14:
      return { size: 6, dx: -2, dy: -2 };
    case AIRPORT + 15:
      return { size: 6, dx: -3, dy: -2 };
    case AIRPORT + 18:
      return { size: 6, dx: 0, dy: -3 };
    case AIRPORT + 19:
      return { size: 6, dx: -1, dy: -3 };
    case AIRPORT + 20:
      return { size: 6, dx: -2, dy: -3 };
    case AIRPORT + 21:
      return { size: 6, dx: -3, dy: -3 };
    default:
      return null;
  }
}

function tally(tileValue: number): boolean {
  if (
    (tileValue >= FIRSTRIVEDGE && tileValue <= LASTRUBBLE) ||
    (tileValue >= POWERBASE + 2 && tileValue <= POWERBASE + 12) ||
    (tileValue >= TINYEXP && tileValue <= LASTTINYEXP + 2)
  ) {
    return true;
  }
  return false;
}

function check3x3(
  context: ToolContext,
  map: Uint16Array,
  x: number,
  y: number,
  base: number,
  toolState: number,
): number {
  let mapH = x - 1;
  let mapV = y - 1;

  if (mapH < 0 || mapH > WORLD_X - 3 || mapV < 0 || mapV > WORLD_Y - 3) {
    return -1;
  }

  const startX = mapH;
  const startY = mapV;
  let flag = true;
  let cost = 0;
  const toolCost = getOrThrow(TOOL_COST[toolState]);

  for (let row = 0; row <= 2; row += 1) {
    mapH = startX;
    for (let col = 0; col <= 2; col += 1) {
      const tileValue = tileAt(map, mapH, mapV) & LOMASK;
      if (context.autoBulldoze) {
        if (tileValue !== 0) {
          if (tally(tileValue)) {
            cost += 1;
          } else {
            flag = false;
          }
        }
      } else if (tileValue !== 0) {
        flag = false;
      }
      mapH += 1;
    }
    mapV += 1;
  }

  if (!flag) {
    return -1;
  }

  cost += toolCost;

  if (context.funds - cost < 0) {
    return -2;
  }

  if (
    context.players > 1 &&
    !context.overrideCost &&
    cost >= context.expensive &&
    !context.superUser
  ) {
    return -3;
  }

  spend(context, cost);

  mapV = startY;
  for (let row = 0; row <= 2; row += 1) {
    mapH = startX;
    for (let col = 0; col <= 2; col += 1) {
      const value = col === 1 && row === 1 ? base + BNCNBIT + ZONEBIT : base + BNCNBIT;
      setTile(context, map, mapH, mapV, value);
      base += 1;
      mapH += 1;
    }
    mapV += 1;
  }

  check3x3border(context, map, startX, startY);
  return 1;
}

function check4x4(
  context: ToolContext,
  map: Uint16Array,
  x: number,
  y: number,
  base: number,
  aniFlag: boolean,
  toolState: number,
): number {
  let mapH = x - 1;
  let mapV = y - 1;

  if (mapH < 0 || mapH > WORLD_X - 4 || mapV < 0 || mapV > WORLD_Y - 4) {
    return -1;
  }

  const startX = mapH;
  const startY = mapV;
  let flag = true;
  let cost = 0;
  const toolCost = getOrThrow(TOOL_COST[toolState]);

  for (let row = 0; row <= 3; row += 1) {
    mapH = startX;
    for (let col = 0; col <= 3; col += 1) {
      const tileValue = tileAt(map, mapH, mapV) & LOMASK;
      if (context.autoBulldoze) {
        if (tileValue !== 0) {
          if (tally(tileValue)) {
            cost += 1;
          } else {
            flag = false;
          }
        }
      } else if (tileValue !== 0) {
        flag = false;
      }
      mapH += 1;
    }
    mapV += 1;
  }

  if (!flag) {
    return -1;
  }

  cost += toolCost;

  if (context.funds - cost < 0) {
    return -2;
  }

  if (
    context.players > 1 &&
    !context.overrideCost &&
    cost >= context.expensive &&
    !context.superUser
  ) {
    return -3;
  }

  spend(context, cost);

  mapV = startY;
  for (let row = 0; row <= 3; row += 1) {
    mapH = startX;
    for (let col = 0; col <= 3; col += 1) {
      let value = base + BNCNBIT;
      if (col === 1 && row === 1) {
        value = base + BNCNBIT + ZONEBIT;
      } else if (col === 1 && row === 2 && aniFlag) {
        value = base + BNCNBIT + ANIMBIT;
      }
      setTile(context, map, mapH, mapV, value);
      base += 1;
      mapH += 1;
    }
    mapV += 1;
  }

  check4x4border(context, map, startX, startY);
  return 1;
}

function check6x6(
  context: ToolContext,
  map: Uint16Array,
  x: number,
  y: number,
  base: number,
  toolState: number,
): number {
  let mapH = x - 1;
  let mapV = y - 1;

  if (mapH < 0 || mapH > WORLD_X - 6 || mapV < 0 || mapV > WORLD_Y - 6) {
    return -1;
  }

  const startX = mapH;
  const startY = mapV;
  let flag = true;
  let cost = 0;
  const toolCost = getOrThrow(TOOL_COST[toolState]);

  for (let row = 0; row <= 5; row += 1) {
    mapH = startX;
    for (let col = 0; col <= 5; col += 1) {
      const tileValue = tileAt(map, mapH, mapV) & LOMASK;
      if (context.autoBulldoze) {
        if (tileValue !== 0) {
          if (tally(tileValue)) {
            cost += 1;
          } else {
            flag = false;
          }
        }
      } else if (tileValue !== 0) {
        flag = false;
      }
      mapH += 1;
    }
    mapV += 1;
  }

  if (!flag) {
    return -1;
  }

  cost += toolCost;

  if (context.funds - cost < 0) {
    return -2;
  }

  if (
    context.players > 1 &&
    !context.overrideCost &&
    cost >= context.expensive &&
    !context.superUser
  ) {
    return -3;
  }

  spend(context, cost);

  mapV = startY;
  for (let row = 0; row <= 5; row += 1) {
    mapH = startX;
    for (let col = 0; col <= 5; col += 1) {
      const value = col === 1 && row === 1 ? base + BNCNBIT + ZONEBIT : base + BNCNBIT;
      setTile(context, map, mapH, mapV, value);
      base += 1;
      mapH += 1;
    }
    mapV += 1;
  }

  check6x6border(context, map, startX, startY);
  return 1;
}

function check3x3border(context: ToolContext, map: Uint16Array, x: number, y: number): void {
  let xPos = x;
  let yPos = y - 1;
  for (let cnt = 0; cnt < 3; cnt += 1) {
    connecTile(context, map, xPos, yPos, 0);
    xPos += 1;
  }

  xPos = x - 1;
  yPos = y;
  for (let cnt = 0; cnt < 3; cnt += 1) {
    connecTile(context, map, xPos, yPos, 0);
    yPos += 1;
  }

  xPos = x;
  yPos = y + 3;
  for (let cnt = 0; cnt < 3; cnt += 1) {
    connecTile(context, map, xPos, yPos, 0);
    xPos += 1;
  }

  xPos = x + 3;
  yPos = y;
  for (let cnt = 0; cnt < 3; cnt += 1) {
    connecTile(context, map, xPos, yPos, 0);
    yPos += 1;
  }
}

function check4x4border(context: ToolContext, map: Uint16Array, x: number, y: number): void {
  let xPos = x;
  let yPos = y - 1;
  for (let cnt = 0; cnt < 4; cnt += 1) {
    connecTile(context, map, xPos, yPos, 0);
    xPos += 1;
  }

  xPos = x - 1;
  yPos = y;
  for (let cnt = 0; cnt < 4; cnt += 1) {
    connecTile(context, map, xPos, yPos, 0);
    yPos += 1;
  }

  xPos = x;
  yPos = y + 4;
  for (let cnt = 0; cnt < 4; cnt += 1) {
    connecTile(context, map, xPos, yPos, 0);
    xPos += 1;
  }

  xPos = x + 4;
  yPos = y;
  for (let cnt = 0; cnt < 4; cnt += 1) {
    connecTile(context, map, xPos, yPos, 0);
    yPos += 1;
  }
}

function check6x6border(context: ToolContext, map: Uint16Array, x: number, y: number): void {
  let xPos = x;
  let yPos = y - 1;
  for (let cnt = 0; cnt < 6; cnt += 1) {
    connecTile(context, map, xPos, yPos, 0);
    xPos += 1;
  }

  xPos = x - 1;
  yPos = y;
  for (let cnt = 0; cnt < 6; cnt += 1) {
    connecTile(context, map, xPos, yPos, 0);
    yPos += 1;
  }

  xPos = x;
  yPos = y + 6;
  for (let cnt = 0; cnt < 6; cnt += 1) {
    connecTile(context, map, xPos, yPos, 0);
    xPos += 1;
  }

  xPos = x + 6;
  yPos = y;
  for (let cnt = 0; cnt < 6; cnt += 1) {
    connecTile(context, map, xPos, yPos, 0);
    yPos += 1;
  }
}

function layDoze(context: ToolContext, map: Uint16Array, x: number, y: number): number {
  if (context.funds === 0) {
    return -2;
  }

  const index = indexFor(x, y);
  let tile = getOrThrow(map[index]);

  if ((tile & BULLBIT) === 0) {
    return 0;
  }

  tile = neutralizeRoad(tile);

  switch (tile) {
    case HBRIDGE:
    case VBRIDGE:
    case BRWV:
    case BRWH:
    case HBRDG0:
    case HBRDG1:
    case HBRDG2:
    case HBRDG3:
    case VBRDG0:
    case VBRDG1:
    case VBRDG2:
    case VBRDG3:
    case HPOWER:
    case VPOWER:
    case HRAIL:
    case VRAIL:
      setTile(context, map, x, y, RIVER);
      break;
    default:
      setTile(context, map, x, y, DIRT);
      break;
  }

  spend(context, 1);
  return 1;
}

function layRoad(context: ToolContext, map: Uint16Array, x: number, y: number): number {
  if (context.funds < 10) {
    return -2;
  }

  const index = indexFor(x, y);
  let tile = getOrThrow(map[index]) & LOMASK;
  let cost = 10;

  switch (tile) {
    case DIRT:
      setTile(context, map, x, y, ROADS | BULLBIT | BURNBIT);
      break;
    case RIVER:
    case REDGE:
    case CHANNEL: {
      if (context.funds < 50) {
        return -2;
      }
      cost = 50;

      if (x < WORLD_X - 1) {
        const neighbor = neutralizeRoad(tileAt(map, x + 1, y));
        if (
          neighbor === VRAILROAD ||
          neighbor === HBRIDGE ||
          (neighbor >= ROADS && neighbor <= HROADPOWER)
        ) {
          setTile(context, map, x, y, HBRIDGE | BULLBIT);
          break;
        }
      }

      if (x > 0) {
        const neighbor = neutralizeRoad(tileAt(map, x - 1, y));
        if (
          neighbor === VRAILROAD ||
          neighbor === HBRIDGE ||
          (neighbor >= ROADS && neighbor <= INTERSECTION)
        ) {
          setTile(context, map, x, y, HBRIDGE | BULLBIT);
          break;
        }
      }

      if (y < WORLD_Y - 1) {
        const neighbor = neutralizeRoad(tileAt(map, x, y + 1));
        if (
          neighbor === HRAILROAD ||
          neighbor === VROADPOWER ||
          (neighbor >= VBRIDGE && neighbor <= INTERSECTION)
        ) {
          setTile(context, map, x, y, VBRIDGE | BULLBIT);
          break;
        }
      }

      if (y > 0) {
        const neighbor = neutralizeRoad(tileAt(map, x, y - 1));
        if (
          neighbor === HRAILROAD ||
          neighbor === VROADPOWER ||
          (neighbor >= VBRIDGE && neighbor <= INTERSECTION)
        ) {
          setTile(context, map, x, y, VBRIDGE | BULLBIT);
          break;
        }
      }

      return 0;
    }
    case LHPOWER:
      setTile(context, map, x, y, VROADPOWER | CONDBIT | BURNBIT | BULLBIT);
      break;
    case LVPOWER:
      setTile(context, map, x, y, HROADPOWER | CONDBIT | BURNBIT | BULLBIT);
      break;
    case LHRAIL:
      setTile(context, map, x, y, HRAILROAD | BURNBIT | BULLBIT);
      break;
    case LVRAIL:
      setTile(context, map, x, y, VRAILROAD | BURNBIT | BULLBIT);
      break;
    default:
      return 0;
  }

  spend(context, cost);
  return 1;
}

function layRail(context: ToolContext, map: Uint16Array, x: number, y: number): number {
  if (context.funds < 20) {
    return -2;
  }

  const index = indexFor(x, y);
  let tile = getOrThrow(map[index]) & LOMASK;
  let cost = 20;

  tile = neutralizeRoad(tile);

  switch (tile) {
    case 0:
      setTile(context, map, x, y, LHRAIL | BULLBIT | BURNBIT);
      break;
    case RIVER:
    case REDGE:
    case CHANNEL: {
      if (context.funds < 100) {
        return -2;
      }
      cost = 100;

      if (x < WORLD_X - 1) {
        const neighbor = neutralizeRoad(tileAt(map, x + 1, y));
        if (
          neighbor === RAILHPOWERV ||
          neighbor === HRAIL ||
          (neighbor >= LHRAIL && neighbor <= HRAILROAD)
        ) {
          setTile(context, map, x, y, HRAIL | BULLBIT);
          break;
        }
      }

      if (x > 0) {
        const neighbor = neutralizeRoad(tileAt(map, x - 1, y));
        if (
          neighbor === RAILHPOWERV ||
          neighbor === HRAIL ||
          (neighbor > HRAIL && neighbor < VRAILROAD)
        ) {
          setTile(context, map, x, y, HRAIL | BULLBIT);
          break;
        }
      }

      if (y < WORLD_Y - 1) {
        const neighbor = neutralizeRoad(tileAt(map, x, y + 1));
        if (
          neighbor === RAILVPOWERH ||
          neighbor === VRAILROAD ||
          (neighbor > HRAIL && neighbor < HRAILROAD)
        ) {
          setTile(context, map, x, y, VRAIL | BULLBIT);
          break;
        }
      }

      if (y > 0) {
        const neighbor = neutralizeRoad(tileAt(map, x, y - 1));
        if (
          neighbor === RAILVPOWERH ||
          neighbor === VRAILROAD ||
          (neighbor > HRAIL && neighbor < HRAILROAD)
        ) {
          setTile(context, map, x, y, VRAIL | BULLBIT);
          break;
        }
      }

      return 0;
    }
    case LHPOWER:
      setTile(context, map, x, y, RAILVPOWERH | CONDBIT | BURNBIT | BULLBIT);
      break;
    case LVPOWER:
      setTile(context, map, x, y, RAILHPOWERV | CONDBIT | BURNBIT | BULLBIT);
      break;
    case ROADS:
      setTile(context, map, x, y, VRAILROAD | BURNBIT | BULLBIT);
      break;
    case ROADS + 1:
      setTile(context, map, x, y, HRAILROAD | BURNBIT | BULLBIT);
      break;
    default:
      return 0;
  }

  spend(context, cost);
  return 1;
}

function layWire(context: ToolContext, map: Uint16Array, x: number, y: number): number {
  if (context.funds < 5) {
    return -2;
  }

  const index = indexFor(x, y);
  let tile = getOrThrow(map[index]) & LOMASK;
  let cost = 5;

  tile = neutralizeRoad(tile);

  switch (tile) {
    case 0:
      setTile(context, map, x, y, LHPOWER | CONDBIT | BURNBIT | BULLBIT);
      break;
    case RIVER:
    case REDGE:
    case CHANNEL: {
      if (context.funds < 25) {
        return -2;
      }
      cost = 25;

      if (x < WORLD_X - 1) {
        const neighbor = tileAt(map, x + 1, y);
        if (neighbor & CONDBIT) {
          const normalized = neutralizeRoad(neighbor);
          if (normalized !== HROADPOWER && normalized !== RAILHPOWERV && normalized !== HPOWER) {
            setTile(context, map, x, y, VPOWER | CONDBIT | BULLBIT);
            break;
          }
        }
      }

      if (x > 0) {
        const neighbor = tileAt(map, x - 1, y);
        if (neighbor & CONDBIT) {
          const normalized = neutralizeRoad(neighbor);
          if (normalized !== HROADPOWER && normalized !== RAILHPOWERV && normalized !== HPOWER) {
            setTile(context, map, x, y, VPOWER | CONDBIT | BULLBIT);
            break;
          }
        }
      }

      if (y < WORLD_Y - 1) {
        const neighbor = tileAt(map, x, y + 1);
        if (neighbor & CONDBIT) {
          const normalized = neutralizeRoad(neighbor);
          if (normalized !== VROADPOWER && normalized !== RAILVPOWERH && normalized !== VPOWER) {
            setTile(context, map, x, y, HPOWER | CONDBIT | BULLBIT);
            break;
          }
        }
      }

      if (y > 0) {
        const neighbor = tileAt(map, x, y - 1);
        if (neighbor & CONDBIT) {
          const normalized = neutralizeRoad(neighbor);
          if (normalized !== VROADPOWER && normalized !== RAILVPOWERH && normalized !== VPOWER) {
            setTile(context, map, x, y, HPOWER | CONDBIT | BULLBIT);
            break;
          }
        }
      }

      return 0;
    }
    case ROADS:
      setTile(context, map, x, y, HROADPOWER | CONDBIT | BURNBIT | BULLBIT);
      break;
    case ROADS + 1:
      setTile(context, map, x, y, VROADPOWER | CONDBIT | BURNBIT | BULLBIT);
      break;
    case LHRAIL:
      setTile(context, map, x, y, RAILHPOWERV | CONDBIT | BURNBIT | BULLBIT);
      break;
    case LVRAIL:
      setTile(context, map, x, y, RAILVPOWERH | CONDBIT | BURNBIT | BULLBIT);
      break;
    default:
      return 0;
  }

  spend(context, cost);
  return 1;
}

function fixZone(context: ToolContext, map: Uint16Array, x: number, y: number): void {
  fixSingle(context, map, x, y);
  if (y > 0) {
    fixSingle(context, map, x, y - 1);
  }
  if (x < WORLD_X - 1) {
    fixSingle(context, map, x + 1, y);
  }
  if (y < WORLD_Y - 1) {
    fixSingle(context, map, x, y + 1);
  }
  if (x > 0) {
    fixSingle(context, map, x - 1, y);
  }
}

function fixSingle(context: ToolContext, map: Uint16Array, x: number, y: number): void {
  const index = indexFor(x, y);
  let tile = getOrThrow(map[index]) & LOMASK;
  let adj = 0;

  tile = neutralizeRoad(tile);

  if (tile >= ROADS && tile <= INTERSECTION) {
    if (y > 0) {
      const neighbor = neutralizeRoad(tileAt(map, x, y - 1));
      if (
        (neighbor === HRAILROAD || (neighbor >= ROADBASE && neighbor <= VROADPOWER)) &&
        neighbor !== HROADPOWER &&
        neighbor !== VRAILROAD &&
        neighbor !== HBRIDGE
      ) {
        adj |= 0x0001;
      }
    }

    if (x < WORLD_X - 1) {
      const neighbor = neutralizeRoad(tileAt(map, x + 1, y));
      if (
        (neighbor === VRAILROAD || (neighbor >= ROADBASE && neighbor <= VROADPOWER)) &&
        neighbor !== VROADPOWER &&
        neighbor !== HRAILROAD &&
        neighbor !== VBRIDGE
      ) {
        adj |= 0x0002;
      }
    }

    if (y < WORLD_Y - 1) {
      const neighbor = neutralizeRoad(tileAt(map, x, y + 1));
      if (
        (neighbor === HRAILROAD || (neighbor >= ROADBASE && neighbor <= VROADPOWER)) &&
        neighbor !== HROADPOWER &&
        neighbor !== VRAILROAD &&
        neighbor !== HBRIDGE
      ) {
        adj |= 0x0004;
      }
    }

    if (x > 0) {
      const neighbor = neutralizeRoad(tileAt(map, x - 1, y));
      if (
        (neighbor === VRAILROAD || (neighbor >= ROADBASE && neighbor <= VROADPOWER)) &&
        neighbor !== VROADPOWER &&
        neighbor !== HRAILROAD &&
        neighbor !== VBRIDGE
      ) {
        adj |= 0x0008;
      }
    }

    const roadTile = getOrThrow(ROAD_TABLE[adj]);
    setTile(context, map, x, y, roadTile | BULLBIT | BURNBIT);
    return;
  }

  if (tile >= LHRAIL && tile <= 236) {
    if (y > 0) {
      const neighbor = neutralizeRoad(tileAt(map, x, y - 1));
      if (
        neighbor >= RAILHPOWERV &&
        neighbor <= VRAILROAD &&
        neighbor !== RAILHPOWERV &&
        neighbor !== HRAILROAD &&
        neighbor !== HRAIL
      ) {
        adj |= 0x0001;
      }
    }

    if (x < WORLD_X - 1) {
      const neighbor = neutralizeRoad(tileAt(map, x + 1, y));
      if (
        neighbor >= RAILHPOWERV &&
        neighbor <= VRAILROAD &&
        neighbor !== RAILVPOWERH &&
        neighbor !== VRAILROAD &&
        neighbor !== VRAIL
      ) {
        adj |= 0x0002;
      }
    }

    if (y < WORLD_Y - 1) {
      const neighbor = neutralizeRoad(tileAt(map, x, y + 1));
      if (
        neighbor >= RAILHPOWERV &&
        neighbor <= VRAILROAD &&
        neighbor !== RAILHPOWERV &&
        neighbor !== HRAILROAD &&
        neighbor !== HRAIL
      ) {
        adj |= 0x0004;
      }
    }

    if (x > 0) {
      const neighbor = neutralizeRoad(tileAt(map, x - 1, y));
      if (
        neighbor >= RAILHPOWERV &&
        neighbor <= VRAILROAD &&
        neighbor !== RAILVPOWERH &&
        neighbor !== VRAILROAD &&
        neighbor !== VRAIL
      ) {
        adj |= 0x0008;
      }
    }

    const railTile = getOrThrow(RAIL_TABLE[adj]);
    setTile(context, map, x, y, railTile | BULLBIT | BURNBIT);
    return;
  }

  if (tile >= LHPOWER && tile <= 220) {
    if (y > 0) {
      const neighbor = tileAt(map, x, y - 1);
      if (neighbor & CONDBIT) {
        const normalized = neutralizeRoad(neighbor);
        if (normalized !== VPOWER && normalized !== VROADPOWER && normalized !== RAILVPOWERH) {
          adj |= 0x0001;
        }
      }
    }

    if (x < WORLD_X - 1) {
      const neighbor = tileAt(map, x + 1, y);
      if (neighbor & CONDBIT) {
        const normalized = neutralizeRoad(neighbor);
        if (normalized !== HPOWER && normalized !== HROADPOWER && normalized !== RAILHPOWERV) {
          adj |= 0x0002;
        }
      }
    }

    if (y < WORLD_Y - 1) {
      const neighbor = tileAt(map, x, y + 1);
      if (neighbor & CONDBIT) {
        const normalized = neutralizeRoad(neighbor);
        if (normalized !== VPOWER && normalized !== VROADPOWER && normalized !== RAILVPOWERH) {
          adj |= 0x0004;
        }
      }
    }

    if (x > 0) {
      const neighbor = tileAt(map, x - 1, y);
      if (neighbor & CONDBIT) {
        const normalized = neutralizeRoad(neighbor);
        if (normalized !== HPOWER && normalized !== HROADPOWER && normalized !== RAILHPOWERV) {
          adj |= 0x0008;
        }
      }
    }

    const wireTile = getOrThrow(WIRE_TABLE[adj]);
    setTile(context, map, x, y, wireTile | BULLBIT | BURNBIT | CONDBIT);
  }
}

function put3x3Rubble(context: ToolContext, map: Uint16Array, x: number, y: number): void {
  for (let xx = x - 1; xx < x + 2; xx += 1) {
    for (let yy = y - 1; yy < y + 2; yy += 1) {
      if (testBounds(xx, yy)) {
        const tile = tileAt(map, xx, yy) & LOMASK;
        if (tile !== RADTILE && tile !== 0) {
          const value = context.doAnimation ? TINYEXP + context.rng.rand(2) : SOMETINYEXP;
          setTile(context, map, xx, yy, value | ANIMBIT | BULLBIT);
        }
      }
    }
  }
}

function put4x4Rubble(context: ToolContext, map: Uint16Array, x: number, y: number): void {
  for (let xx = x - 1; xx < x + 3; xx += 1) {
    for (let yy = y - 1; yy < y + 3; yy += 1) {
      if (testBounds(xx, yy)) {
        const tile = tileAt(map, xx, yy) & LOMASK;
        if (tile !== RADTILE && tile !== 0) {
          const value = context.doAnimation ? TINYEXP + context.rng.rand(2) : SOMETINYEXP;
          setTile(context, map, xx, yy, value | ANIMBIT | BULLBIT);
        }
      }
    }
  }
}

function put6x6Rubble(context: ToolContext, map: Uint16Array, x: number, y: number): void {
  for (let xx = x - 1; xx < x + 5; xx += 1) {
    for (let yy = y - 1; yy < y + 5; yy += 1) {
      if (testBounds(xx, yy)) {
        const tile = tileAt(map, xx, yy) & LOMASK;
        if (tile !== RADTILE && tile !== 0) {
          const value = context.doAnimation ? TINYEXP + context.rng.rand(2) : SOMETINYEXP;
          setTile(context, map, xx, yy, value | ANIMBIT | BULLBIT);
        }
      }
    }
  }
}

function neutralizeRoad(tile: number): number {
  let value = tile & LOMASK;
  if (value >= ROADBASE && value <= 207) {
    value = (value & 0x000f) + ROADBASE;
  }
  return value;
}

function spend(context: ToolContext, amount: number): void {
  context.funds -= amount;
}

function indexFor(x: number, y: number): number {
  return x * WORLD_Y + y;
}

function tileAt(map: Uint16Array, x: number, y: number): number {
  return getOrThrow(map[indexFor(x, y)]);
}

function testBounds(x: number, y: number): boolean {
  return x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y;
}

function setTile(
  context: ToolContext,
  map: Uint16Array,
  x: number,
  y: number,
  value: number,
): void {
  context.store.write('map', indexFor(x, y), value);
}
