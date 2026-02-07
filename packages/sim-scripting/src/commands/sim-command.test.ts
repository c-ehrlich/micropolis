import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import {
  createSimAccessorIntState,
  createSimAccessorIntSubcommandEntries,
  createSimCommandDispatcher,
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
