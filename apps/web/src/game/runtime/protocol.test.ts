import { describe, expect, it } from 'vitest';

import {
  fromCanonicalBridgeToolName,
  getPlayableBridgeCommandType,
  getPlayableToolSpec,
  type HostAckEnvelope,
  type HostErrorEnvelope,
  type HostPatchEnvelope,
  type HostRejectEnvelope,
  type HostResyncEnvelope,
  type HostSnapshotEnvelope,
  type HostSoundDeltaPayload,
  isHostSoundDeltaPayload,
  isHostSoundScopePayload,
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
      'res',
      'com',
      'ind',
      'fire',
      'query',
      'police',
      'wire',
      'bulldoze',
      'rail',
      'road',
      'stadium',
      'park',
      'seaport',
      'coal',
      'nuclear',
      'airport',
    ];

    for (const tool of tools) {
      const canonical = toCanonicalBridgeToolName(tool);
      expect(fromCanonicalBridgeToolName(canonical)).toBe(tool);
    }
  });

  it('keeps playable tool footprints aligned with w_tool.c toolSize/toolOffset tables', () => {
    // Magic-number source: `toolSize[]`/`toolOffset[]` in
    // `ref/micropolis/src/sim/w_tool.c` for the full editor tool set:
    // - 3x3 offset 1: residential/commercial/industrial/fire/police
    // - 1x1 offset 0: query/wire/doze/rail/road/park
    // - 4x4 offset 1: stadium/seaport/coal/nuclear
    // - 6x6 offset 1: airport.
    expect(
      PLAYABLE_TOOL_SPECS.map((spec) => ({
        tool: spec.tool,
        toolState: spec.toolState,
        size: spec.size,
        offset: spec.offset,
        baseCost: spec.baseCost,
      })),
    ).toEqual([
      // Magic-number source: `tool_state` ids and `CostOf[]` in
      // `ref/micropolis/src/sim/w_tool.c`.
      { tool: 'res', toolState: 0, size: 3, offset: 1, baseCost: 100 },
      { tool: 'com', toolState: 1, size: 3, offset: 1, baseCost: 100 },
      { tool: 'ind', toolState: 2, size: 3, offset: 1, baseCost: 100 },
      { tool: 'fire', toolState: 3, size: 3, offset: 1, baseCost: 500 },
      { tool: 'query', toolState: 4, size: 1, offset: 0, baseCost: 0 },
      { tool: 'police', toolState: 5, size: 3, offset: 1, baseCost: 500 },
      { tool: 'wire', toolState: 6, size: 1, offset: 0, baseCost: 5 },
      { tool: 'bulldoze', toolState: 7, size: 1, offset: 0, baseCost: 1 },
      { tool: 'rail', toolState: 8, size: 1, offset: 0, baseCost: 20 },
      { tool: 'road', toolState: 9, size: 1, offset: 0, baseCost: 10 },
      { tool: 'stadium', toolState: 12, size: 4, offset: 1, baseCost: 5000 },
      { tool: 'park', toolState: 13, size: 1, offset: 0, baseCost: 10 },
      { tool: 'seaport', toolState: 14, size: 4, offset: 1, baseCost: 3000 },
      { tool: 'coal', toolState: 15, size: 4, offset: 1, baseCost: 3000 },
      { tool: 'nuclear', toolState: 16, size: 4, offset: 1, baseCost: 5000 },
      { tool: 'airport', toolState: 17, size: 6, offset: 1, baseCost: 10000 },
    ]);

    expect(getPlayableToolSpec('road')).toMatchObject({
      toolState: 9,
      size: 1,
      offset: 0,
      baseCost: 10,
    });
    expect(getPlayableToolSpec('res')).toMatchObject({
      toolState: 0,
      size: 3,
      offset: 1,
      baseCost: 100,
    });
    expect(getPlayableToolSpec('airport')).toMatchObject({
      toolState: 17,
      size: 6,
      offset: 1,
      baseCost: 10000,
    });
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

  it('defines sound-delta payload shape for authoritative transport', () => {
    const viewScopedDelta: HostSoundDeltaPayload = {
      channel: 'city',
      soundSpec: 'Siren',
      scope: { kind: 'view', target: '.playMap' },
    };

    const globalDelta: HostSoundDeltaPayload = {
      channel: 'warning',
      soundSpec: 'Explosion High',
      scope: { kind: 'global' },
    };

    const noScopeDelta: HostSoundDeltaPayload = {
      channel: 'edit',
      soundSpec: 'UhUh',
    };

    expect(viewScopedDelta).toEqual({
      channel: 'city',
      soundSpec: 'Siren',
      scope: { kind: 'view', target: '.playMap' },
    });
    expect(globalDelta).toEqual({
      channel: 'warning',
      soundSpec: 'Explosion High',
      scope: { kind: 'global' },
    });
    expect(noScopeDelta).toEqual({
      channel: 'edit',
      soundSpec: 'UhUh',
    });
  });

  it('accepts only locked scope metadata shape for sound deltas', () => {
    expect(isHostSoundScopePayload({ kind: 'view', target: '.playMap' })).toBe(true);
    expect(isHostSoundScopePayload({ kind: 'global' })).toBe(true);

    expect(isHostSoundScopePayload({ kind: 'view', target: 100 })).toBe(false);
    expect(isHostSoundScopePayload({ kind: 'local' })).toBe(false);
    expect(isHostSoundScopePayload({ kind: 'view', target: '.playMap', extra: true })).toBe(false);
  });

  it('accepts only locked channel/soundSpec/scope shape for sound deltas', () => {
    expect(
      isHostSoundDeltaPayload({
        channel: 'city',
        soundSpec: 'Siren',
        scope: { kind: 'view', target: '.playMap' },
      }),
    ).toBe(true);
    expect(
      isHostSoundDeltaPayload({
        channel: 'warning',
        soundSpec: 'Explosion-High -speed [expr 100 * $sound_high_quality]',
      }),
    ).toBe(true);

    expect(
      isHostSoundDeltaPayload({
        channel: 'city',
        soundSpec: 123,
      }),
    ).toBe(false);
    expect(
      isHostSoundDeltaPayload({
        channel: 'city',
        soundSpec: 'Siren',
        scope: { kind: 'view', target: 55 },
      }),
    ).toBe(false);
    expect(
      isHostSoundDeltaPayload({
        channel: 'city',
        soundSpec: 'Siren',
        extra: 'not-allowed',
      }),
    ).toBe(false);
  });

  it('supports shared sound deltas on every sequenced host envelope kind', () => {
    const soundDeltas: readonly HostSoundDeltaPayload[] = [
      {
        channel: 'city',
        soundSpec: 'Siren',
        scope: { kind: 'view', target: '.playMap' },
      },
      {
        channel: 'warning',
        soundSpec: 'Explosion High',
        scope: { kind: 'global' },
      },
    ];

    const ackEnvelope: HostAckEnvelope = {
      kind: 'ack',
      roomId: 'room-1',
      clientId: 'client-1',
      tick: 10,
      serverSeq: 100,
      commandId: 'cmd-ack',
      soundDeltas,
    };
    const rejectEnvelope: HostRejectEnvelope = {
      kind: 'reject',
      roomId: 'room-1',
      clientId: 'client-1',
      tick: 10,
      serverSeq: 101,
      commandId: 'cmd-reject',
      reason: 'no-funds',
      soundDeltas,
    };
    const patchEnvelope: HostPatchEnvelope = {
      kind: 'patch',
      roomId: 'room-1',
      clientId: 'client-1',
      tick: 10,
      serverSeq: 102,
      payload: {},
      soundDeltas,
    };
    const snapshotEnvelope: HostSnapshotEnvelope = {
      kind: 'snapshot',
      roomId: 'room-1',
      clientId: 'client-1',
      tick: 10,
      serverSeq: 103,
      payload: {},
      soundDeltas,
    };
    const resyncEnvelope: HostResyncEnvelope = {
      kind: 'resync',
      roomId: 'room-1',
      clientId: 'client-1',
      tick: 10,
      serverSeq: 104,
      reason: 'sequence-gap',
      soundDeltas,
    };
    const errorEnvelope: HostErrorEnvelope = {
      kind: 'error',
      roomId: 'room-1',
      clientId: 'client-1',
      tick: 10,
      serverSeq: 105,
      message: 'fatal',
      soundDeltas,
    };

    expect(ackEnvelope.soundDeltas).toEqual(soundDeltas);
    expect(rejectEnvelope.soundDeltas).toEqual(soundDeltas);
    expect(patchEnvelope.soundDeltas).toEqual(soundDeltas);
    expect(snapshotEnvelope.soundDeltas).toEqual(soundDeltas);
    expect(resyncEnvelope.soundDeltas).toEqual(soundDeltas);
    expect(errorEnvelope.soundDeltas).toEqual(soundDeltas);
    expect(ackEnvelope.soundDeltas?.map((soundDelta) => soundDelta.soundSpec)).toEqual([
      'Siren',
      'Explosion High',
    ]);
  });
});
