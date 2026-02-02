import { World } from './constants.ts';
import { hashMap, hashScalars, mixHashes } from './hash.ts';
import { createClassicMapStore } from './map-store.ts';
import { MicropolisRng } from './rng.ts';
import {
  applyToolAction,
  createToolContext,
  sortToolActions,
  type ToolAction,
  type ToolName,
} from './tools.ts';

export const REPLAY_VERSION = 1;

export interface ReplayMapSize {
  width: number;
  height: number;
}

export interface ReplayAction {
  tool: ToolName;
  x: number;
  y: number;
  simStep: number;
  order: number;
  tickId: number;
  seq?: number;
}

export interface ReplayLog {
  version: number;
  seed: number;
  mapSize: ReplayMapSize;
  actions: ReplayAction[];
  ticks: number[];
}

export interface ReplayRunOptions {
  funds?: number;
  autoBulldoze?: boolean;
  players?: number;
  overrideCost?: boolean;
  expensive?: number;
  superUser?: boolean;
}

export interface ReplayRunResult {
  map: Uint16Array;
  mapHash: number;
  scalarsHash: number;
  combinedHash: number;
}

export function createReplayLog(options: {
  seed: number;
  mapSize: ReplayMapSize;
  version?: number;
}): ReplayLog {
  return {
    version: options.version ?? REPLAY_VERSION,
    seed: options.seed,
    mapSize: options.mapSize,
    actions: [],
    ticks: [],
  };
}

export function replayToolLog(log: ReplayLog, options: ReplayRunOptions = {}): ReplayRunResult {
  assertClassicMapSize(log.mapSize);

  const store = createClassicMapStore();
  const rng = new MicropolisRng(log.seed);
  const context = createToolContext({
    store,
    rng,
    funds: options.funds ?? 100000,
    autoBulldoze: options.autoBulldoze ?? false,
    players: options.players ?? 1,
    overrideCost: options.overrideCost ?? false,
    expensive: options.expensive ?? 1000,
    superUser: options.superUser ?? false,
  });

  const actions = stampReplayActions(log.actions);
  const grouped = groupByTickId(actions);
  const tickIds = Array.from(grouped.keys()).sort((a, b) => a - b);

  for (const tickId of tickIds) {
    const batch = grouped.get(tickId);
    if (!batch || batch.length === 0) {
      continue;
    }
    store.beginTick();
    const ordered = sortToolActions(batch);
    for (const action of ordered) {
      applyToolAction(context, action);
    }
    store.commitTick();
  }

  const map = store.snapshot('map') as Uint16Array;
  const mapHash = hashMap(map);
  const scalarsHash = hashScalars([log.seed, actions.length, context.funds]);
  const combinedHash = mixHashes(mapHash, scalarsHash);

  return { map, mapHash, scalarsHash, combinedHash };
}

function assertClassicMapSize(mapSize: ReplayMapSize): void {
  if (mapSize.width !== World.WORLD_X || mapSize.height !== World.WORLD_Y) {
    throw new Error(`unsupported replay map size: ${mapSize.width}x${mapSize.height}`);
  }
}

function stampReplayActions(actions: ReplayAction[]): ToolAction[] {
  return actions.map((action, index) => ({
    tool: action.tool,
    x: action.x,
    y: action.y,
    simStep: action.simStep,
    order: action.order,
    tickId: action.tickId,
    seq: action.seq ?? index,
  }));
}

function groupByTickId(actions: ToolAction[]): Map<number, ToolAction[]> {
  const grouped = new Map<number, ToolAction[]>();
  for (const action of actions) {
    const tickId = Number.isFinite(action.tickId) ? action.tickId : 0;
    const bucket = grouped.get(tickId);
    if (bucket) {
      bucket.push(action);
    } else {
      grouped.set(tickId, [action]);
    }
  }
  return grouped;
}
