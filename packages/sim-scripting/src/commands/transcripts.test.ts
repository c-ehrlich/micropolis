import { describe, expect, it } from 'vitest';

import { ScriptResultCode, type ScriptRuntimeResult } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { registerEditorViewCommand } from './editorview-command.ts';
import { registerMapViewCommand } from './mapview-command.ts';
import {
  createSimBudgetOptionsState,
  createSimBudgetOptionsSubcommandEntries,
  createSimKickState,
  createSimSessionControlSubcommandEntries,
  createSimSpeedDelayControlState,
  createSimSpeedDelayControlSubcommandEntries,
  createSimSubcommandTable,
  registerSimCommand,
} from './sim-command.ts';
import { registerSpriteCommand } from './sprite-command.ts';

interface TranscriptRow {
  argv: readonly string[];
  result: ScriptRuntimeResult;
}

function runTranscript(
  runtime: ScriptRuntime,
  argvList: ReadonlyArray<readonly string[]>,
): TranscriptRow[] {
  return argvList.map((argv) => {
    return {
      argv,
      result: runtime.invoke(argv),
    };
  });
}

describe('command transcripts', () => {
  it('records a representative end-to-end transcript for `sim` command flow', () => {
    const runtime = new ScriptRuntime();
    const kickState = createSimKickState();
    const speedState = createSimSpeedDelayControlState({
      // `sim_init` + `setSpeed(3)` behavior in `sim.c`/`w_util.c` leaves effective speed `3`.
      simMetaSpeed: 3,
      simSpeed: 3,
    });
    const budgetState = createSimBudgetOptionsState({
      // `RoadFund` spend uses C integer math `(roadMaxValue * percent) / 100` in `w_sim.c`.
      roadMaxValue: 101,
    });

    const events: string[] = [];
    registerSimCommand(
      runtime,
      createSimSubcommandTable([
        ...createSimSpeedDelayControlSubcommandEntries({
          state: speedState,
          kickState,
          kickHooks: {
            onKick: () => {
              events.push('kick');
            },
            onScheduleDelayedUpdate: () => {
              events.push('schedule');
            },
          },
        }),
        ...createSimBudgetOptionsSubcommandEntries({
          state: budgetState,
          kickState,
          hooks: {
            onKick: () => {
              events.push('kick');
            },
            onScheduleDelayedUpdate: () => {
              events.push('schedule');
            },
            onUpdateFundEffects: () => {
              events.push('update-fund-effects');
            },
            onUpdateBudget: () => {
              events.push('update-budget');
            },
          },
        }),
        ...createSimSessionControlSubcommandEntries({
          kickState,
          hooks: {
            onUpdate: () => {
              events.push('update');
            },
          },
        }),
      ]),
    );

    const transcript = runTranscript(runtime, [
      ['sim', 'Speed'],
      ['sim', 'Speed', '7'],
      ['sim', 'RoadFund', '33'],
      ['sim', 'RoadFund'],
      ['sim', 'AutoBudget', '0'],
      ['sim', 'Update'],
    ]);

    expect(transcript).toEqual([
      {
        argv: ['sim', 'Speed'],
        result: { code: ScriptResultCode.Ok, value: '3' },
      },
      {
        argv: ['sim', 'Speed', '7'],
        // `SimCmdSpeed` accepts `0..7`, then `setSpeed` clamps to `0..3`.
        result: { code: ScriptResultCode.Ok, value: '3' },
      },
      {
        argv: ['sim', 'RoadFund', '33'],
        result: { code: ScriptResultCode.Ok, value: '33' },
      },
      {
        argv: ['sim', 'RoadFund'],
        result: { code: ScriptResultCode.Ok, value: '33' },
      },
      {
        argv: ['sim', 'AutoBudget', '0'],
        result: { code: ScriptResultCode.Ok, value: '0' },
      },
      {
        argv: ['sim', 'Update'],
        result: { code: ScriptResultCode.Ok, value: '' },
      },
    ]);

    expect(events).toEqual([
      'kick',
      'schedule',
      'update-fund-effects',
      'kick',
      'kick',
      'update-budget',
      'update',
    ]);
    expect(budgetState.roadSpend).toBe(33);
  });

  it('records a representative end-to-end transcript for `editorview` command flow', () => {
    const runtime = new ScriptRuntime();
    registerEditorViewCommand(runtime);

    const transcript = runTranscript(runtime, [
      ['editorview', '.editor.tx', '-width', '320', '-height', '200'],
      ['.editor.tx', 'Pan'],
      ['.editor.tx', 'Pan', '32', '48'],
      ['.editor.tx', 'ToolMode', '2'],
      ['.editor.tx', 'ToolMode'],
      ['.editor.tx', 'Update'],
    ]);

    expect(transcript).toEqual([
      {
        argv: ['editorview', '.editor.tx', '-width', '320', '-height', '200'],
        result: { code: ScriptResultCode.Ok, value: '.editor.tx' },
      },
      {
        argv: ['.editor.tx', 'Pan'],
        // `InitNewView` in `w_x.c` initializes pan to center of 256x256 editor view.
        result: { code: ScriptResultCode.Ok, value: '128 128' },
      },
      {
        argv: ['.editor.tx', 'Pan', '32', '48'],
        result: { code: ScriptResultCode.Ok, value: '32 48' },
      },
      {
        argv: ['.editor.tx', 'ToolMode', '2'],
        result: { code: ScriptResultCode.Ok, value: '2' },
      },
      {
        argv: ['.editor.tx', 'ToolMode'],
        result: { code: ScriptResultCode.Ok, value: '2' },
      },
      {
        argv: ['.editor.tx', 'Update'],
        result: { code: ScriptResultCode.Ok, value: '' },
      },
    ]);
  });

  it('records a representative end-to-end transcript for `mapview` command flow', () => {
    const runtime = new ScriptRuntime();
    registerMapViewCommand(runtime);

    const transcript = runTranscript(runtime, [
      ['mapview', '.map.tx', '-width', '360', '-height', '300'],
      ['.map.tx', 'MapState'],
      ['.map.tx', 'MapState', '14'],
      ['.map.tx', 'ViewAt', '10', '20'],
      ['.map.tx', 'Visible', '1'],
      ['.map.tx', 'MapState'],
    ]);

    expect(transcript).toEqual([
      {
        argv: ['mapview', '.map.tx', '-width', '360', '-height', '300'],
        result: { code: ScriptResultCode.Ok, value: '.map.tx' },
      },
      {
        argv: ['.map.tx', 'MapState'],
        result: { code: ScriptResultCode.Ok, value: '0' },
      },
      {
        argv: ['.map.tx', 'MapState', '14'],
        // `NMAPS` is `15` in `headers/sim.h`, so `14` is the highest valid map state.
        result: { code: ScriptResultCode.Ok, value: '14' },
      },
      {
        argv: ['.map.tx', 'ViewAt', '10', '20'],
        result: { code: ScriptResultCode.Ok, value: 'Sorry Not Implemented Yet' },
      },
      {
        argv: ['.map.tx', 'Visible', '1'],
        result: { code: ScriptResultCode.Ok, value: '1' },
      },
      {
        argv: ['.map.tx', 'MapState'],
        result: { code: ScriptResultCode.Ok, value: '14' },
      },
    ]);
  });

  it('records a representative end-to-end transcript for `sprite` command flow', () => {
    const runtime = new ScriptRuntime();
    registerSpriteCommand(runtime);

    const transcript = runTranscript(runtime, [
      ['sprite', 'train-1', '1'],
      ['train-1', 'x', '100'],
      ['train-1', 'y', '200'],
      ['train-1', 'Init', '100', '200'],
      ['train-1', 'x'],
      ['train-1', 'y'],
      ['train-1', 'Explode'],
      ['train-1', 'frame'],
    ]);

    expect(transcript).toEqual([
      {
        argv: ['sprite', 'train-1', '1'],
        result: { code: ScriptResultCode.Ok, value: 'train-1' },
      },
      {
        argv: ['train-1', 'x', '100'],
        result: { code: ScriptResultCode.Ok, value: '100' },
      },
      {
        argv: ['train-1', 'y', '200'],
        result: { code: ScriptResultCode.Ok, value: '200' },
      },
      {
        argv: ['train-1', 'Init', '100', '200'],
        result: { code: ScriptResultCode.Ok, value: '' },
      },
      {
        argv: ['train-1', 'x'],
        result: { code: ScriptResultCode.Ok, value: '100' },
      },
      {
        argv: ['train-1', 'y'],
        result: { code: ScriptResultCode.Ok, value: '200' },
      },
      {
        argv: ['train-1', 'Explode'],
        result: { code: ScriptResultCode.Ok, value: '' },
      },
      {
        argv: ['train-1', 'frame'],
        // `SpriteCmdExplode` in `w_sprite.c` resets non-explosion sprites to frame `0`.
        result: { code: ScriptResultCode.Ok, value: '0' },
      },
    ]);
  });
});
