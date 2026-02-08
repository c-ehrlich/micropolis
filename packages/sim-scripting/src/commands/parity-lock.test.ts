import { describe, expect, it } from 'vitest';

import { ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import {
  createSimBudgetOptionsState,
  createSimBudgetOptionsSubcommandEntries,
  createSimCityGameSetupState,
  createSimCityGameSetupSubcommandEntries,
  createSimKickState,
  createSimSpeedDelayControlState,
  createSimSpeedDelayControlSubcommandEntries,
  createSimSubcommandTable,
  createSimUrlBrowserRandomDollarsUtilitySubcommandEntries,
  registerSimCommand,
} from './sim-command.ts';

describe('sim parity lock compatibility', () => {
  it('keeps subcommand lookup case-sensitive and returns unknown-subcommand errors', () => {
    // Mirrors `SimCmd` hash lookup in `ref/micropolis/src/sim/w_sim.c`:
    // `Tcl_FindHashEntry(&SimCmds, argv[1])` is exact-case.
    const runtime = new ScriptRuntime();
    registerSimCommand(
      runtime,
      createSimSubcommandTable(createSimSpeedDelayControlSubcommandEntries()),
    );

    expect(runtime.invoke(['sim', 'speed'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown sim subcommand: speed',
    });
  });

  it('preserves C truncating integer math for department spend calculations', () => {
    const runtime = new ScriptRuntime();
    const state = createSimBudgetOptionsState({
      roadMaxValue: 101,
    });
    registerSimCommand(
      runtime,
      createSimSubcommandTable(createSimBudgetOptionsSubcommandEntries({ state })),
    );

    expect(runtime.invoke(['sim', 'RoadFund', '33'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '33',
    });

    // `SimCmdRoadFund` in `w_sim.c` computes
    // `RoadSpend = (RoadMaxValue * i) / 100` with C `int` truncation.
    // `(101 * 33) / 100` must truncate to `33`.
    expect(state.roadSpend).toBe(33);
  });

  it('preserves `Kick()` and callback sequencing for `AutoBudget` writes', () => {
    const runtime = new ScriptRuntime();
    const kickState = createSimKickState();
    const events: string[] = [];

    registerSimCommand(
      runtime,
      createSimSubcommandTable(
        createSimBudgetOptionsSubcommandEntries({
          kickState,
          hooks: {
            onKick: () => {
              events.push('kick');
            },
            onScheduleDelayedUpdate: () => {
              events.push('schedule');
            },
            onUpdateBudget: () => {
              events.push('update-budget');
            },
          },
        }),
      ),
    );

    expect(runtime.invoke(['sim', 'AutoBudget', '0'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    expect(runtime.invoke(['sim', 'AutoBudget', '1'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });

    // `SimCmdAutoBudget` in `w_sim.c` does `Kick(); UpdateBudget();`.
    // `Kick()` from `w_tk.c` schedules delayed update only on first call.
    expect(events).toEqual(['kick', 'schedule', 'update-budget', 'kick', 'update-budget']);
  });

  it('keeps legacy quirks configurable for CityFileName, Dollars, Disasters, and Speed', () => {
    const speedRuntime = new ScriptRuntime();
    const speedState = createSimSpeedDelayControlState();
    registerSimCommand(
      speedRuntime,
      createSimSubcommandTable(createSimSpeedDelayControlSubcommandEntries({ state: speedState })),
    );

    expect(speedRuntime.invoke(['sim', 'Speed', '7'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '3',
    });
    // `SimCmdSpeed` accepts `0..7` in `w_sim.c`, and `setSpeed` in `w_util.c`
    // clamps to `0..3`.
    expect(speedState.simMetaSpeed).toBe(3);

    const disastersRuntime = new ScriptRuntime();
    const disastersState = createSimBudgetOptionsState();
    registerSimCommand(
      disastersRuntime,
      createSimSubcommandTable(createSimBudgetOptionsSubcommandEntries({ state: disastersState })),
    );

    expect(disastersRuntime.invoke(['sim', 'Disasters'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });
    expect(disastersRuntime.invoke(['sim', 'Disasters', '0'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    // `SimCmdDisasters` maps to `NoDisasters` inversion in `w_sim.c`.
    expect(disastersState.noDisasters).toBe(1);

    const cityFileNameRuntime = new ScriptRuntime();
    registerSimCommand(
      cityFileNameRuntime,
      createSimSubcommandTable(
        createSimCityGameSetupSubcommandEntries({
          state: createSimCityGameSetupState(),
        }),
      ),
    );

    expect(cityFileNameRuntime.invoke(['sim', 'CityFileName', '/tmp/newcity.cty'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '/tmp/newcity.cty',
    });

    const legacyCityFileNameRuntime = new ScriptRuntime();
    registerSimCommand(
      legacyCityFileNameRuntime,
      createSimSubcommandTable(
        createSimCityGameSetupSubcommandEntries({
          state: createSimCityGameSetupState(),
          parity: {
            legacyCityFileNameAllocationBug: true,
          },
        }),
      ),
    );

    expect(legacyCityFileNameRuntime.invoke(['sim', 'CityFileName', '/tmp/long-name.cty'])).toEqual(
      {
        code: ScriptResultCode.Ok,
        // `SimCmdCityFileName` in `w_sim.c` allocates `strlen(argv[0]) + 1` bytes.
        // Here `argv[0]` is "sim" (length 3), so the copied string keeps 4 bytes: `/tm`.
        value: '/tm',
      },
    );

    const dollarsRuntime = new ScriptRuntime();
    registerSimCommand(
      dollarsRuntime,
      createSimSubcommandTable(createSimUrlBrowserRandomDollarsUtilitySubcommandEntries()),
    );

    expect(dollarsRuntime.invoke(['sim', 'Dollars', '1000'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '$1,000',
    });

    const legacyDollarsRuntime = new ScriptRuntime();
    registerSimCommand(
      legacyDollarsRuntime,
      createSimSubcommandTable(
        createSimUrlBrowserRandomDollarsUtilitySubcommandEntries({
          parity: {
            legacyDollarsLiteralFormat: true,
          },
        }),
      ),
    );

    expect(legacyDollarsRuntime.invoke(['sim', 'Dollars'])).toEqual({
      code: ScriptResultCode.Ok,
      // `SimCmdDollars` in `w_sim.c` legacy path formats `argv[1]` ("Dollars")
      // with the same comma-grouping code path used for numeric input.
      value: '$D,oll,ars',
    });
    expect(legacyDollarsRuntime.invoke(['sim', 'Dollars', '1000'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'sim Dollars expects argc 2 in legacy mode, got 3',
    });
  });
});
