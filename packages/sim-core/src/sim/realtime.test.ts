import { describe, expect, it, vi } from 'vitest';

import { createToolContext } from '../actions/tool-actions.ts';
import { assertDefined } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { doMessage } from '../systems/messages.ts';
import {
  ANI_TILE,
  animateTiles,
  createRealtimeContext,
  getSprite,
  makeExplosionAt,
  makeSprite,
  makeTornado,
  runRealtimeTicks,
  SPRITE_LAYOUT_BY_TYPE,
  SPRITE_SLOT_COUNT,
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
  it('keeps C-parity sprite type ids and slot count constants', () => {
    // Mirrors `TRA`..`BUS` and `OBJN` constants in `ref/micropolis/src/sim/headers/sim.h`.
    expect(SPRITE_TYPE).toEqual({
      TRA: 1,
      COP: 2,
      AIR: 3,
      SHI: 4,
      GOD: 5,
      TOR: 6,
      EXP: 7,
      BUS: 8,
    });
    expect(SPRITE_SLOT_COUNT).toBe(9);
  });

  it('applies InitSprite layout fields for each sprite type', () => {
    const store = createClassicMapStore();
    store.beginTick();
    const rng = new MicropolisRng(9);
    const toolContext = createToolContext({ store, rng, funds: 0 });
    const context = createRealtimeContext({ store, rng, toolContext });

    // Expected geometry/hotspot values are copied from each `InitSprite` case in
    // `ref/micropolis/src/sim/w_sprite.c`.
    const expectedLayouts = [
      {
        type: SPRITE_TYPE.TRA,
        layout: { width: 32, height: 32, x_offset: 32, y_offset: -16, x_hot: 40, y_hot: -8 },
      },
      {
        type: SPRITE_TYPE.COP,
        layout: { width: 32, height: 32, x_offset: 32, y_offset: -16, x_hot: 40, y_hot: -8 },
      },
      {
        type: SPRITE_TYPE.AIR,
        layout: { width: 48, height: 48, x_offset: 24, y_offset: 0, x_hot: 48, y_hot: 16 },
      },
      {
        type: SPRITE_TYPE.SHI,
        layout: { width: 48, height: 48, x_offset: 32, y_offset: -16, x_hot: 48, y_hot: 0 },
      },
      {
        type: SPRITE_TYPE.GOD,
        layout: { width: 48, height: 48, x_offset: 24, y_offset: 0, x_hot: 40, y_hot: 16 },
      },
      {
        type: SPRITE_TYPE.TOR,
        layout: { width: 48, height: 48, x_offset: 24, y_offset: 0, x_hot: 40, y_hot: 36 },
      },
      {
        type: SPRITE_TYPE.EXP,
        layout: { width: 48, height: 48, x_offset: 24, y_offset: 0, x_hot: 40, y_hot: 16 },
      },
      {
        type: SPRITE_TYPE.BUS,
        layout: { width: 32, height: 32, x_offset: 30, y_offset: -18, x_hot: 40, y_hot: -8 },
      },
    ] as const;

    for (const expected of expectedLayouts) {
      const sprite = makeSprite(context, expected.type, 160, 160);
      expect({
        width: sprite.width,
        height: sprite.height,
        x_offset: sprite.x_offset,
        y_offset: sprite.y_offset,
        x_hot: sprite.x_hot,
        y_hot: sprite.y_hot,
      }).toEqual(expected.layout);
      expect(SPRITE_LAYOUT_BY_TYPE[expected.type]).toEqual(expected.layout);
    }

    store.commitTick();
  });

  it('does not infer SF ship-honk behavior from numeric scenario id defaults', () => {
    const store = createClassicMapStore();
    store.beginTick();
    const rng = new MicropolisRng(1);
    const toolContext = createToolContext({ store, rng, funds: 0 });
    const context = createRealtimeContext({
      store,
      rng,
      toolContext,
      scenarioId: 2,
    });

    // C used `ScenarioID == 2` directly in `DoShipSprite` (`w_sprite.c`), but
    // Stage 1.4 routes this through closed behavior profiles instead.
    expect(context.shipHonkBehavior).toBe('default');

    store.commitTick();
  });

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

  it('couples realtime messages through SendMesAt queueing when message coupling is configured', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const rng = new MicropolisRng(1);
    const sendMes = vi.fn();
    const sendMesAtHook = vi.fn();
    const simContext = createSimContext({
      store,
      rng,
      hooks: {
        sendMes,
        sendMesAt: sendMesAtHook,
        tickCount: () => 100,
      },
    });
    const simState = createSimState();
    const directOnMessage = vi.fn();
    const toolContext = createToolContext({ store, rng, funds: 0 });
    const context = createRealtimeContext({
      store,
      rng,
      toolContext,
      messageCoupling: { state: simState, context: simContext },
      onMessage: directOnMessage,
    });

    // w_sprite.c doExplosionSprite emits message id 32 via SendMesAt once frame advances to 2.
    makeExplosionAt(context, (WORLD_X >> 1) * 16, (WORLD_Y >> 1) * 16);
    runRealtimeTicks(context, 2);

    expect(simState.MessagePort).toBe(32);
    const queuedX = simState.MesX;
    const queuedY = simState.MesY;
    expect(directOnMessage).not.toHaveBeenCalled();
    expect(sendMes).not.toHaveBeenCalled();
    expect(sendMesAtHook).not.toHaveBeenCalled();

    // s_msg.c doMessage dispatches queued MesX/MesY through the message hook.
    doMessage(simState, simContext);
    expect(sendMesAtHook).toHaveBeenCalledTimes(1);
    expect(sendMesAtHook).toHaveBeenCalledWith(32, queuedX, queuedY);

    store.commitTick();
  });

  it('respects SendMesAt queue gating when realtime coupling is configured', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const rng = new MicropolisRng(1);
    const sendMes = vi.fn();
    const sendMesAtHook = vi.fn();
    const simContext = createSimContext({
      store,
      rng,
      hooks: {
        sendMes,
        sendMesAt: sendMesAtHook,
        tickCount: () => 100,
      },
    });
    const simState = createSimState();
    simState.MessagePort = 7;
    const toolContext = createToolContext({ store, rng, funds: 0 });
    const context = createRealtimeContext({
      store,
      rng,
      toolContext,
      messageCoupling: { state: simState, context: simContext },
      onMessage: vi.fn(),
    });

    makeExplosionAt(context, (WORLD_X >> 1) * 16, (WORLD_Y >> 1) * 16);
    runRealtimeTicks(context, 2);

    // s_msg.c SendMesAt delegates to SendMes: positive ids are dropped when MessagePort is occupied.
    expect(simState.MessagePort).toBe(7);
    doMessage(simState, simContext);
    expect(sendMes).toHaveBeenCalledWith(7);
    expect(sendMesAtHook).not.toHaveBeenCalled();

    store.commitTick();
  });

  it('clears prior message-port state before tornado picture dispatch when coupling is configured', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const rng = new MicropolisRng(1);
    const sendMes = vi.fn();
    const sendMesAtHook = vi.fn();
    const simContext = createSimContext({
      store,
      rng,
      hooks: {
        sendMes,
        sendMesAt: sendMesAtHook,
        tickCount: () => 100,
      },
    });
    const simState = createSimState();
    simState.MessagePort = 17;
    simState.LastPicNum = -22;
    const toolContext = createToolContext({ store, rng, funds: 0 });
    const context = createRealtimeContext({
      store,
      rng,
      toolContext,
      messageCoupling: { state: simState, context: simContext },
      onMessage: vi.fn(),
    });

    makeTornado(context);

    // w_sprite.c `MakeTornado` calls `ClearMes()` then `SendMesAt(-22, ...)`:
    // - `ClearMes` clears MessagePort and LastPicNum in s_msg.c.
    // - `SendMesAt` then enqueues picture id `-22` with coordinates.
    expect(simState.MessagePort).toBe(-22);
    expect(simState.LastPicNum).toBe(-22);
    expect(simState.MesX).toBeGreaterThan(0);
    expect(simState.MesY).toBeGreaterThan(0);
    const queuedX = simState.MesX;
    const queuedY = simState.MesY;

    doMessage(simState, simContext);
    expect(sendMes).not.toHaveBeenCalled();
    expect(sendMesAtHook).toHaveBeenCalledTimes(1);
    expect(sendMesAtHook).toHaveBeenCalledWith(-22, queuedX, queuedY);

    store.commitTick();
  });
});
