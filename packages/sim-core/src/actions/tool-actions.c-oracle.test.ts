import {
  type CoreOracleToolName,
  runCoreOracleApplyTool,
  runCoreOracleInitNewCity,
} from '@city/micropolis-c-harness/core-parity';
import { describe, expect, it } from 'vitest';

import { TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { applyToolAction, createToolContext, type ToolAction } from './tool-actions.ts';

/**
 * Map index helper for `Map[WORLD_X][WORLD_Y]` x-major storage.
 * Mirrors `Map[x][y]` layout used in `ref/micropolis/src/sim/w_tool.c`.
 */
function mapIndex(x: number, y: number): number {
  return x * World.WORLD_Y + y;
}

/**
 * Runs one TS tool action with deterministic context settings.
 * Mirrors `DoTool`/`do_tool` single-player paths in `ref/micropolis/src/sim/w_tool.c`.
 */
function runTsTool(tool: CoreOracleToolName, x: number, y: number, funds: number) {
  const store = createClassicMapStore();
  store.beginTick();
  const rng = new MicropolisRng(0x00c0ffee);
  const context = createToolContext({
    store,
    rng,
    funds,
    autoBulldoze: true,
    doAnimation: true,
  });
  const action: ToolAction = {
    tool,
    x,
    y,
    simStep: 0,
    order: 0,
    tickId: 0,
    seq: 0,
  };
  const outcome = applyToolAction(context, action);
  return { context, store, outcome };
}

describe('tool actions C parity', () => {
  it('matches C road tool placement result and tile rewrite', () => {
    const x = 10;
    const y = 10;
    const funds = 500;

    const oracleBefore = runCoreOracleInitNewCity({ seed: 0x00c0ffee });
    oracleBefore.TotalFunds = funds;
    oracleBefore.autoBulldoze = 1;
    const oracleAfter = runCoreOracleApplyTool({
      state: oracleBefore,
      tool: 'road',
      x,
      y,
    });

    const { context, store, outcome } = runTsTool('road', x, y, funds);
    const map = store.getLayer('map') as Uint16Array;
    const idx = mapIndex(x, y);

    // `w_tool.c` road tool returns the `ConnecTile` code from `w_con.c`.
    expect(outcome.code).toBe(oracleAfter.code);
    expect((map[idx] ?? 0) & 0xffff).toBe(oracleAfter.state.map[idx] ?? 0);
    expect(context.funds).toBe(oracleAfter.state.TotalFunds);

    // `w_con.c` `_LayRoad` on dirt creates `ROADS|BULLBIT|BURNBIT`.
    expect((map[idx] ?? 0) & TileFlag.ZONEBIT).toBe(0);
  });

  it('matches C residential tool 3x3 placement footprint and funds spend', () => {
    const x = 40;
    const y = 40;
    const funds = 2000;

    const oracleBefore = runCoreOracleInitNewCity({ seed: 0x00c0ffee });
    oracleBefore.TotalFunds = funds;
    oracleBefore.autoBulldoze = 1;
    const oracleAfter = runCoreOracleApplyTool({
      state: oracleBefore,
      tool: 'res',
      x,
      y,
    });

    const { context, store, outcome } = runTsTool('res', x, y, funds);
    const map = store.getLayer('map') as Uint16Array;

    // `w_tool.c` `check3x3` returns `1` for successful zone placement.
    expect(outcome.code).toBe(oracleAfter.code);
    expect(context.funds).toBe(oracleAfter.state.TotalFunds);

    for (let xx = x - 2; xx <= x + 2; xx += 1) {
      for (let yy = y - 2; yy <= y + 2; yy += 1) {
        const idx = mapIndex(xx, yy);
        expect((map[idx] ?? 0) & 0xffff).toBe(oracleAfter.state.map[idx] ?? 0);
      }
    }
  });
});
