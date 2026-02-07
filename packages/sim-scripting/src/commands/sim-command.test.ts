import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import {
  createSimAccessorIntState,
  createSimAccessorIntSubcommandEntries,
  createSimCommandDispatcher,
  createSimKickState,
  createSimReadOnlyGetterState,
  createSimReadOnlyGetterSubcommandEntries,
  createSimSessionControlSubcommandEntries,
  createSimSpeedDelayControlState,
  createSimSpeedDelayControlSubcommandEntries,
  createSimSubcommandTable,
  registerSimCommand,
} from './sim-command.ts';

describe('sim command dispatcher', () => {
  it('dispatches `sim <Subcommand>` using a case-sensitive subcommand table', () => {
    // Mirrors `SimCmd` + `Tcl_FindHashEntry(&SimCmds, argv[1])` dispatch in
    // `ref/micropolis/src/sim/w_sim.c`, where keys are registered by exact case.
    const runtime = new ScriptRuntime();
    registerSimCommand(
      runtime,
      createSimSubcommandTable([
        [
          'Speed',
          (argv) => {
            return makeScriptSuccess(`Speed=${argv[2] ?? ''}`);
          },
        ],
      ]),
    );

    expect(runtime.invoke(['sim', 'Speed', '3'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'Speed=3',
    });
  });

  it('returns an arg-count error when `sim` is invoked without argv[1]', () => {
    const simDispatcher = createSimCommandDispatcher(createSimSubcommandTable());

    expect(simDispatcher(['sim'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'sim command requires a subcommand in argv[1]',
    });
  });

  it('returns a typed unknown-subcommand error when lookup misses', () => {
    const runtime = new ScriptRuntime();
    registerSimCommand(
      runtime,
      createSimSubcommandTable([['Speed', () => makeScriptSuccess('3')]]),
    );

    expect(runtime.invoke(['sim', 'speed'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown sim subcommand: speed',
    });
  });

  it('overwrites duplicate subcommand registrations using last-entry-wins semantics', () => {
    // Mirrors `HASHED_CMD` + `Tcl_CreateHashEntry` behavior in
    // `ref/micropolis/src/sim/headers/macros.h`: duplicate command names update
    // existing hash entry `clientData`.
    const runtime = new ScriptRuntime();
    registerSimCommand(
      runtime,
      createSimSubcommandTable([
        ['Speed', () => makeScriptSuccess('first')],
        ['Speed', () => makeScriptSuccess('second')],
      ]),
    );

    expect(runtime.invoke(['sim', 'Speed'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'second',
    });
  });
});

describe('sim accessor subcommands', () => {
  it('supports read/write access for every `SIMCMD_ACCESS_INT` subcommand', () => {
    const runtime = new ScriptRuntime();
    const accessorState = createSimAccessorIntState();
    registerSimCommand(
      runtime,
      createSimSubcommandTable(createSimAccessorIntSubcommandEntries(accessorState)),
    );

    // Default values come from Micropolis globals:
    // `s_gen.c` (terrain levels), `w_tool.c` (tool/vote fields), `w_editor.c` (BobHeight).
    const cases = [
      { name: 'LakeLevel', initial: '-1', next: '11' },
      { name: 'TreeLevel', initial: '-1', next: '12' },
      { name: 'CurveLevel', initial: '-1', next: '13' },
      { name: 'CreateIsland', initial: '-1', next: '14' },
      { name: 'OverRide', initial: '0', next: '15' },
      { name: 'Expensive', initial: '1000', next: '16' },
      { name: 'Players', initial: '1', next: '17' },
      { name: 'Votes', initial: '0', next: '18' },
      { name: 'BobHeight', initial: '8', next: '19' },
      { name: 'PendingTool', initial: '-1', next: '20' },
      { name: 'PendingX', initial: '0', next: '21' },
      { name: 'PendingY', initial: '0', next: '22' },
    ] as const;

    for (const testCase of cases) {
      expect(runtime.invoke(['sim', testCase.name])).toEqual({
        code: ScriptResultCode.Ok,
        value: testCase.initial,
      });
      expect(runtime.invoke(['sim', testCase.name, testCase.next])).toEqual({
        code: ScriptResultCode.Ok,
        value: testCase.next,
      });
      expect(runtime.invoke(['sim', testCase.name])).toEqual({
        code: ScriptResultCode.Ok,
        value: testCase.next,
      });
    }
  });

  it('returns an arg-count error when an accessor is called with argc outside 2..3', () => {
    const runtime = new ScriptRuntime();
    const accessorState = createSimAccessorIntState();
    registerSimCommand(
      runtime,
      createSimSubcommandTable(createSimAccessorIntSubcommandEntries(accessorState)),
    );

    expect(runtime.invoke(['sim', 'LakeLevel', '1', '2'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'sim LakeLevel expects argc 2 or 3, got 4',
    });
  });

  it('returns an integer-parse error when accessor set value is invalid', () => {
    const runtime = new ScriptRuntime();
    const accessorState = createSimAccessorIntState();
    registerSimCommand(
      runtime,
      createSimSubcommandTable(createSimAccessorIntSubcommandEntries(accessorState)),
    );

    expect(runtime.invoke(['sim', 'LakeLevel', '12.5'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sim LakeLevel expected a 32-bit integer at argv[2]: 12.5',
    });
    expect(runtime.invoke(['sim', 'LakeLevel', '2147483648'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sim LakeLevel expected a 32-bit integer at argv[2]: 2147483648',
    });
  });
});

describe('sim session control/redraw subcommands', () => {
  it('routes call-only session commands through `SIMCMD_CALL`-style hooks without kick', () => {
    const runtime = new ScriptRuntime();
    const calls: string[] = [];
    const kicks: string[] = [];
    const delayedUpdates: string[] = [];
    const kickState = createSimKickState();
    registerSimCommand(
      runtime,
      createSimSubcommandTable(
        createSimSessionControlSubcommandEntries({
          kickState,
          hooks: {
            onCall: (name) => {
              calls.push(name);
            },
            onKick: () => {
              kicks.push('kick');
            },
            onScheduleDelayedUpdate: () => {
              delayedUpdates.push('schedule');
            },
          },
        }),
      ),
    );

    // `SIMCMD_CALL(proc)` in `w_sim.c` does not validate argc and does not call
    // `Kick()`, so extra args are ignored and no delayed update is scheduled.
    expect(runtime.invoke(['sim', 'SaveCity'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(runtime.invoke(['sim', 'ReallyQuit', 'extra'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(calls).toEqual(['SaveCity', 'ReallyQuit']);
    expect(kicks).toEqual([]);
    expect(delayedUpdates).toEqual([]);
    expect(kickState.updateDelayed).toBe(false);
  });

  it('runs call+kick commands in C side-effect order and coalesces delayed update scheduling', () => {
    const runtime = new ScriptRuntime();
    const eventLog: string[] = [];
    const kickState = createSimKickState();
    registerSimCommand(
      runtime,
      createSimSubcommandTable(
        createSimSessionControlSubcommandEntries({
          kickState,
          hooks: {
            onCall: (name) => {
              eventLog.push(`call:${name}`);
            },
            onKick: () => {
              eventLog.push('kick');
            },
            onScheduleDelayedUpdate: () => {
              eventLog.push('schedule');
            },
          },
        }),
      ),
    );

    expect(runtime.invoke(['sim', 'UpdateMaps'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(runtime.invoke(['sim', 'Pause', 'ignored'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    // Mirrors `SIMCMD_CALL_KICK(proc)` in `w_sim.c` + `Kick()` in `w_tk.c`:
    // proc() runs first, `Kick()` runs each call, delayed scheduling only on
    // first transition from `UpdateDelayed=0` to `UpdateDelayed=1`.
    expect(eventLog).toEqual(['call:UpdateMaps', 'kick', 'schedule', 'call:Pause', 'kick']);
    expect(kickState.updateDelayed).toBe(true);
  });

  it('routes `Update` through `sim_update` hook without kick scheduling', () => {
    const runtime = new ScriptRuntime();
    const updates: string[] = [];
    const kicks: string[] = [];
    const delayedUpdates: string[] = [];
    registerSimCommand(
      runtime,
      createSimSubcommandTable(
        createSimSessionControlSubcommandEntries({
          hooks: {
            onUpdate: () => {
              updates.push('update');
            },
            onKick: () => {
              kicks.push('kick');
            },
            onScheduleDelayedUpdate: () => {
              delayedUpdates.push('schedule');
            },
          },
        }),
      ),
    );

    // `SimCmdUpdate` in `w_sim.c` directly calls `sim_update()` and also skips
    // argc validation.
    expect(runtime.invoke(['sim', 'Update'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(runtime.invoke(['sim', 'Update', 'extra'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(updates).toEqual(['update', 'update']);
    expect(kicks).toEqual([]);
    expect(delayedUpdates).toEqual([]);
  });
});

describe('sim speed/delay/skip/rest control subcommands', () => {
  it('applies C-parity speed clamp/setters and kick behavior for speed, skips, and delay', () => {
    const runtime = new ScriptRuntime();
    const state = createSimSpeedDelayControlState();
    const kickState = createSimKickState();
    const kickEvents: string[] = [];
    registerSimCommand(
      runtime,
      createSimSubcommandTable(
        createSimSpeedDelayControlSubcommandEntries({
          state,
          kickState,
          kickHooks: {
            onKick: () => {
              kickEvents.push('kick');
            },
            onScheduleDelayedUpdate: () => {
              kickEvents.push('schedule');
            },
          },
        }),
      ),
    );

    // `sim.c` initializes `sim_delay` to `50`, and `sim_init` + `setSpeed(0)`
    // produces effective speed `0` (`sim.c` / `w_util.c`).
    expect(runtime.invoke(['sim', 'Delay'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '50',
    });
    expect(runtime.invoke(['sim', 'Speed'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });

    // `SimCmdSpeed` accepts `0..7`, then `setSpeed` clamps to `0..3`.
    expect(runtime.invoke(['sim', 'Speed', '7'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '3',
    });
    expect(state.simMetaSpeed).toBe(3);
    expect(state.simSpeed).toBe(3);

    // `SimCmdSkips` calls `setSkips`, which always resets `sim_skip` to `0`.
    expect(runtime.invoke(['sim', 'Skip', '9'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '9',
    });
    expect(runtime.invoke(['sim', 'Skips', '4'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '4',
    });
    expect(runtime.invoke(['sim', 'Skip'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });

    expect(runtime.invoke(['sim', 'Delay', '12'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '12',
    });
    expect(runtime.invoke(['sim', 'NeedRest', '-2'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '-2',
    });

    // `SimCmdSpeed`, `SimCmdSkips`, and `SimCmdDelay` call `Kick()`; `Skip` and
    // `NeedRest` do not. Delayed scheduling coalesces after first kick.
    expect(kickEvents).toEqual(['kick', 'schedule', 'kick', 'kick']);
    expect(kickState.updateDelayed).toBe(true);
  });

  it('returns effective speed 0 when paused, matching `setSpeed` pause semantics', () => {
    const runtime = new ScriptRuntime();
    const state = createSimSpeedDelayControlState({
      // `sim.c` pause globals are interpreted by `setSpeed` in `w_util.c`.
      simPaused: true,
      simPausedSpeed: 3,
    });
    registerSimCommand(
      runtime,
      createSimSubcommandTable(createSimSpeedDelayControlSubcommandEntries({ state })),
    );

    expect(runtime.invoke(['sim', 'Speed', '2'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    expect(state.simMetaSpeed).toBe(2);
    expect(state.simPausedSpeed).toBe(2);
    expect(state.simSpeed).toBe(0);
  });

  it('enforces C-parity argc and range validation rules for speed/delay/skip/rest controls', () => {
    const runtime = new ScriptRuntime();
    registerSimCommand(
      runtime,
      createSimSubcommandTable(createSimSpeedDelayControlSubcommandEntries()),
    );

    expect(runtime.invoke(['sim', 'Speed', '-1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sim Speed expected an integer in range 0..7 at argv[2]: -1',
    });
    expect(runtime.invoke(['sim', 'Speed', '8'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sim Speed expected an integer in range 0..7 at argv[2]: 8',
    });
    expect(runtime.invoke(['sim', 'Skips', '-1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sim Skips expected a non-negative integer at argv[2]: -1',
    });
    expect(runtime.invoke(['sim', 'Skip', '-1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sim Skip expected a non-negative integer at argv[2]: -1',
    });
    expect(runtime.invoke(['sim', 'Delay', '-1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sim Delay expected a non-negative integer at argv[2]: -1',
    });

    // `SimCmdNeedRest` only does `Tcl_GetInt`, so negatives are valid.
    expect(runtime.invoke(['sim', 'NeedRest', '-9'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '-9',
    });

    expect(runtime.invoke(['sim', 'Delay', '1', '2'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'sim Delay expects argc 2 or 3, got 4',
    });
    expect(runtime.invoke(['sim', 'NeedRest', 'abc'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sim NeedRest expected a 32-bit integer at argv[2]: abc',
    });
  });

  it('is included in the default `sim` subcommand table registration', () => {
    const runtime = new ScriptRuntime();
    registerSimCommand(runtime);

    expect(runtime.invoke(['sim', 'Speed', '7'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '3',
    });
  });
});

describe('sim read-only getter subcommands', () => {
  it('returns formatted string values for read-only getter commands', () => {
    const runtime = new ScriptRuntime();
    const getterState = createSimReadOnlyGetterState({
      Displays: '{display0} {display1}',
      WorldX: 120,
      WorldY: 100,
      LandValue: 21,
      Traffic: 22,
      Crime: 23,
      Unemployment: 24,
      Fires: 25,
      Pollution: 26,
      PolMaxX: 2,
      PolMaxY: 3,
      TrafMaxX: 27,
      TrafMaxY: 28,
      MeltX: 4,
      MeltY: 5,
      CrimeMaxX: 6,
      CrimeMaxY: 7,
      CenterX: 8,
      CenterY: 9,
      FloodX: 10,
      FloodY: 11,
      CrashX: 12,
      CrashY: 13,
      Platform: 'unix',
      Version: '4.0',
      MultiPlayerMode: 1,
      SugarMode: 1,
    });
    registerSimCommand(
      runtime,
      createSimSubcommandTable(createSimReadOnlyGetterSubcommandEntries(getterState)),
    );

    // `w_sim.c` formats these coordinate getters as `(tile << 4) + 8`.
    const cases = [
      { name: 'Displays', value: '{display0} {display1}' },
      { name: 'WorldX', value: '120' },
      { name: 'WorldY', value: '100' },
      { name: 'LandValue', value: '21' },
      { name: 'Traffic', value: '22' },
      { name: 'Crime', value: '23' },
      { name: 'Unemployment', value: '24' },
      { name: 'Fires', value: '25' },
      { name: 'Pollution', value: '26' },
      { name: 'PolMaxX', value: String((2 << 4) + 8) },
      { name: 'PolMaxY', value: String((3 << 4) + 8) },
      { name: 'TrafMaxX', value: '27' },
      { name: 'TrafMaxY', value: '28' },
      { name: 'MeltX', value: String((4 << 4) + 8) },
      { name: 'MeltY', value: String((5 << 4) + 8) },
      { name: 'CrimeMaxX', value: String((6 << 4) + 8) },
      { name: 'CrimeMaxY', value: String((7 << 4) + 8) },
      { name: 'CenterX', value: String((8 << 4) + 8) },
      { name: 'CenterY', value: String((9 << 4) + 8) },
      { name: 'FloodX', value: String((10 << 4) + 8) },
      { name: 'FloodY', value: String((11 << 4) + 8) },
      { name: 'CrashX', value: String((12 << 4) + 8) },
      { name: 'CrashY', value: String((13 << 4) + 8) },
      { name: 'Platform', value: 'unix' },
      { name: 'Version', value: '4.0' },
      { name: 'MultiPlayerMode', value: '1' },
      { name: 'SugarMode', value: '1' },
    ] as const;

    for (const testCase of cases) {
      expect(runtime.invoke(['sim', testCase.name])).toEqual({
        code: ScriptResultCode.Ok,
        value: testCase.value,
      });
    }
  });

  it('enforces argc only for getters that validate argc in `w_sim.c`', () => {
    const runtime = new ScriptRuntime();
    const getterState = createSimReadOnlyGetterState({
      Displays: '{display0}',
      Platform: 'unix',
      Version: '4.0',
    });
    registerSimCommand(
      runtime,
      createSimSubcommandTable(createSimReadOnlyGetterSubcommandEntries(getterState)),
    );

    // `SIMCMD_GET_STR(Displays)` and `SimCmdPlatform/SimCmdVersion` skip argc
    // checks in `w_sim.c`, while explicit getters like `WorldX` require argc 2.
    expect(runtime.invoke(['sim', 'Displays', 'extra'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '{display0}',
    });
    expect(runtime.invoke(['sim', 'Platform', 'extra'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'unix',
    });
    expect(runtime.invoke(['sim', 'Version', 'extra'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '4.0',
    });
    expect(runtime.invoke(['sim', 'WorldX', 'extra'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'sim WorldX expects argc 2, got 3',
    });
    expect(runtime.invoke(['sim', 'MultiPlayerMode', 'extra'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'sim MultiPlayerMode expects argc 2, got 3',
    });
  });

  it('is included in the default `sim` subcommand table registration', () => {
    const runtime = new ScriptRuntime();
    registerSimCommand(runtime);

    // Defaults match `headers/sim.h` (`WORLD_X=120`, `WORLD_Y=100`) and
    // coordinate getters in `w_sim.c` use `(tile << 4) + 8`, so tile `0` => `8`.
    expect(runtime.invoke(['sim', 'WorldX'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '120',
    });
    expect(runtime.invoke(['sim', 'WorldY'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '100',
    });
    expect(runtime.invoke(['sim', 'PolMaxX'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '8',
    });
  });
});
