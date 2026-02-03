import { describe, expect, it } from 'vitest';

import { getOrThrow } from '../core/assert.ts';
import { Tile, TileMask, World } from '../core/constants.ts';
import { REPLAY_VERSION, replayToolLog } from './replay.ts';

const CLASSIC_MAP = { width: World.WORLD_X, height: World.WORLD_Y };
const { LOMASK } = TileMask;

const indexFor = (x: number, y: number) => x * World.WORLD_Y + y;
const tileAt = (map: Uint16Array, x: number, y: number) => getOrThrow(map[indexFor(x, y)]) & LOMASK;

describe('replay determinism', () => {
  it('produces stable hashes for the same log', () => {
    const log = {
      version: REPLAY_VERSION,
      seed: 42,
      mapSize: CLASSIC_MAP,
      actions: [
        {
          tool: 'park' as const,
          x: 10,
          y: 10,
          simStep: 0,
          order: 0,
          tickId: 0,
        },
        {
          tool: 'road' as const,
          x: 11,
          y: 10,
          simStep: 0,
          order: 1,
          tickId: 0,
        },
      ],
      ticks: [0],
    };

    const first = replayToolLog(log, { funds: 1000 });
    const second = replayToolLog(log, { funds: 1000 });

    expect(first.mapHash).toBe(second.mapHash);
    expect(first.scalarsHash).toBe(second.scalarsHash);
    expect(first.combinedHash).toBe(second.combinedHash);
  });

  it('applies tick batches in tickId order', () => {
    const log = {
      version: REPLAY_VERSION,
      seed: 7,
      mapSize: CLASSIC_MAP,
      actions: [
        {
          tool: 'road' as const,
          x: 5,
          y: 5,
          simStep: 0,
          order: 0,
          tickId: 1,
        },
        {
          tool: 'bulldoze' as const,
          x: 5,
          y: 5,
          simStep: 0,
          order: 0,
          tickId: 0,
        },
      ],
      ticks: [0, 1],
    };

    const result = replayToolLog(log, { funds: 1000 });

    expect(tileAt(result.map, 5, 5)).toBe(Tile.ROADS);
  });

  it('uses input order when seq is omitted', () => {
    const log = {
      version: REPLAY_VERSION,
      seed: 7,
      mapSize: CLASSIC_MAP,
      actions: [
        {
          tool: 'road' as const,
          x: 7,
          y: 7,
          simStep: 0,
          order: 0,
          tickId: 0,
        },
        {
          tool: 'bulldoze' as const,
          x: 7,
          y: 7,
          simStep: 0,
          order: 0,
          tickId: 0,
        },
      ],
      ticks: [0],
    };

    const result = replayToolLog(log, { funds: 1000 });

    expect(tileAt(result.map, 7, 7)).toBe(Tile.DIRT);
  });

  it('changes scalars hash when seed changes', () => {
    const base = {
      version: REPLAY_VERSION,
      seed: 1,
      mapSize: CLASSIC_MAP,
      actions: [],
      ticks: [],
    };

    const first = replayToolLog(base, { funds: 1000 });
    const second = replayToolLog({ ...base, seed: 2 }, { funds: 1000 });

    expect(first.scalarsHash).not.toBe(second.scalarsHash);
    expect(first.combinedHash).not.toBe(second.combinedHash);
  });

  it('changes map hash when actions differ', () => {
    const base = {
      version: REPLAY_VERSION,
      seed: 3,
      mapSize: CLASSIC_MAP,
      ticks: [0],
    };

    const logA = {
      ...base,
      actions: [
        {
          tool: 'road' as const,
          x: 2,
          y: 2,
          simStep: 0,
          order: 0,
          tickId: 0,
        },
      ],
    };
    const logB = {
      ...base,
      actions: [
        {
          tool: 'road' as const,
          x: 3,
          y: 2,
          simStep: 0,
          order: 0,
          tickId: 0,
        },
      ],
    };

    const first = replayToolLog(logA, { funds: 1000 });
    const second = replayToolLog(logB, { funds: 1000 });

    expect(first.mapHash).not.toBe(second.mapHash);
    expect(first.combinedHash).not.toBe(second.combinedHash);
  });

  it('changes scalars hash when starting funds change', () => {
    const log = {
      version: REPLAY_VERSION,
      seed: 11,
      mapSize: CLASSIC_MAP,
      actions: [
        {
          tool: 'road' as const,
          x: 9,
          y: 9,
          simStep: 0,
          order: 0,
          tickId: 0,
        },
      ],
      ticks: [0],
    };

    const first = replayToolLog(log, { funds: 500 });
    const second = replayToolLog(log, { funds: 1500 });

    expect(first.scalarsHash).not.toBe(second.scalarsHash);
    expect(first.combinedHash).not.toBe(second.combinedHash);
  });
});
