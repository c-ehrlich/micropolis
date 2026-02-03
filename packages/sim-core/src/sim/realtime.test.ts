import { describe, expect, it } from 'vitest';

import { createToolContext } from '../actions/tool-actions.ts';
import { assertDefined } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import {
  ANI_TILE,
  animateTiles,
  createRealtimeContext,
  getSprite,
  makeExplosionAt,
  makeTornado,
  runRealtimeTicks,
  SPRITE_TYPE,
} from './realtime.ts';

const { WORLD_X, WORLD_Y } = World;
const indexFor = (x: number, y: number) => x * WORLD_Y + y;

const runTornado = (seed: number, ticks: number) => {
  const store = createClassicMapStore();
  store.beginTick();
  const rng = new MicropolisRng(seed);
  const toolContext = createToolContext({ store, rng, funds: 0 });
  const context = createRealtimeContext({
    store,
    rng,
    toolContext,
    simSpeed: 3,
    doAnimation: false,
  });

  makeTornado(context);
  const sprite = getSprite(context, SPRITE_TYPE.TOR);
  if (!sprite) {
    throw new Error('Tornado sprite not created');
  }

  const start = { x: sprite.x, y: sprite.y, frame: sprite.frame };
  runRealtimeTicks(context, ticks);
  const end = { x: sprite.x, y: sprite.y, frame: sprite.frame };

  store.commitTick();
  return { start, end };
};

const runExplosion = (seed: number, ticks: number) => {
  const store = createClassicMapStore();
  store.beginTick();
  const rng = new MicropolisRng(seed);
  const toolContext = createToolContext({ store, rng, funds: 0 });
  const context = createRealtimeContext({
    store,
    rng,
    toolContext,
    simSpeed: 3,
    doAnimation: false,
  });

  makeExplosionAt(context, (WORLD_X >> 1) * 16, (WORLD_Y >> 1) * 16);
  runRealtimeTicks(context, ticks);

  const map = store.getLayer('map') as Uint16Array;
  const snapshot = Uint16Array.from(map);

  store.commitTick();
  return snapshot;
};

describe('Realtime systems', () => {
  it('moves objects deterministically with fixed RNG', () => {
    const first = runTornado(12345, 12);
    const second = runTornado(12345, 12);

    expect(first).toEqual(second);
    expect(first.start).not.toEqual(first.end);
  });

  it('produces deterministic map mutations for the same seed', () => {
    const first = runExplosion(4242, 14);
    const second = runExplosion(4242, 14);

    expect(first).toEqual(second);
    expect(first.some((value) => value !== 0)).toBe(true);
  });

  it('animates tiles via the animation table', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const rng = new MicropolisRng(1);
    const toolContext = createToolContext({ store, rng, funds: 0 });
    const context = createRealtimeContext({ store, rng, toolContext });
    const map = store.getLayer('map') as Uint16Array;

    const index = indexFor(10, 10);
    store.write('map', index, Tile.FIRE | TileFlag.ANIMBIT);

    animateTiles(context, map);

    const updated = map[index];
    assertDefined(updated);

    expect(updated & TileMask.LOMASK).toBe(ANI_TILE[Tile.FIRE]);
    expect(updated & TileMask.ALLBITS).toBe(TileFlag.ANIMBIT);

    store.commitTick();
  });
});
