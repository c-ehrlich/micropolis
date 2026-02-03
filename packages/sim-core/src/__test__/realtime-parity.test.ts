import { describe, expect, it } from 'vitest';

import { createToolContext } from '../actions/tool-actions.ts';
import { assertDefined } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import type { RealtimeContextOptions, SimSprite } from '../sim/realtime.ts';
import {
  ANI_TILE,
  animateTiles,
  createRealtimeContext,
  destroySprite,
  explodeSprite,
  getSprite,
  makeExplosionAt,
  makeSprite,
  moveObjects,
  runRealtimeTick,
  runRealtimeTicks,
  SPRITE_TYPE,
} from '../sim/realtime.ts';

const { WORLD_X, WORLD_Y, HWLDY, SmY } = World;
const { ANIMBIT, BULLBIT, BURNBIT, ZONEBIT } = TileFlag;
const { LOMASK, ALLBITS } = TileMask;
const {
  BRWH,
  CHANNEL,
  COMBASE,
  FIRE,
  FOUNTAIN,
  LHRAIL,
  LTRFBASE,
  NUCLEAR,
  RADAR0,
  RAILBASE,
  RESBASE,
  RIVER,
  ROADS,
  SMOKEBASE,
  STADIUM,
  TELEBASE,
  TINYEXP,
  LASTTINYEXP,
  WOODS,
} = Tile;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;
const trfIndex = (x: number, y: number) => x * HWLDY + y;
const rateIndex = (x: number, y: number) => x * SmY + y;

const setMapTile = (
  store: ReturnType<typeof createClassicMapStore>,
  x: number,
  y: number,
  value: number,
) => {
  store.write('map', indexFor(x, y), value);
};

const getMapTile = (map: Uint16Array, x: number, y: number) => map[indexFor(x, y)] ?? 0;

const tileId = (value: number) => value & LOMASK;
const flagBits = (value: number) => value & ALLBITS;

const createContext = (
  seed = 1,
  options: Partial<RealtimeContextOptions> & { funds?: number } = {},
) => {
  const store = createClassicMapStore();
  store.beginTick();
  const rng = new MicropolisRng(seed);
  const toolContext = createToolContext({
    store,
    rng,
    funds: options.funds ?? 0,
    doAnimation: options.doAnimation,
  });
  const { funds: _funds, ...rtOptions } = options;
  const context = createRealtimeContext({ store, rng, toolContext, ...rtOptions });
  return { store, rng, toolContext, context };
};

const hashLayer = (layer: Uint16Array) => {
  let hash = 0;
  for (const value of layer) {
    hash = (hash * 31 + value) >>> 0;
  }
  return hash;
};

const findSeed = (predicate: (rng: MicropolisRng) => boolean, max = 100000) => {
  for (let seed = 1; seed <= max; seed += 1) {
    const rng = new MicropolisRng(seed);
    if (predicate(rng)) {
      return seed;
    }
  }
  throw new Error('No seed found for predicate');
};

const trainTileForDir = (x: number, y: number, dir: number) => {
  const cx = [0, 16, 0, -16];
  const cy = [-16, 0, 16, 0];
  return {
    x: (x + 48 + (cx[dir] ?? 0)) >> 4,
    y: (y + (cy[dir] ?? 0)) >> 4,
  };
};

const shipTileForDir = (x: number, y: number, dir: number) => {
  const bdx = [0, 0, 1, 1, 1, 0, -1, -1, -1];
  const bdy = [0, -1, -1, 0, 1, 1, 1, 0, -1];
  return {
    x: ((x + 47) >> 4) + (bdx[dir] ?? 0),
    y: (y >> 4) + (bdy[dir] ?? 0),
  };
};

describe('Realtime context guards', () => {
  it('throws when toolContext is missing', () => {
    const store = createClassicMapStore();
    store.beginTick();
    const rng = new MicropolisRng(1);

    // @ts-expect-error toolContext is required but intentionally omitted for the guard check.
    expect(() => createRealtimeContext({ store, rng })).toThrow('toolContext');
  });
});

describe('Gating flags', () => {
  it('simSpeed 0 prevents movement and cycle advance', () => {
    const { context } = createContext(1, { simSpeed: 0, doAnimation: false });
    const tornado = makeSprite(context, SPRITE_TYPE.TOR, 200, 200);

    const start = { x: tornado.x, y: tornado.y, cycle: context.cycle };
    runRealtimeTick(context);

    expect(context.cycle).toBe(start.cycle);
    expect(tornado.x).toBe(start.x);
    expect(tornado.y).toBe(start.y);
  });

  it('skips tile animation when doAnimation is false', () => {
    const { context, store } = createContext(1, { doAnimation: false });
    const map = store.getLayer('map') as Uint16Array;
    setMapTile(store, 10, 10, FIRE | ANIMBIT);

    runRealtimeTick(context);

    expect(tileId(getMapTile(map, 10, 10))).toBe(FIRE);
  });

  it('disables collision explosions when noDisasters is true', () => {
    const { context, store } = createContext(1, { noDisasters: true });
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const plane = makeSprite(context, SPRITE_TYPE.AIR, 300, 200);
    plane.frame = 3;
    plane.dest_x = plane.x + 200;
    plane.dest_y = plane.y;

    const copter = makeSprite(context, SPRITE_TYPE.COP, 0, 0);
    const planeHotX = plane.x + plane.x_hot;
    const planeHotY = plane.y + plane.y_hot;
    copter.x = planeHotX - copter.x_hot;
    copter.y = planeHotY - copter.y_hot;
    copter.control = 0;
    copter.dest_x = copter.x + 200;
    copter.dest_y = copter.y;

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(plane.frame).toBeGreaterThan(0);
    expect(copter.frame).toBeGreaterThan(0);
    expect(context.sprites.some((sprite) => sprite.type === SPRITE_TYPE.EXP)).toBe(false);
  });
});

describe('Sprite bookkeeping', () => {
  it('reuses the existing global sprite for makeSprite', () => {
    const { context } = createContext();
    const first = makeSprite(context, SPRITE_TYPE.TOR, 120, 120);
    const second = makeSprite(context, SPRITE_TYPE.TOR, 140, 140);

    expect(first).toBe(second);
    expect(context.sprites.length).toBe(1);
  });

  it('getSprite returns null when frame is 0', () => {
    const { context } = createContext();
    const sprite = makeSprite(context, SPRITE_TYPE.TRA, 120, 120);
    sprite.frame = 0;

    expect(getSprite(context, SPRITE_TYPE.TRA)).toBeNull();
  });

  it('destroySprite removes the sprite from global bookkeeping', () => {
    const { context } = createContext();
    const sprite = makeSprite(context, SPRITE_TYPE.COP, 120, 120);

    destroySprite(context, sprite);

    expect(context.globalSprites[SPRITE_TYPE.COP]).toBeNull();
    expect(context.sprites.includes(sprite)).toBe(false);
  });
});

describe('Train sprite behavior', () => {
  it('moves 4px per tick and only turns every 4th cycle with curve frames', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const train = makeSprite(context, SPRITE_TYPE.TRA, 160, 160);
    train.dir = 1;
    train.frame = 1;

    const startX = train.x;
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(train.x - startX).toBe(4);
    expect(train.dir).toBe(1);

    const futureX = train.x + 4;
    const futureY = train.y;
    const turnTile = trainTileForDir(futureX, futureY, 2);
    setMapTile(store, turnTile.x, turnTile.y, LHRAIL);

    context.cycle = 3;
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(train.dir).toBe(2);
    expect(train.frame).toBe(3);
  });

  it('uses frame 5 on straight rail tiles', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const train = makeSprite(context, SPRITE_TYPE.TRA, 200, 160);
    train.dir = 1;
    train.frame = 1;

    const futureX = train.x + 4;
    const futureY = train.y;
    const forwardTile = trainTileForDir(futureX, futureY, 1);
    setMapTile(store, forwardTile.x, forwardTile.y, RAILBASE);

    context.cycle = 3;
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(train.frame).toBe(5);
  });

  it('stops when no valid direction is available', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const train = makeSprite(context, SPRITE_TYPE.TRA, 160, 160);
    train.dir = 1;
    train.frame = 1;

    context.cycle = 3;
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(train.dir).toBe(4);
    expect(train.frame).not.toBe(0);

    context.cycle = 7;
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(train.frame).toBe(0);
  });
});

describe('Copter sprite behavior', () => {
  it('lands when control < 0 and absDist < 30', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const copter = makeSprite(context, SPRITE_TYPE.COP, 200, 200);
    copter.control = -1;
    copter.count = 0;
    copter.orig_x = copter.x + 10;
    copter.orig_y = copter.y + 10;

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(copter.frame).toBe(0);
  });

  it('returns to origin when control >= 0 and destination is close', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const copter = makeSprite(context, SPRITE_TYPE.COP, 220, 220);
    copter.control = 0;
    copter.orig_x = copter.x - 20;
    copter.orig_y = copter.y - 20;
    copter.dest_x = copter.x + 5;
    copter.dest_y = copter.y + 5;

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(copter.control).toBe(-1);
    expect(copter.dest_x).toBe(copter.orig_x);
    expect(copter.dest_y).toBe(copter.orig_y);
  });

  it('only turns every 4 cycles', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const copter = makeSprite(context, SPRITE_TYPE.COP, 240, 200);
    copter.frame = 1;
    copter.control = 0;
    copter.dest_x = copter.x - 200;
    copter.dest_y = copter.y;

    const startFrame = copter.frame;
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(copter.frame).toBe(startFrame);

    context.cycle = 3;
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(copter.frame).not.toBe(startFrame);
  });

  it('emits heavy-traffic report with sound at high density', () => {
    const heavyTrafficSeed = findSeed((rng) => (rng.next16() & 7) === 0);
    const messages: Array<{ id: number; x: number; y: number }> = [];
    const sounds: Array<{ channel: string; id: string }> = [];

    const { context, store, rng } = createContext(heavyTrafficSeed, {
      onMessage: (id, x, y) => messages.push({ id, x, y }),
      onSound: (channel, id) => sounds.push({ channel, id }),
    });
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const copter = makeSprite(context, SPRITE_TYPE.COP, 0, 0);
    copter.control = 0;
    copter.dest_x = copter.x + 400;
    copter.dest_y = copter.y;
    copter.sound_count = 0;
    copter.count = 2;

    const cellX = (copter.x + 48) >> 5;
    const cellY = copter.y >> 5;
    trfDensity[trfIndex(cellX, cellY)] = 200;

    rng.seed(heavyTrafficSeed);
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(messages.some((entry) => entry.id === -41)).toBe(true);
    expect(sounds.some((entry) => entry.id === 'HeavyTraffic')).toBe(true);
  });
});

describe('Airplane sprite behavior', () => {
  it('changes frame every 5 cycles when turning', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const plane = makeSprite(context, SPRITE_TYPE.AIR, 300, 200);
    plane.frame = 1;
    plane.dest_x = plane.x - 200;
    plane.dest_y = plane.y;
    context.absDist = 1000;

    const startFrame = plane.frame;
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(plane.frame).toBe(startFrame);

    context.cycle = 4;
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(plane.frame).not.toBe(startFrame);
  });

  it('decays takeoff frames (>8) on 5-cycle cadence', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const plane = makeSprite(context, SPRITE_TYPE.AIR, 240, 200);
    plane.frame = 11;
    plane.dest_x = plane.x + 200;
    plane.dest_y = plane.y;

    context.cycle = 4;
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(plane.frame).toBe(10);
  });

  it('selects a new destination when absDist < 50', () => {
    const seed = 4242;
    const { context, store, rng } = createContext(seed);
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const plane = makeSprite(context, SPRITE_TYPE.AIR, 220, 200);
    plane.frame = 3;
    plane.dest_x = plane.x + 10;
    plane.dest_y = plane.y + 10;

    const expectedRng = new MicropolisRng(seed);
    const expectedDestX = expectedRng.rand(WORLD_X * 16 + 100) - 50;
    const expectedDestY = expectedRng.rand(WORLD_Y * 16 + 100) - 50;

    context.cycle = 4;
    rng.seed(seed);
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(plane.dest_x).toBe(expectedDestX);
    expect(plane.dest_y).toBe(expectedDestY);
  });

  it('kills the airplane when it exits bounds', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const plane = makeSprite(context, SPRITE_TYPE.AIR, 0, 0);
    plane.frame = 3;
    plane.dest_x = plane.x + 200;
    plane.dest_y = plane.y;

    plane.x = (WORLD_X << 4) - plane.x_hot - 1;
    plane.y = (WORLD_Y << 4) / 2;

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(plane.frame).toBe(0);
  });

  it('collides with copters when disasters are enabled', () => {
    const messages: Array<{ id: number; x: number; y: number }> = [];
    const { context, store } = createContext(1, {
      onMessage: (id, x, y) => messages.push({ id, x, y }),
    });
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const plane = makeSprite(context, SPRITE_TYPE.AIR, 200, 200);
    plane.frame = 3;
    plane.dest_x = plane.x + 200;
    plane.dest_y = plane.y;

    const copter = makeSprite(context, SPRITE_TYPE.COP, 0, 0);
    const planeHotX = plane.x + plane.x_hot;
    const planeHotY = plane.y + plane.y_hot;
    copter.x = planeHotX - copter.x_hot;
    copter.y = planeHotY - copter.y_hot;
    copter.control = 0;
    copter.dest_x = copter.x + 200;
    copter.dest_y = copter.y;

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(plane.frame).toBe(0);
    expect(copter.frame).toBe(0);
    expect(messages.map((entry) => entry.id)).toEqual(expect.arrayContaining([-24, -27]));
    expect(context.sprites.some((sprite) => sprite.type === SPRITE_TYPE.EXP)).toBe(true);
  });
});

describe('Ship sprite behavior', () => {
  it('only moves when count allows and advances direction on cadence', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const ship = makeSprite(context, SPRITE_TYPE.SHI, 240, 240);
    ship.frame = 2;
    ship.new_dir = 2;
    ship.dir = 2;
    ship.count = 1;
    ship.sound_count = 1;

    const target = shipTileForDir(ship.x, ship.y, 1);
    setMapTile(store, target.x, target.y, CHANNEL);

    const startY = ship.y;
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(ship.y).toBe(startY);
    expect(ship.new_dir).toBe(1);

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(ship.y).toBe(startY - 2);
    expect(ship.frame).toBeGreaterThan(0);
  });

  it('explodes and destroys terrain when stranded', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const ship = makeSprite(context, SPRITE_TYPE.SHI, 200, 200);
    ship.frame = 2;
    ship.new_dir = 2;
    ship.dir = 2;
    ship.count = 1;
    ship.sound_count = 1;

    const hitX = (ship.x + 48) >> 4;
    const hitY = ship.y >> 4;
    setMapTile(store, hitX, hitY, ROADS | BURNBIT);

    moveObjects(context, map, trfDensity, rateOGMem);

    const updated = getMapTile(map, hitX, hitY);
    expect(ship.frame).toBe(0);
    expect(tileId(updated)).toBe(TINYEXP);
    expect(flagBits(updated) & (BULLBIT | ANIMBIT)).toBe(BULLBIT | ANIMBIT);
    expect(context.sprites.some((sprite) => sprite.type === SPRITE_TYPE.EXP)).toBe(true);
  });

  it('uses the scenario 2 honk variant', () => {
    const hornSeed = findSeed((rng) => (rng.next16() & 3) === 1 && rng.rand(10) < 5);
    const sounds: Array<{ channel: string; id: string }> = [];

    const { context, store, rng } = createContext(hornSeed, {
      scenarioId: 2,
      onSound: (channel, id) => sounds.push({ channel, id }),
    });
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const ship = makeSprite(context, SPRITE_TYPE.SHI, 200, 200);
    ship.sound_count = 0;
    ship.count = 9;

    rng.seed(hornSeed);
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(sounds.some((entry) => entry.id === 'HonkHonk-Low -speed 80')).toBe(true);
  });
});

describe('Tornado and monster behavior', () => {
  it('cycles tornado frames in a deterministic pattern', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const tornado = makeSprite(context, SPRITE_TYPE.TOR, 200, 200);
    tornado.count = 0;

    const frames: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      moveObjects(context, map, trfDensity, rateOGMem);
      frames.push(tornado.frame);
    }

    expect(frames).toEqual([2, 3, 2]);
  });

  it('moves tornadoes differently with different seeds', () => {
    const seedA = 1;
    let seedB = 2;
    const randA = new MicropolisRng(seedA).rand(5);
    let randB = new MicropolisRng(seedB).rand(5);
    while (randB === randA) {
      seedB += 1;
      randB = new MicropolisRng(seedB).rand(5);
    }

    const runTornado = (seed: number) => {
      const { context, store } = createContext(seed);
      const map = store.getLayer('map') as Uint16Array;
      const trfDensity = store.getLayer('trfDensity') as Uint8Array;
      const rateOGMem = store.getLayer('rateOGMem') as Int16Array;
      const tornado = makeSprite(context, SPRITE_TYPE.TOR, 200, 200);
      tornado.count = 0;
      moveObjects(context, map, trfDensity, rateOGMem);
      return { x: tornado.x, y: tornado.y };
    };

    expect(runTornado(seedA)).not.toEqual(runTornado(seedB));
  });

  it('explodes vehicles on tornado collision', () => {
    const messages: Array<{ id: number; x: number; y: number }> = [];
    const { context, store } = createContext(1, {
      onMessage: (id, x, y) => messages.push({ id, x, y }),
    });
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const tornado = makeSprite(context, SPRITE_TYPE.TOR, 200, 200);
    const train = makeSprite(context, SPRITE_TYPE.TRA, 0, 0);

    const tornadoHotX = tornado.x + tornado.x_hot;
    const tornadoHotY = tornado.y + tornado.y_hot;
    train.x = tornadoHotX - train.x_hot;
    train.y = tornadoHotY - train.y_hot;
    train.dir = 1;

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(train.frame).toBe(0);
    expect(messages.some((entry) => entry.id === -26)).toBe(true);
  });

  it('allows random tornado end-of-life', () => {
    const endSeed = findSeed((rng) => {
      rng.rand(5);
      return rng.rand(500) === 0;
    });
    const { context, store, rng } = createContext(endSeed);
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const tornado = makeSprite(context, SPRITE_TYPE.TOR, 200, 200);
    tornado.count = 10;

    rng.seed(endSeed);
    moveObjects(context, map, trfDensity, rateOGMem);

    expect(tornado.frame).toBe(0);
  });

  it('monster collisions explode vehicles', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const monster = makeSprite(context, SPRITE_TYPE.GOD, 240, 240);
    monster.control = 4;
    monster.count = 0;

    const train = makeSprite(context, SPRITE_TYPE.TRA, 0, 0);
    const monsterHotX = monster.x + monster.x_hot;
    const monsterHotY = monster.y + monster.y_hot;
    train.x = monsterHotX - train.x_hot;
    train.y = monsterHotY - train.y_hot;

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(train.frame).toBe(0);
  });
});

describe('Explosion sprite behavior', () => {
  it('advances frames every other cycle and emits message/sound on frame 1', () => {
    const messages: Array<{ id: number; x: number; y: number }> = [];
    const sounds: Array<{ channel: string; id: string }> = [];
    const { context, store } = createContext(1, {
      onMessage: (id, x, y) => messages.push({ id, x, y }),
      onSound: (channel, id) => sounds.push({ channel, id }),
    });
    const map = store.getLayer('map') as Uint16Array;

    makeExplosionAt(context, 160, 160);
    const explosion = context.sprites.find((sprite) => sprite.type === SPRITE_TYPE.EXP);
    expect(explosion?.frame).toBe(1);

    runRealtimeTick(context);
    expect(explosion?.frame).toBe(1);

    runRealtimeTick(context);
    expect(explosion?.frame).toBe(2);
    expect(messages.some((entry) => entry.id === 32)).toBe(true);
    expect(sounds.some((entry) => entry.id === 'Explosion-High')).toBe(true);

    // Ensure no stray map changes before fire spawn.
    expect(map.some((value) => value !== 0)).toBe(false);
  });

  it('spawns five fires at the expected offsets', () => {
    const { context, store } = createContext(7, { doAnimation: false });
    const map = store.getLayer('map') as Uint16Array;

    makeExplosionAt(context, 20 << 4, 20 << 4);
    const explosion = context.sprites.find((sprite) => sprite.type === SPRITE_TYPE.EXP);
    if (!explosion) {
      throw new Error('Explosion sprite not created');
    }

    const fireCoords = [
      { x: (explosion.x + 40) >> 4, y: (explosion.y + 16) >> 4 },
      { x: (explosion.x + 24) >> 4, y: explosion.y >> 4 },
      { x: (explosion.x + 56) >> 4, y: explosion.y >> 4 },
      { x: (explosion.x + 24) >> 4, y: (explosion.y + 32) >> 4 },
      { x: (explosion.x + 56) >> 4, y: (explosion.y + 32) >> 4 },
    ];

    for (const coord of fireCoords) {
      setMapTile(store, coord.x, coord.y, ROADS | BURNBIT);
    }

    runRealtimeTicks(context, 12);

    for (const coord of fireCoords) {
      const value = getMapTile(map, coord.x, coord.y);
      expect(tileId(value)).toBeGreaterThanOrEqual(FIRE);
      expect(tileId(value)).toBeLessThanOrEqual(FIRE + 3);
      expect(flagBits(value)).toBe(ANIMBIT);
    }
  });

  it('does not start fires on non-burnable or zoned tiles', () => {
    const { context, store } = createContext(9, { doAnimation: false });
    const map = store.getLayer('map') as Uint16Array;

    makeExplosionAt(context, 30 << 4, 30 << 4);
    const explosion = context.sprites.find((sprite) => sprite.type === SPRITE_TYPE.EXP);
    if (!explosion) {
      throw new Error('Explosion sprite not created');
    }

    const burnable = { x: (explosion.x + 40) >> 4, y: (explosion.y + 16) >> 4 };
    const zoned = { x: (explosion.x + 24) >> 4, y: explosion.y >> 4 };
    const blocked = { x: (explosion.x + 56) >> 4, y: explosion.y >> 4 };

    setMapTile(store, burnable.x, burnable.y, ROADS | BURNBIT);
    setMapTile(store, zoned.x, zoned.y, RESBASE | BURNBIT | ZONEBIT);
    setMapTile(store, blocked.x, blocked.y, WOODS);

    runRealtimeTicks(context, 12);

    const burnValue = getMapTile(map, burnable.x, burnable.y);
    expect(tileId(burnValue)).toBeGreaterThanOrEqual(FIRE);
    expect(tileId(burnValue)).toBeLessThanOrEqual(FIRE + 3);
    expect(flagBits(burnValue)).toBe(ANIMBIT);

    expect(getMapTile(map, zoned.x, zoned.y)).toBe(RESBASE | BURNBIT | ZONEBIT);
    expect(getMapTile(map, blocked.x, blocked.y)).toBe(WOODS);
  });
});

describe('Collision messaging', () => {
  it('uses the correct crash message IDs per vehicle type', () => {
    const cases = [
      { type: SPRITE_TYPE.AIR, message: -24 },
      { type: SPRITE_TYPE.SHI, message: -25 },
      { type: SPRITE_TYPE.TRA, message: -26 },
      { type: SPRITE_TYPE.COP, message: -27 },
      { type: SPRITE_TYPE.BUS, message: -26 },
    ];

    for (const { type, message } of cases) {
      const messages: Array<{ id: number; x: number; y: number }> = [];
      const { context } = createContext(1, {
        onMessage: (id, x, y) => messages.push({ id, x, y }),
      });
      const sprite = makeSprite(context, type, 160, 160);
      const expectedX = (sprite.x + sprite.x_hot) >> 4;
      const expectedY = (sprite.y + sprite.y_hot) >> 4;

      explodeSprite(context, sprite);

      expect(sprite.frame).toBe(0);
      expect(context.crashX).toBe(expectedX);
      expect(context.crashY).toBe(expectedY);
      expect(messages.some((entry) => entry.id === message)).toBe(true);
    }
  });
});

describe('Map mutation helpers', () => {
  it('converts roads to river when BURNBIT is not set', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const targetX = 20;
    const targetY = 20;
    setMapTile(store, targetX, targetY, ROADS);

    const monster = makeSprite(context, SPRITE_TYPE.GOD, (targetX << 4) - 48, (targetY << 4) - 16);
    monster.control = 4;
    monster.count = 0;

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(tileId(getMapTile(map, targetX, targetY))).toBe(RIVER);
  });

  it('leaves non-burnable, non-road tiles intact', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const targetX = 22;
    const targetY = 22;
    setMapTile(store, targetX, targetY, WOODS);

    const monster = makeSprite(context, SPRITE_TYPE.GOD, (targetX << 4) - 48, (targetY << 4) - 16);
    monster.control = 4;
    monster.count = 0;

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(getMapTile(map, targetX, targetY)).toBe(WOODS);
  });

  it('creates rubble when burning non-wet tiles are destroyed', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const targetX = 24;
    const targetY = 24;
    setMapTile(store, targetX, targetY, ROADS | BURNBIT);

    const monster = makeSprite(context, SPRITE_TYPE.GOD, (targetX << 4) - 48, (targetY << 4) - 16);
    monster.control = 4;
    monster.count = 0;

    moveObjects(context, map, trfDensity, rateOGMem);

    const updated = getMapTile(map, targetX, targetY);
    expect(tileId(updated)).toBe(TINYEXP);
    expect(flagBits(updated) & (BULLBIT | ANIMBIT)).toBe(BULLBIT | ANIMBIT);
  });

  it('uses the non-animated rubble base when doAnimation is false', () => {
    const { context, store } = createContext(1, { doAnimation: false });
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const targetX = 26;
    const targetY = 26;
    setMapTile(store, targetX, targetY, ROADS | BURNBIT);

    const monster = makeSprite(context, SPRITE_TYPE.GOD, (targetX << 4) - 48, (targetY << 4) - 16);
    monster.control = 4;
    monster.count = 0;

    moveObjects(context, map, trfDensity, rateOGMem);

    const updated = getMapTile(map, targetX, targetY);
    expect(tileId(updated)).toBe(LASTTINYEXP - 3);
    expect(flagBits(updated) & (BULLBIT | ANIMBIT)).toBe(BULLBIT | ANIMBIT);
  });

  it('converts wet tiles to river when destroyed', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const targetX = 28;
    const targetY = 28;
    setMapTile(store, targetX, targetY, BRWH | BURNBIT);

    const monster = makeSprite(context, SPRITE_TYPE.GOD, (targetX << 4) - 48, (targetY << 4) - 16);
    monster.control = 4;
    monster.count = 0;

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(tileId(getMapTile(map, targetX, targetY))).toBe(RIVER);
  });

  it('ofireZone tags BULLBIT and decrements rateOGMem around zones', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const targetX = 30;
    const targetY = 30;
    setMapTile(store, targetX, targetY, RESBASE | BURNBIT | ZONEBIT);

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        setMapTile(store, targetX + dx, targetY + dy, ROADS | BURNBIT);
      }
    }

    const monster = makeSprite(context, SPRITE_TYPE.GOD, (targetX << 4) - 48, (targetY << 4) - 16);
    monster.control = 4;
    monster.count = 0;

    moveObjects(context, map, trfDensity, rateOGMem);

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const value = getMapTile(map, targetX + dx, targetY + dy);
        expect(value & BULLBIT).toBe(BULLBIT);
      }
    }

    const idx = rateIndex(targetX >> 3, targetY >> 3);
    expect(rateOGMem[idx]).toBe(-20);
  });

  it('spawns an explosion when destroying large zones', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const targetX = 32;
    const targetY = 32;
    setMapTile(store, targetX, targetY, COMBASE | BURNBIT | ZONEBIT);

    const monster = makeSprite(context, SPRITE_TYPE.GOD, (targetX << 4) - 48, (targetY << 4) - 16);
    monster.control = 4;
    monster.count = 0;

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(context.sprites.some((sprite) => sprite.type === SPRITE_TYPE.EXP)).toBe(true);
  });
});

describe('Bus tool coupling', () => {
  it('bulldozes only when speed is 8 and canDriveOn returns 0', () => {
    const { context, store, toolContext } = createContext(1, { funds: 10 });
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const bus = makeSprite(context, SPRITE_TYPE.BUS, 104, 172);
    bus.dir = 1;
    bus.speed = 100;

    const dxTable = [0, 1, 0, -1, 0];
    const dyTable = [-1, 0, 1, 0, 0];
    const ahead = 8;

    const dx = dxTable[bus.dir];
    const dy = dyTable[bus.dir];
    assertDefined(dx);
    assertDefined(dy);
    const otx = (bus.x + bus.x_hot + dx * ahead) >> 4;
    const oty = (bus.y + bus.y_hot + dy * ahead) >> 4;
    const tx = (bus.x + bus.x_hot + 8 + dx * ahead) >> 4;
    const ty = (bus.y + bus.y_hot + dy * ahead) >> 4;

    expect(tx).not.toBe(otx);
    expect(ty).toBe(oty);

    setMapTile(store, tx, ty, RIVER | BULLBIT);

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(tileId(getMapTile(map, tx, ty))).toBe(0);
    expect(toolContext.funds).toBe(4);
  });

  it('does not bulldoze when speed is reduced', () => {
    const { context, store, toolContext } = createContext(1, { funds: 10 });
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const bus = makeSprite(context, SPRITE_TYPE.BUS, 104, 172);
    bus.dir = 1;
    bus.speed = 100;

    const cellX = (bus.x + bus.x_hot) >> 5;
    const cellY = (bus.y + bus.y_hot) >> 5;
    trfDensity[trfIndex(cellX, cellY)] = 64;

    const reducedSpeed = 4;
    const tx = (bus.x + bus.x_hot + reducedSpeed + 8) >> 4;
    const ty = (bus.y + bus.y_hot) >> 4;
    setMapTile(store, tx, ty, RIVER | BULLBIT);

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(getMapTile(map, tx, ty)).toBe(RIVER | BULLBIT);
    expect(toolContext.funds).toBe(10);
  });

  it('respects funds and water penalty when bulldozing', () => {
    const { context, store, toolContext } = createContext(1, { funds: 5 });
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const bus = makeSprite(context, SPRITE_TYPE.BUS, 104, 172);
    bus.dir = 1;
    bus.speed = 100;

    const tx = (bus.x + bus.x_hot + 8 + 8) >> 4;
    const ty = (bus.y + bus.y_hot) >> 4;
    setMapTile(store, tx, ty, RIVER | BULLBIT);

    moveObjects(context, map, trfDensity, rateOGMem);

    expect(getMapTile(map, tx, ty)).toBe(RIVER | BULLBIT);
    expect(toolContext.funds).toBe(5);
  });
});

describe('Animation table coverage', () => {
  it('animates representative tiles across ranges', () => {
    const { context, store } = createContext();
    const map = store.getLayer('map') as Uint16Array;

    const samples = [
      { x: 10, y: 10, tile: FIRE },
      { x: 12, y: 10, tile: LTRFBASE },
      { x: 14, y: 10, tile: RADAR0 },
      { x: 16, y: 10, tile: FOUNTAIN },
      { x: 18, y: 10, tile: TELEBASE },
      { x: 20, y: 10, tile: SMOKEBASE },
      { x: 22, y: 10, tile: STADIUM },
      { x: 24, y: 10, tile: NUCLEAR },
    ];

    for (const sample of samples) {
      setMapTile(store, sample.x, sample.y, sample.tile | ANIMBIT);
    }

    animateTiles(context, map);

    for (const sample of samples) {
      const value = getMapTile(map, sample.x, sample.y);
      expect(tileId(value)).toBe(ANI_TILE[sample.tile]);
      expect(flagBits(value)).toBe(ANIMBIT);
    }
  });
});

describe('Determinism across sprite paths', () => {
  const runDeterminism = (
    seed: number,
    setup: (context: ReturnType<typeof createContext>['context'], map: Uint16Array) => SimSprite,
    ticks = 6,
  ) => {
    const { context, store } = createContext(seed, { doAnimation: false });
    const map = store.getLayer('map') as Uint16Array;
    const trfDensity = store.getLayer('trfDensity') as Uint8Array;
    const rateOGMem = store.getLayer('rateOGMem') as Int16Array;

    const sprite = setup(context, map);
    const path: Array<{ x: number; y: number; frame: number }> = [];

    for (let i = 0; i < ticks; i += 1) {
      moveObjects(context, map, trfDensity, rateOGMem);
      path.push({ x: sprite.x, y: sprite.y, frame: sprite.frame });
    }

    return { path, hash: hashLayer(map) };
  };

  it('produces identical paths and map hashes with fixed seeds', () => {
    const setups = [
      {
        name: 'train',
        setup: (context: ReturnType<typeof createContext>['context'], map: Uint16Array) => {
          const train = makeSprite(context, SPRITE_TYPE.TRA, 200, 200);
          train.dir = 1;
          train.frame = 1;
          const row = train.y >> 4;
          for (let x = 0; x < WORLD_X; x += 1) {
            map[indexFor(x, row)] = LHRAIL;
          }
          return train;
        },
      },
      {
        name: 'copter',
        setup: (context: ReturnType<typeof createContext>['context']) => {
          const copter = makeSprite(context, SPRITE_TYPE.COP, 200, 200);
          copter.control = 0;
          copter.dest_x = copter.x + 300;
          copter.dest_y = copter.y;
          copter.sound_count = 1;
          return copter;
        },
      },
      {
        name: 'airplane',
        setup: (context: ReturnType<typeof createContext>['context']) => {
          const plane = makeSprite(context, SPRITE_TYPE.AIR, 200, 200);
          plane.frame = 3;
          plane.dest_x = plane.x + 400;
          plane.dest_y = plane.y;
          return plane;
        },
      },
      {
        name: 'ship',
        setup: (context: ReturnType<typeof createContext>['context'], map: Uint16Array) => {
          const ship = makeSprite(context, SPRITE_TYPE.SHI, 200, 200);
          ship.frame = 1;
          ship.new_dir = 1;
          ship.dir = 1;
          ship.count = 9;
          ship.sound_count = 1;
          const row = ship.y >> 4;
          for (let x = 0; x < WORLD_X; x += 1) {
            map[indexFor(x, row)] = CHANNEL;
          }
          return ship;
        },
      },
      {
        name: 'monster',
        setup: (context: ReturnType<typeof createContext>['context'], map: Uint16Array) => {
          const monster = makeSprite(context, SPRITE_TYPE.GOD, 200, 200);
          monster.control = 0;
          monster.count = 0;
          const hitX = (monster.x + 48) >> 4;
          const hitY = (monster.y + 16) >> 4;
          map[indexFor(hitX, hitY)] = ROADS | BURNBIT;
          return monster;
        },
      },
      {
        name: 'bus',
        setup: (context: ReturnType<typeof createContext>['context'], map: Uint16Array) => {
          const bus = makeSprite(context, SPRITE_TYPE.BUS, 200, 200);
          bus.dir = 1;
          const row = (bus.y + bus.y_hot) >> 4;
          for (let x = 0; x < WORLD_X; x += 1) {
            map[indexFor(x, row)] = ROADS | BURNBIT;
          }
          return bus;
        },
      },
    ];

    for (const test of setups) {
      const first = runDeterminism(1234, test.setup);
      const second = runDeterminism(1234, test.setup);

      expect(first).toEqual(second);
      expect(first.path[0]).not.toEqual(first.path[first.path.length - 1]);
    }
  });
});
