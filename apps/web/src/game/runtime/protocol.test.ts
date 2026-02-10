import { describe, expect, it } from 'vitest';

import {
  fromCanonicalBridgeToolName,
  getPlayableBridgeCommandType,
  getPlayableToolSpec,
  isPlayableBridgeCommandType,
  isPlayableScenarioCommand,
  PLAYABLE_BRIDGE_COMMAND_TYPES,
  PLAYABLE_TOOL_SPECS,
  type PlayableToolName,
  toCanonicalBridgeToolName,
} from './protocol.ts';

describe('runtime protocol Bridge V1 convergence helpers', () => {
  it('locks playable bridge command inventory to canonical command types', () => {
    expect(PLAYABLE_BRIDGE_COMMAND_TYPES).toEqual([
      'tool_apply',
      'sim_pause',
      'sim_resume',
      'sim_set_speed',
      'city_new',
      'city_load',
      'city_save',
      'scenario_start',
    ]);
  });

  it('maps playable runtime commands to canonical bridge command type ids', () => {
    expect(
      getPlayableBridgeCommandType({
        kind: 'tool',
        tool: 'road',
        x: 10,
        y: 11,
      }),
    ).toBe('tool_apply');
    expect(
      getPlayableBridgeCommandType({
        kind: 'sim-control',
        control: 'pause',
      }),
    ).toBe('sim_pause');
    expect(
      getPlayableBridgeCommandType({
        kind: 'sim-control',
        control: 'play',
      }),
    ).toBe('sim_resume');
    expect(
      getPlayableBridgeCommandType({
        kind: 'sim-control',
        control: 'set-speed',
        speed: 2,
      }),
    ).toBe('sim_set_speed');
    expect(
      getPlayableBridgeCommandType({
        kind: 'city-lifecycle',
        action: 'new-city',
      }),
    ).toBe('city_new');
    expect(
      getPlayableBridgeCommandType({
        kind: 'city-io',
        action: 'load-city',
        fileName: 'city.cty',
        cityBytes: new Uint8Array([1, 2, 3]),
      }),
    ).toBe('city_load');
    expect(
      getPlayableBridgeCommandType({
        kind: 'city-io',
        action: 'save-city',
        fileName: 'city.cty',
      }),
    ).toBe('city_save');
    expect(
      getPlayableBridgeCommandType({
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: 1,
      }),
    ).toBe('scenario_start');
  });

  it('maps playable tool ids to canonical bridge tool ids and back', () => {
    const tools: readonly PlayableToolName[] = [
      'road',
      'rail',
      'wire',
      'bulldoze',
      'res',
      'com',
      'ind',
    ];

    for (const tool of tools) {
      const canonical = toCanonicalBridgeToolName(tool);
      expect(fromCanonicalBridgeToolName(canonical)).toBe(tool);
    }
  });

  it('keeps playable tool footprints aligned with w_tool.c toolSize/toolOffset tables', () => {
    // Magic-number source: `toolSize[]`/`toolOffset[]` in
    // `ref/micropolis/src/sim/w_tool.c` for roadState/rrState/wireState/dozeState
    // (all 1x1, offset 0) and residentialState/commercialState/industrialState
    // (all 3x3, offset 1).
    expect(
      PLAYABLE_TOOL_SPECS.map((spec) => ({
        tool: spec.tool,
        size: spec.size,
        offset: spec.offset,
      })),
    ).toEqual([
      { tool: 'road', size: 1, offset: 0 },
      { tool: 'rail', size: 1, offset: 0 },
      { tool: 'wire', size: 1, offset: 0 },
      { tool: 'bulldoze', size: 1, offset: 0 },
      { tool: 'res', size: 3, offset: 1 },
      { tool: 'com', size: 3, offset: 1 },
      { tool: 'ind', size: 3, offset: 1 },
    ]);

    expect(getPlayableToolSpec('road')).toMatchObject({ size: 1, offset: 0 });
    expect(getPlayableToolSpec('res')).toMatchObject({ size: 3, offset: 1 });
  });

  it('accepts only frozen Bridge V1 playable command discriminants', () => {
    for (const type of PLAYABLE_BRIDGE_COMMAND_TYPES) {
      expect(isPlayableBridgeCommandType(type)).toBe(true);
    }

    expect(isPlayableBridgeCommandType('unknown_command_type' as never)).toBe(false);
  });

  it('accepts only integral scenario ids at the command gate', () => {
    // `LoadScenario(short s)` consumes integer ids in `s_fileio.c`; C then clamps
    // out-of-range integers with `if ((s < 1) || (s > 8)) s = 1;`.
    expect(
      isPlayableScenarioCommand({
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: 9,
      }),
    ).toBe(true);
    expect(
      isPlayableScenarioCommand({
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: 1.5,
      }),
    ).toBe(false);
  });
});
