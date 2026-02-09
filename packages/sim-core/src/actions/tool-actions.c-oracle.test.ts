import {
  type CoreOracleState,
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
 * Builds one deterministic TS tool harness for multi-step tool parity checks.
 * Mirrors single-city mutable tool state from `ref/micropolis/src/sim/w_tool.c`,
 * with a TypeScript harness that keeps one `ToolContext` + map alive across calls.
 */
function createTsToolHarness(funds: number) {
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
  return { context, store };
}

/**
 * Applies one TS tool action against an existing mutable tool harness.
 * Mirrors one `do_tool` dispatch in `ref/micropolis/src/sim/w_tool.c`.
 */
function applyTsTool(
  harness: ReturnType<typeof createTsToolHarness>,
  tool: CoreOracleToolName,
  x: number,
  y: number,
) {
  const action: ToolAction = {
    tool,
    x,
    y,
    simStep: 0,
    order: 0,
    tickId: 0,
    seq: 0,
  };
  return applyToolAction(harness.context, action);
}

/**
 * Asserts exact map word parity for one bounded map window.
 * Mirrors `Map[x][y]` word-level parity expectations for tool rewrites in
 * `ref/micropolis/src/sim/w_tool.c` and `ref/micropolis/src/sim/w_con.c`.
 */
function expectMapWindowParity(
  map: Uint16Array,
  oracleState: CoreOracleState,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  for (let xx = centerX - radius; xx <= centerX + radius; xx += 1) {
    for (let yy = centerY - radius; yy <= centerY + radius; yy += 1) {
      const idx = mapIndex(xx, yy);
      expect((map[idx] ?? 0) & 0xffff).toBe(oracleState.map[idx] ?? 0);
    }
  }
}

describe('tool actions C parity', () => {
  it('matches C placement + cost parity for road/rail/wire and R/C/I tools', () => {
    const cases: ReadonlyArray<{
      readonly tool: CoreOracleToolName;
      readonly x: number;
      readonly y: number;
      readonly funds: number;
      readonly mapWindowRadius: number;
      readonly expectedFunds: number;
    }> = [
      {
        tool: 'road',
        x: 10,
        y: 10,
        funds: 500,
        mapWindowRadius: 1,
        // Magic number source: `CostOf[roadState] = 10` in `ref/micropolis/src/sim/w_tool.c`.
        expectedFunds: 490,
      },
      {
        tool: 'rail',
        x: 12,
        y: 10,
        funds: 500,
        mapWindowRadius: 1,
        // Magic number source: `CostOf[rrState] = 20` in `ref/micropolis/src/sim/w_tool.c`.
        expectedFunds: 480,
      },
      {
        tool: 'wire',
        x: 14,
        y: 10,
        funds: 500,
        mapWindowRadius: 1,
        // Magic number source: `CostOf[wireState] = 5` in `ref/micropolis/src/sim/w_tool.c`.
        expectedFunds: 495,
      },
      {
        tool: 'res',
        x: 40,
        y: 40,
        funds: 2000,
        mapWindowRadius: 2,
        // Magic number source: `CostOf[residentialState] = 100` in `ref/micropolis/src/sim/w_tool.c`.
        expectedFunds: 1900,
      },
      {
        tool: 'com',
        x: 50,
        y: 40,
        funds: 2000,
        mapWindowRadius: 2,
        // Magic number source: `CostOf[commercialState] = 100` in `ref/micropolis/src/sim/w_tool.c`.
        expectedFunds: 1900,
      },
      {
        tool: 'ind',
        x: 60,
        y: 40,
        funds: 2000,
        mapWindowRadius: 2,
        // Magic number source: `CostOf[industrialState] = 100` in `ref/micropolis/src/sim/w_tool.c`.
        expectedFunds: 1900,
      },
    ];

    for (const testCase of cases) {
      const oracleBefore = runCoreOracleInitNewCity({ seed: 0x00c0ffee });
      oracleBefore.TotalFunds = testCase.funds;
      oracleBefore.autoBulldoze = 1;
      const oracleAfter = runCoreOracleApplyTool({
        state: oracleBefore,
        tool: testCase.tool,
        x: testCase.x,
        y: testCase.y,
      });

      const harness = createTsToolHarness(testCase.funds);
      const outcome = applyTsTool(harness, testCase.tool, testCase.x, testCase.y);
      const map = harness.store.getLayer('map') as Uint16Array;
      const idx = mapIndex(testCase.x, testCase.y);

      expect(outcome.code).toBe(oracleAfter.code);
      expect(harness.context.funds).toBe(oracleAfter.state.TotalFunds);
      expect(harness.context.funds).toBe(testCase.expectedFunds);
      expectMapWindowParity(
        map,
        oracleAfter.state,
        testCase.x,
        testCase.y,
        testCase.mapWindowRadius,
      );
      expect((map[idx] ?? 0) & TileFlag.ZONEBIT).toBe(
        (oracleAfter.state.map[idx] ?? 0) & TileFlag.ZONEBIT,
      );
    }
  });

  it('matches C bulldoze placement + funds behavior, including no-funds reject', () => {
    const x = 25;
    const y = 25;
    const funds = 500;

    const oracleState = runCoreOracleInitNewCity({ seed: 0x00c0ffee });
    oracleState.TotalFunds = funds;
    oracleState.autoBulldoze = 1;
    const oracleRoad = runCoreOracleApplyTool({ state: oracleState, tool: 'road', x, y });
    const oracleDoze = runCoreOracleApplyTool({ state: oracleRoad.state, tool: 'bulldoze', x, y });

    const harness = createTsToolHarness(funds);
    const roadOutcome = applyTsTool(harness, 'road', x, y);
    const dozeOutcome = applyTsTool(harness, 'bulldoze', x, y);
    const map = harness.store.getLayer('map') as Uint16Array;

    expect(roadOutcome.code).toBe(oracleRoad.code);
    expect(dozeOutcome.code).toBe(oracleDoze.code);
    expect(harness.context.funds).toBe(oracleDoze.state.TotalFunds);
    // Magic-number source: road + bulldoze costs are `10 + 1` from `CostOf[]` and `_LayDoze`.
    expect(harness.context.funds).toBe(489);
    expectMapWindowParity(map, oracleDoze.state, x, y, 1);

    oracleDoze.state.TotalFunds = 0;
    const oracleNoFunds = runCoreOracleApplyTool({
      state: oracleDoze.state,
      tool: 'bulldoze',
      x,
      y,
    });

    harness.context.funds = 0;
    const noFundsOutcome = applyTsTool(harness, 'bulldoze', x, y);
    expect(noFundsOutcome.code).toBe(oracleNoFunds.code);
    expect(harness.context.funds).toBe(oracleNoFunds.state.TotalFunds);
    expect(harness.context.funds).toBe(0);
    expectMapWindowParity(map, oracleNoFunds.state, x, y, 1);
  });
});
