import { describe, expect, it } from 'vitest';

import {
  fromCanonicalBridgeToolName,
  getStage0PlayableBridgeCommandType,
  STAGE0_PLAYABLE_BRIDGE_COMMAND_TYPES,
  type Stage2ToolName,
  toCanonicalBridgeToolName,
} from './protocol.ts';

describe('runtime protocol Stage 0 convergence helpers', () => {
  it('locks playable bridge command inventory to canonical command types', () => {
    expect(STAGE0_PLAYABLE_BRIDGE_COMMAND_TYPES).toEqual([
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

  it('maps Stage 2 commands to canonical bridge command type ids', () => {
    expect(
      getStage0PlayableBridgeCommandType({
        kind: 'tool',
        tool: 'road',
        x: 10,
        y: 11,
      }),
    ).toBe('tool_apply');
    expect(
      getStage0PlayableBridgeCommandType({
        kind: 'sim-control',
        control: 'pause',
      }),
    ).toBe('sim_pause');
    expect(
      getStage0PlayableBridgeCommandType({
        kind: 'sim-control',
        control: 'play',
      }),
    ).toBe('sim_resume');
    expect(
      getStage0PlayableBridgeCommandType({
        kind: 'sim-control',
        control: 'set-speed',
        speed: 2,
      }),
    ).toBe('sim_set_speed');
    expect(
      getStage0PlayableBridgeCommandType({
        kind: 'city-lifecycle',
        action: 'new-city',
      }),
    ).toBe('city_new');
    expect(
      getStage0PlayableBridgeCommandType({
        kind: 'city-io',
        action: 'load-city',
        fileName: 'city.cty',
        cityBytes: new Uint8Array([1, 2, 3]),
      }),
    ).toBe('city_load');
    expect(
      getStage0PlayableBridgeCommandType({
        kind: 'city-io',
        action: 'save-city',
        fileName: 'city.cty',
      }),
    ).toBe('city_save');
    expect(
      getStage0PlayableBridgeCommandType({
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: 1,
      }),
    ).toBe('scenario_start');
  });

  it('maps Stage 2 tool ids to canonical bridge tool ids and back', () => {
    const tools: readonly Stage2ToolName[] = [
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
});
