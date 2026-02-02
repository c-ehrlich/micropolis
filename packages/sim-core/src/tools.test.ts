import { describe, expect, it } from 'vitest';

import { getOrThrow } from './assert.ts';
import { Tile, TileFlag, TileMask, World } from './constants.ts';
import { createClassicMapStore } from './map-store.ts';
import { MicropolisRng } from './rng.ts';
import {
  applyToolQueue,
  connecTile,
  createToolContext,
  RAIL_TABLE,
  ROAD_TABLE,
  ToolQueue,
  WIRE_TABLE,
} from './tools.ts';

const { DIRT, LHPOWER, LHRAIL, ROADS } = Tile;
const { CONDBIT } = TileFlag;
const { LOMASK } = TileMask;
const { WORLD_Y } = World;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

const setTile = (
  store: ReturnType<typeof createClassicMapStore>,
  x: number,
  y: number,
  value: number,
) => {
  store.write('map', indexFor(x, y), value);
};

describe('ToolQueue ordering', () => {
  it('orders by simStep then order', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 1000,
    });

    const queue = new ToolQueue();
    queue.enqueue({ tool: 'road', x: 10, y: 10, simStep: 0, order: 1, tickId: 0 });
    queue.enqueue({ tool: 'bulldoze', x: 10, y: 10, simStep: 0, order: 0, tickId: 0 });

    applyToolQueue(context, queue);

    const map = store.getLayer('map') as Uint16Array;
    const tile = getOrThrow(map[indexFor(10, 10)]) & LOMASK;

    expect(tile).toBe(ROADS);
  });

  it('keeps stable ordering by seq within the same step and order', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 1000,
    });

    const queue = new ToolQueue();
    queue.enqueue({ tool: 'road', x: 12, y: 12, simStep: 0, order: 0, tickId: 0 });
    queue.enqueue({ tool: 'bulldoze', x: 12, y: 12, simStep: 0, order: 0, tickId: 0 });

    applyToolQueue(context, queue);

    const map = store.getLayer('map') as Uint16Array;
    const tile = getOrThrow(map[indexFor(12, 12)]) & LOMASK;

    expect(tile).toBe(DIRT);
  });
});

describe('Connectivity tables', () => {
  const centerX = 10;
  const centerY = 10;

  const applyAdjacency = (neighborValue: number, table: readonly number[]) => {
    for (let mask = 0; mask < 16; mask += 1) {
      const store = createClassicMapStore();
      store.beginTick();

      const context = createToolContext({
        store,
        rng: new MicropolisRng(1),
        funds: 0,
      });

      const map = store.getLayer('map') as Uint16Array;
      setTile(store, centerX, centerY, neighborValue);

      if (mask & 0x1) {
        setTile(store, centerX, centerY - 1, neighborValue);
      }
      if (mask & 0x2) {
        setTile(store, centerX + 1, centerY, neighborValue);
      }
      if (mask & 0x4) {
        setTile(store, centerX, centerY + 1, neighborValue);
      }
      if (mask & 0x8) {
        setTile(store, centerX - 1, centerY, neighborValue);
      }

      connecTile(context, map, centerX, centerY, 0);

      const actual = getOrThrow(map[indexFor(centerX, centerY)]) & LOMASK;
      expect(actual).toBe(table[mask]);
    }
  };

  it('matches the road adjacency table', () => {
    applyAdjacency(ROADS, ROAD_TABLE);
  });

  it('matches the rail adjacency table', () => {
    applyAdjacency(LHRAIL, RAIL_TABLE);
  });

  it('matches the wire adjacency table', () => {
    const wireNeighbor = LHPOWER | CONDBIT;
    applyAdjacency(wireNeighbor, WIRE_TABLE);
  });
});
