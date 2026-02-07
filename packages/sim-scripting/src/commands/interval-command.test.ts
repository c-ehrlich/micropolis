import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { WidgetRegistry } from '../state/widget-registry.ts';
import {
  createIntervalCommandDispatcher,
  createIntervalState,
  createIntervalSubcommandTable,
  createIntervalWidgetCommandDispatcher,
  type IntervalState,
} from './interval-command.ts';

describe('interval top-level command shell', () => {
  it('creates a named interval command and applies creation-time configure options', () => {
    const runtime = new ScriptRuntime();
    const widgets = new WidgetRegistry<IntervalState>();
    runtime.registerCommand(
      'interval',
      createIntervalCommandDispatcher({
        runtime,
        widgets,
      }),
    );

    expect(
      runtime.invoke([
        'interval',
        '.interval.main',
        '-from',
        '10',
        '-to',
        '50',
        '-min',
        '0',
        '-max',
        '9999',
      ]),
    ).toEqual({
      code: ScriptResultCode.Ok,
      value: '.interval.main',
    });

    const created = widgets.get('.interval.main');
    expect(created).toBeDefined();
    if (created === undefined) {
      throw new Error('expected interval state to be registered');
    }

    // `ConfigureInterval` calls `SetInterval(min, max, 0)` after config parsing
    // (`ref/micropolis/src/sim/w_inter.c`), so `-min 0 -max 9999` clamps to
    // the configured `-from/-to` range and becomes `10 50`.
    expect(runtime.invoke(['.interval.main', 'get'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '10 50',
    });
  });

  it('returns typed errors for duplicate names and creation-time configure parse failures', () => {
    const runtime = new ScriptRuntime();
    const dispatcher = createIntervalCommandDispatcher({ runtime });

    expect(dispatcher(['interval', '.interval.main'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '.interval.main',
    });

    expect(dispatcher(['interval', '.interval.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: 'interval command already exists: .interval.main',
    });

    expect(dispatcher(['interval'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'interval command requires a pathName in argv[1]',
    });

    expect(dispatcher(['interval', '.interval.odd', '-from'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'interval .interval.odd configure expects option/value pairs, got 1 trailing args',
    });

    expect(dispatcher(['interval', '.interval.bad-int', '-from', '12.5'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'interval .interval.bad-int configure expected an integer from value: 12.5',
    });
  });
});

describe('interval widget command shell', () => {
  it('dispatches interval subcommands with case-sensitive lookup', () => {
    const intervalState = createIntervalState('.interval.main');
    const dispatcher = createIntervalWidgetCommandDispatcher(intervalState);

    expect(dispatcher(['.interval.main', 'configure'])).toEqual({
      code: ScriptResultCode.Ok,
      value:
        '-activeforeground #ffaeb9 -background #eed5b7 -borderwidth 2 -command  -cursor  -font -Adobe-Helvetica-Bold-R-Normal-*-120-* -foreground Black -from 0 -label  -length 100 -orient vertical -relief flat -showvalue 1 -sliderforeground #cdb79e -min 0 -max 100 -state normal -tickinterval 0 -to 100 -width 15',
    });

    expect(dispatcher(['.interval.main', 'configure', '-state', 'disabled'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(dispatcher(['.interval.main', 'configure', '-state'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'disabled',
    });

    expect(dispatcher(['.interval.main', 'Set'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown interval subcommand: Set',
    });
  });

  it('implements set/reset min-max parity: swap, clamp, disabled set no-op, and reset', () => {
    const intervalState = createIntervalState('.interval.main');
    const dispatcher = createIntervalWidgetCommandDispatcher(intervalState);

    // `IntervalWidgetCmd set` swaps `min/max` when `min > max` before clamping.
    // Source: `ref/micropolis/src/sim/w_inter.c`.
    expect(dispatcher(['.interval.main', 'set', '90', '10'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.interval.main', 'get'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '10 90',
    });

    // `set` clamps both ends to `from/to` through the same XOR logic as
    // `SetInterval` in `w_inter.c`.
    expect(dispatcher(['.interval.main', 'set', '-5', '200'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.interval.main', 'get'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0 100',
    });

    // Disabled state blocks `set` updates (`if (state == normal) { ... }`).
    expect(dispatcher(['.interval.main', 'configure', '-state', 'disabled'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.interval.main', 'set', '30', '40'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.interval.main', 'get'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0 100',
    });

    // `reset` always applies `SetInterval(from, to, 0)`, even while disabled.
    expect(dispatcher(['.interval.main', 'configure', '-from', '75', '-to', '25'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.interval.main', 'reset'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.interval.main', 'get'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '25 75',
    });
  });

  it('normalizes tick interval sign against from/to direction like ConfigureInterval', () => {
    const intervalState = createIntervalState('.interval.main');
    const dispatcher = createIntervalWidgetCommandDispatcher(intervalState);

    expect(
      dispatcher(['.interval.main', 'configure', '-from', '100', '-to', '0', '-tickinterval', '5']),
    ).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.interval.main', 'configure', '-tickinterval'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '-5',
    });
  });

  it('returns typed failures for argc and parse/validation errors', () => {
    const intervalState = createIntervalState('.interval.main');
    const dispatcher = createIntervalWidgetCommandDispatcher(intervalState);

    expect(dispatcher(['.interval.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.interval.main command requires a subcommand in argv[1]',
    });

    expect(dispatcher(['.interval.main', 'get', 'extra'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.interval.main get expects argc 2, got 3',
    });

    expect(dispatcher(['.interval.main', 'set', 'x', '1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.interval.main set expected an integer min: x',
    });

    expect(dispatcher(['.interval.main', 'reset', 'extra'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.interval.main reset expects argc 2, got 3',
    });

    expect(dispatcher(['.interval.main', 'configure', '-orient', 'diag'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: '.interval.main configure bad orientation "diag": must be vertical or horizontal',
    });

    expect(dispatcher(['.interval.main', 'configure', '-state', 'paused'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: '.interval.main configure bad state value "paused":  must be normal or disabled',
    });

    // `ConfigureInterval` assigns `state = normal` before returning error on
    // invalid state text in `w_inter.c`.
    expect(dispatcher(['.interval.main', 'configure', '-state'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'normal',
    });
  });

  it('uses last-entry-wins semantics for duplicate subcommand registrations', () => {
    const intervalState = createIntervalState('.interval.main');
    const subcommandTable = createIntervalSubcommandTable([
      ['get', () => makeScriptSuccess('0 0')],
      ['get', () => makeScriptSuccess('1 1')],
    ]);
    const dispatcher = createIntervalWidgetCommandDispatcher(intervalState, subcommandTable);

    expect(dispatcher(['.interval.main', 'get'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1 1',
    });
  });
});
