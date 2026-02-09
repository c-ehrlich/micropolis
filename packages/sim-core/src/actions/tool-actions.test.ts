import { describe, expect, it } from 'vitest';

import { getOrThrow } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import {
  applyToolAction,
  applyToolQueue,
  connecTile,
  createToolContext,
  RAIL_TABLE,
  ROAD_TABLE,
  TOOL_COST,
  TOOL_OFFSET,
  TOOL_SIZE,
  TOOL_STATE,
  ToolQueue,
  WIRE_TABLE,
} from './tool-actions.ts';

const {
  AIRPORTBASE,
  COALBASE,
  DIRT,
  FOUNTAIN,
  HBRIDGE,
  HRAIL,
  HRAILROAD,
  HROADPOWER,
  LHPOWER,
  LHRAIL,
  LVRAIL,
  POWERPLANT,
  RAILHPOWERV,
  RAILVPOWERH,
  RESBASE,
  RIVER,
  ROADS,
  SOMETINYEXP,
  TELEBASE,
  VPOWER,
  VRAILROAD,
  VROADPOWER,
  WOODS2,
  RUBBLE,
} = Tile;
const { ANIMBIT, BNCNBIT, BULLBIT, BURNBIT, CONDBIT, ZONEBIT } = TileFlag;
const { LOMASK } = TileMask;
const { WORLD_X, WORLD_Y } = World;

type ToolName = keyof typeof TOOL_STATE;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

const createStore = () => {
  const store = createClassicMapStore();
  store.beginTick();
  return store;
};

const setTile = (
  store: ReturnType<typeof createClassicMapStore>,
  x: number,
  y: number,
  value: number,
) => {
  store.write('map', indexFor(x, y), value);
};

const getTile = (map: Uint16Array, x: number, y: number) => getOrThrow(map[indexFor(x, y)]);

const runTool = (
  context: ReturnType<typeof createToolContext>,
  tool: ToolName,
  x: number,
  y: number,
) => applyToolAction(context, { tool, x, y, simStep: 0, order: 0, tickId: 0, seq: 0 }).code;

describe('w_tool.c metadata parity', () => {
  it('matches CostOf[] values from w_tool.c', () => {
    // Magic-number source: `CostOf[]` in `ref/micropolis/src/sim/w_tool.c`.
    expect(TOOL_COST).toEqual([
      100, 100, 100, 500, 0, 500, 5, 1, 20, 10, 0, 0, 5000, 10, 3000, 3000, 5000, 10000, 100, 0,
    ]);
  });

  it('matches toolSize[] values from w_tool.c', () => {
    // Magic-number source: `toolSize[]` in `ref/micropolis/src/sim/w_tool.c`.
    expect(TOOL_SIZE).toEqual([3, 3, 3, 3, 1, 3, 1, 1, 1, 1, 0, 0, 4, 1, 4, 4, 4, 6, 1, 0]);
  });

  it('matches toolOffset[] values from w_tool.c', () => {
    // Magic-number source: `toolOffset[]` in `ref/micropolis/src/sim/w_tool.c`.
    expect(TOOL_OFFSET).toEqual([1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0]);
  });

  it('keeps stage-4 playable tools mapped to expected w_tool.c state ids', () => {
    // Magic-number source: tool state ordering in `ref/micropolis/src/sim/w_tool.c`
    // (`CostOf[]`, `toolSize[]`, and entrypoint use by `view->tool_state`).
    expect(TOOL_STATE.road).toBe(9);
    expect(TOOL_STATE.rail).toBe(8);
    expect(TOOL_STATE.wire).toBe(6);
    expect(TOOL_STATE.bulldoze).toBe(7);
    expect(TOOL_STATE.res).toBe(0);
    expect(TOOL_STATE.com).toBe(1);
    expect(TOOL_STATE.ind).toBe(2);
  });
});

describe('ToolQueue ordering', () => {
  it('orders by simStep then order', () => {
    const store = createStore();

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
    const tile = getTile(map, 10, 10) & LOMASK;

    expect(tile).toBe(ROADS);
  });

  it('keeps stable ordering by seq within the same step and order', () => {
    const store = createStore();

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
    const tile = getTile(map, 12, 12) & LOMASK;

    expect(tile).toBe(DIRT);
  });
});

describe('Connectivity tables', () => {
  const centerX = 10;
  const centerY = 10;

  const applyAdjacency = (neighborValue: number, table: readonly number[]) => {
    for (let mask = 0; mask < 16; mask += 1) {
      const store = createStore();

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

      const actual = getTile(map, centerX, centerY) & LOMASK;
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

describe('Tool costs and bounds', () => {
  it('returns no-funds for costly tools and leaves tiles unchanged', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 0,
    });

    const map = store.getLayer('map') as Uint16Array;

    expect(runTool(context, 'road', 5, 5)).toBe(-2);
    expect(runTool(context, 'rail', 6, 5)).toBe(-2);
    expect(runTool(context, 'wire', 7, 5)).toBe(-2);
    expect(runTool(context, 'park', 8, 5)).toBe(-2);
    expect(runTool(context, 'res', 10, 10)).toBe(-2);

    expect(getTile(map, 5, 5) & LOMASK).toBe(DIRT);
    expect(context.funds).toBe(0);
  });

  it('returns out-of-bounds for invalid coordinates', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 1000,
    });

    expect(runTool(context, 'road', -1, 0)).toBe(-1);
    expect(runTool(context, 'wire', WORLD_X, 0)).toBe(-1);
    expect(runTool(context, 'res', 0, 0)).toBe(-1);
  });

  it('rejects zone placement on occupied tiles without autoBulldoze', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 1000,
      autoBulldoze: false,
    });

    setTile(store, 10, 10, ROADS | BULLBIT | BURNBIT);

    expect(runTool(context, 'res', 10, 10)).toBe(-1);
    expect(context.funds).toBe(1000);
  });

  it('applies autoBulldoze cost for eligible tiles', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 1000,
      autoBulldoze: true,
    });

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        setTile(store, 10 + dx, 10 + dy, RUBBLE | BULLBIT);
      }
    }

    const resCost = getOrThrow(TOOL_COST[TOOL_STATE.res]);
    expect(runTool(context, 'res', 10, 10)).toBe(1);
    expect(context.funds).toBe(1000 - resCost - 9);
  });

  it('rejects autoBulldoze when a tile is ineligible', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 1000,
      autoBulldoze: true,
    });

    setTile(store, 9, 9, ROADS | BULLBIT | BURNBIT);

    expect(runTool(context, 'res', 10, 10)).toBe(-1);
    expect(context.funds).toBe(1000);
  });
});

describe('Zone placement', () => {
  it('lays out 3x3 zones with a centered ZONEBIT', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 1000,
    });

    expect(runTool(context, 'res', 10, 10)).toBe(1);

    const map = store.getLayer('map') as Uint16Array;
    expect(getTile(map, 9, 9)).toBe(RESBASE + BNCNBIT);
    expect(getTile(map, 10, 9)).toBe(RESBASE + 1 + BNCNBIT);
    expect(getTile(map, 11, 11)).toBe(RESBASE + 8 + BNCNBIT);
    expect(getTile(map, 10, 10)).toBe(RESBASE + 4 + BNCNBIT + ZONEBIT);
  });

  it('lays out 4x4 zones with an animation bit when requested', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 10000,
    });

    expect(runTool(context, 'coal', 20, 20)).toBe(1);

    const map = store.getLayer('map') as Uint16Array;
    expect(getTile(map, 20, 20)).toBe(COALBASE + 5 + BNCNBIT + ZONEBIT);
    expect(getTile(map, 20, 21)).toBe(COALBASE + 9 + BNCNBIT + ANIMBIT);
  });

  it('lays out 6x6 zones for airports', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 20000,
    });

    expect(runTool(context, 'airport', 30, 30)).toBe(1);

    const map = store.getLayer('map') as Uint16Array;
    expect(getTile(map, 30, 30)).toBe(AIRPORTBASE + 7 + BNCNBIT + ZONEBIT);
    expect(getTile(map, 29, 29)).toBe(AIRPORTBASE + BNCNBIT);
  });

  it('updates border connectivity around placed zones', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 1000,
    });

    setTile(store, 10, 8, ROADS | BULLBIT | BURNBIT);
    setTile(store, 10, 7, ROADS | BULLBIT | BURNBIT);

    expect(runTool(context, 'res', 10, 10)).toBe(1);

    const map = store.getLayer('map') as Uint16Array;
    expect(getTile(map, 10, 8) & LOMASK).toBe(ROAD_TABLE[1]);
  });
});

describe('Bulldozer tool', () => {
  it('creates rubble for zone centers', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 100,
      doAnimation: false,
    });

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        setTile(store, 10 + dx, 10 + dy, RESBASE + BNCNBIT);
      }
    }
    setTile(store, 10, 10, RESBASE + BNCNBIT + ZONEBIT);

    expect(runTool(context, 'bulldoze', 10, 10)).toBe(1);
    expect(context.funds).toBe(99);

    const map = store.getLayer('map') as Uint16Array;
    expect(getTile(map, 10, 10)).toBe(SOMETINYEXP | ANIMBIT | BULLBIT);
  });

  it('handles big-zone offsets when bulldozing', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 100,
      doAnimation: false,
    });

    setTile(store, 15, 15, POWERPLANT + 1);
    setTile(store, 14, 15, RESBASE + BNCNBIT);

    expect(runTool(context, 'bulldoze', 15, 15)).toBe(1);

    const map = store.getLayer('map') as Uint16Array;
    expect(getTile(map, 14, 15)).toBe(SOMETINYEXP | ANIMBIT | BULLBIT);
  });

  it('charges extra for dozing water tiles when they change', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 10,
    });

    setTile(store, 5, 5, RIVER | BULLBIT);

    expect(runTool(context, 'bulldoze', 5, 5)).toBe(1);
    expect(context.funds).toBe(4);

    const map = store.getLayer('map') as Uint16Array;
    expect(getTile(map, 5, 5) & LOMASK).toBe(DIRT);
  });

  it('rejects non-bulldozable tiles', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 10,
    });

    expect(runTool(context, 'bulldoze', 3, 3)).toBe(0);
  });
});

describe('Road, rail, and wire tools', () => {
  it('lays roads on dirt and spends 10', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 20,
    });

    expect(runTool(context, 'road', 6, 6)).toBe(1);
    expect(context.funds).toBe(10);

    const map = store.getLayer('map') as Uint16Array;
    const tile = getTile(map, 6, 6);
    expect(tile & LOMASK).toBe(ROADS);
    expect(tile & (BULLBIT | BURNBIT)).toBe(BULLBIT | BURNBIT);
  });

  it('lays roads over power and rail crossings', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 50,
    });

    setTile(store, 8, 8, LHPOWER | CONDBIT);
    setTile(store, 9, 8, LHRAIL | BULLBIT | BURNBIT);

    expect(runTool(context, 'road', 8, 8)).toBe(1);
    expect(runTool(context, 'road', 9, 8)).toBe(1);

    const map = store.getLayer('map') as Uint16Array;
    expect(getTile(map, 8, 8) & LOMASK).toBe(VROADPOWER);
    expect(getTile(map, 9, 8) & LOMASK).toBe(HRAILROAD);
  });

  it('builds bridges on water when connected', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 100,
    });

    setTile(store, 11, 10, ROADS | BULLBIT | BURNBIT);
    setTile(store, 10, 10, RIVER);

    expect(runTool(context, 'road', 10, 10)).toBe(1);

    const map = store.getLayer('map') as Uint16Array;
    expect(getTile(map, 10, 10) & LOMASK).toBe(HBRIDGE);
    expect(context.funds).toBe(50);
  });

  it('lays rails on dirt', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 200,
    });

    expect(runTool(context, 'rail', 6, 9)).toBe(1);

    const map = store.getLayer('map') as Uint16Array;
    expect(getTile(map, 6, 9) & LOMASK).toBe(LHRAIL);
  });

  it('lays rails over power and road crossings', () => {
    const makeCase = (initial: number, expected: number) => {
      const store = createStore();
      const context = createToolContext({
        store,
        rng: new MicropolisRng(1),
        funds: 200,
      });

      setTile(store, 7, 9, initial);
      expect(runTool(context, 'rail', 7, 9)).toBe(1);

      const map = store.getLayer('map') as Uint16Array;
      expect(getTile(map, 7, 9) & LOMASK).toBe(expected);
    };

    makeCase(LHPOWER | CONDBIT, RAILVPOWERH);
    makeCase(ROADS | BULLBIT | BURNBIT, VRAILROAD);
    makeCase((ROADS + 1) | BULLBIT | BURNBIT, HRAILROAD);
  });

  it('builds rail tunnels on water when connected', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 200,
    });

    setTile(store, 12, 12, RIVER);
    setTile(store, 13, 12, LHRAIL | BULLBIT | BURNBIT);

    expect(runTool(context, 'rail', 12, 12)).toBe(1);

    const map = store.getLayer('map') as Uint16Array;
    expect(getTile(map, 12, 12) & LOMASK).toBe(HRAIL);
    expect(context.funds).toBe(100);
  });

  it('lays wires on dirt and crossings', () => {
    const makeCase = (initial: number | null, expected: number) => {
      const store = createStore();
      const context = createToolContext({
        store,
        rng: new MicropolisRng(1),
        funds: 100,
      });

      if (initial !== null) {
        setTile(store, 7, 12, initial);
      }

      expect(runTool(context, 'wire', 7, 12)).toBe(1);

      const map = store.getLayer('map') as Uint16Array;
      expect(getTile(map, 7, 12) & LOMASK).toBe(expected);
    };

    makeCase(null, LHPOWER);
    makeCase(ROADS | BULLBIT | BURNBIT, HROADPOWER);
    makeCase((ROADS + 1) | BULLBIT | BURNBIT, VROADPOWER);
    makeCase(LHRAIL | BULLBIT | BURNBIT, RAILHPOWERV);
    makeCase(LVRAIL | BULLBIT | BURNBIT, RAILVPOWERH);
  });

  it('builds underwater wire when connected', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 100,
    });

    setTile(store, 14, 14, RIVER);
    setTile(store, 15, 14, LHPOWER | CONDBIT | BULLBIT | BURNBIT);

    expect(runTool(context, 'wire', 14, 14)).toBe(1);

    const map = store.getLayer('map') as Uint16Array;
    expect(getTile(map, 14, 14) & LOMASK).toBe(VPOWER);
    expect(context.funds).toBe(75);
  });

  it('rejects invalid road placements', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 100,
    });

    setTile(store, 5, 20, RESBASE + BNCNBIT);

    expect(runTool(context, 'road', 5, 20)).toBe(0);
  });
});

describe('Network tool', () => {
  it('auto-bulldozes eligible tiles and lays network wire', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: new MicropolisRng(1),
      funds: 200,
    });

    setTile(store, 18, 18, RUBBLE | BULLBIT);

    const networkCost = getOrThrow(TOOL_COST[TOOL_STATE.network]);
    expect(runTool(context, 'network', 18, 18)).toBe(1);
    expect(context.funds).toBe(200 - 1 - networkCost);

    const map = store.getLayer('map') as Uint16Array;
    const tile = getTile(map, 18, 18);
    expect(tile & LOMASK).toBe(TELEBASE);
    expect(tile & (CONDBIT | BURNBIT | BULLBIT | ANIMBIT)).toBe(
      CONDBIT | BURNBIT | BULLBIT | ANIMBIT,
    );
  });
});

describe('Park tool', () => {
  const fixedRng = (value: number) => ({ rand: () => value }) as unknown as MicropolisRng;

  it('places fountains when RNG returns 4', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: fixedRng(4),
      funds: 20,
    });

    const parkCost = getOrThrow(TOOL_COST[TOOL_STATE.park]);
    expect(runTool(context, 'park', 5, 25)).toBe(1);
    expect(context.funds).toBe(20 - parkCost);

    const map = store.getLayer('map') as Uint16Array;
    const tile = getTile(map, 5, 25);
    expect(tile & LOMASK).toBe(FOUNTAIN);
    expect(tile & (BURNBIT | BULLBIT | ANIMBIT)).toBe(BURNBIT | BULLBIT | ANIMBIT);
  });

  it('places woods when RNG returns 0..3', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: fixedRng(0),
      funds: 20,
    });

    expect(runTool(context, 'park', 6, 25)).toBe(1);

    const map = store.getLayer('map') as Uint16Array;
    const tile = getTile(map, 6, 25);
    expect(tile & LOMASK).toBe(WOODS2);
    expect(tile & (BURNBIT | BULLBIT)).toBe(BURNBIT | BULLBIT);
  });

  it('rejects park placement on occupied tiles', () => {
    const store = createStore();
    const context = createToolContext({
      store,
      rng: fixedRng(0),
      funds: 20,
    });

    setTile(store, 7, 25, ROADS | BULLBIT | BURNBIT);

    expect(runTool(context, 'park', 7, 25)).toBe(-1);
    expect(context.funds).toBe(20);
  });
});

describe('Determinism', () => {
  it('produces identical maps for the same action log and seed', () => {
    const runActions = () => {
      const store = createStore();
      const context = createToolContext({
        store,
        rng: new MicropolisRng(123),
        funds: 1000,
        doAnimation: true,
      });

      const queue = new ToolQueue();
      queue.enqueue({ tool: 'park', x: 40, y: 40, simStep: 0, order: 0, tickId: 0 });
      queue.enqueue({ tool: 'road', x: 41, y: 40, simStep: 0, order: 1, tickId: 0 });
      queue.enqueue({ tool: 'wire', x: 42, y: 40, simStep: 0, order: 2, tickId: 0 });
      applyToolQueue(context, queue);

      return Array.from(store.getLayer('map') as Uint16Array);
    };

    expect(runActions()).toEqual(runActions());
  });
});
