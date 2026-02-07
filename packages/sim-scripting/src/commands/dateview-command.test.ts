import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { ViewRegistry } from '../state/view-registry.ts';
import {
  createDateViewCommandDispatcher,
  createDateViewState,
  createDateViewSubcommandEntries,
  createDateViewSubcommandTable,
  createDateViewWidgetCommandDispatcher,
  type DateViewState,
} from './dateview-command.ts';

describe('dateview top-level command shell', () => {
  it('creates a named date view command and applies creation-time configure options', () => {
    const runtime = new ScriptRuntime();
    const views = new ViewRegistry<DateViewState>();
    runtime.registerCommand(
      'dateview',
      createDateViewCommandDispatcher({
        runtime,
        views,
      }),
    );

    expect(
      runtime.invoke([
        'dateview',
        '.date.main',
        '-font',
        'MicropolisMono',
        '-background',
        '#112233',
        '-borderwidth',
        '4',
        '-padx',
        '3',
        '-pady',
        '2',
        '-width',
        '24',
        '-monthtab',
        '8',
        '-yeartab',
        '15',
      ]),
    ).toEqual({
      code: ScriptResultCode.Ok,
      value: '.date.main',
    });

    const created = views.get('.date.main');
    expect(created).toBeDefined();
    if (created === undefined) {
      throw new Error('expected date view state to be registered');
    }

    expect(created.configure.font).toBe('MicropolisMono');
    expect(created.configure.background).toBe('#112233');
    expect(created.configure.borderWidth).toBe(4);
    expect(created.configure.padX).toBe(3);
    expect(created.configure.padY).toBe(2);
    expect(created.configure.width).toBe(24);
    expect(created.configure.monthTab).toBe(8);
    expect(created.configure.yearTab).toBe(15);

    // `InitNewDate` sets `visible = 0`, `month = 0`, `year = 0`, and `reset = 1`.
    // `DoResizeDate(date, 16, 16)` sets default `w_width/w_height`.
    // Source: `ref/micropolis/src/sim/w_date.c`.
    expect(runtime.invoke(['.date.main', 'position'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0 0',
    });
    expect(runtime.invoke(['.date.main', 'size'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '16 16',
    });
    expect(runtime.invoke(['.date.main', 'Visible'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
  });

  it('returns typed errors for duplicate view names and creation-time configure parse failures', () => {
    const runtime = new ScriptRuntime();
    const dispatcher = createDateViewCommandDispatcher({ runtime });

    expect(dispatcher(['dateview', '.date.main'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '.date.main',
    });

    expect(dispatcher(['dateview', '.date.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: 'dateview command already exists: .date.main',
    });

    expect(dispatcher(['dateview'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'dateview command requires a pathName in argv[1]',
    });

    expect(dispatcher(['dateview', '.date.odd', '-font'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'dateview .date.odd configure expects option/value pairs, got 1 trailing args',
    });

    expect(dispatcher(['dateview', '.date.bad-int', '-monthtab', '12.5'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'dateview .date.bad-int configure expected an integer month tab: 12.5',
    });
  });
});

describe('dateview widget command shell', () => {
  it('dispatches date subcommands with case-sensitive lookup', () => {
    const viewState = createDateViewState('.date.main');
    const dispatcher = createDateViewWidgetCommandDispatcher(viewState);

    expect(dispatcher(['.date.main', 'configure'])).toEqual({
      code: ScriptResultCode.Ok,
      value:
        '-font -Adobe-Helvetica-Bold-R-Normal-*-140-* -background #b0b0b0 -borderwidth 2 -padx 1 -pady 1 -width 0 -monthtab 7 -yeartab 13',
    });

    expect(dispatcher(['.date.main', 'configure', '-font', 'Chicago'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(dispatcher(['.date.main', 'configure', '-font'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'Chicago',
    });

    expect(dispatcher(['.date.main', 'Size'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown dateview subcommand: Size',
    });
  });

  it('parses Tcl-style integers for position and size like DateCmdposition/DateCmdsize', () => {
    const viewState = createDateViewState('.date.main');
    const dispatcher = createDateViewWidgetCommandDispatcher(viewState);

    // `DateCmdposition`/`DateCmdsize` use `Tcl_GetInt` in `w_date.c`,
    // so hex and leading-zero octal inputs are accepted.
    expect(dispatcher(['.date.main', 'position', '0x10', '010'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '16 8',
    });

    expect(dispatcher(['.date.main', 'size', '-64', '0200'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '-64 128',
    });
  });

  it('implements Visible/Reset/Set with redraw scheduling hooks like w_date.c', () => {
    const viewState = createDateViewState('.date.main', {
      reset: 0,
      redrawPending: false,
    });
    const redrawEvents: Array<readonly [string, 'Reset' | 'Set']> = [];
    const subcommandTable = createDateViewSubcommandTable(
      createDateViewSubcommandEntries({
        hooks: {
          onScheduleRedraw: (view, source) => {
            redrawEvents.push([view.commandName, source] as const);
          },
        },
      }),
    );
    const dispatcher = createDateViewWidgetCommandDispatcher(viewState, subcommandTable);

    expect(dispatcher(['.date.main', 'Visible', '1'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });
    expect(redrawEvents).toEqual([]);

    expect(dispatcher(['.date.main', 'Reset'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(viewState.reset).toBe(1);
    expect(viewState.redrawPending).toBe(true);
    expect(redrawEvents).toEqual([['.date.main', 'Reset']]);

    viewState.redrawPending = false;
    expect(dispatcher(['.date.main', 'Set', '0x0', '01750'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    // `DateCmdSet` enforces month `0..11` and year `>= 0`; Tcl octal parsing
    // means `01750` is decimal `1000` in `w_date.c`.
    expect(viewState.month).toBe(0);
    expect(viewState.year).toBe(1000);
    expect(viewState.redrawPending).toBe(true);
    expect(redrawEvents).toEqual([
      ['.date.main', 'Reset'],
      ['.date.main', 'Set'],
    ]);
  });

  it('returns typed failures for argc, ranges, and parse errors in date commands', () => {
    const viewState = createDateViewState('.date.main');
    const dispatcher = createDateViewWidgetCommandDispatcher(viewState);

    expect(dispatcher(['.date.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.date.main command requires a subcommand in argv[1]',
    });

    expect(dispatcher(['.date.main', 'position', 'x', '1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.date.main position expected an integer x: x',
    });

    expect(dispatcher(['.date.main', 'size', '1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.date.main size expects argc 2 or 4, got 3',
    });

    expect(dispatcher(['.date.main', 'Visible', '2'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.date.main Visible expected an integer visible in range 0..1: 2',
    });

    expect(dispatcher(['.date.main', 'Reset', 'extra'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.date.main Reset expects argc 2, got 3',
    });

    expect(dispatcher(['.date.main', 'Set', '12', '1000'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.date.main Set expected an integer month in range 0..11: 12',
    });

    expect(dispatcher(['.date.main', 'Set', '11', '-1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.date.main Set expected an integer year >= 0: -1',
    });
  });

  it('uses last-entry-wins semantics for duplicate subcommand registrations', () => {
    const viewState = createDateViewState('.date.main');
    const subcommandTable = createDateViewSubcommandTable([
      ['Visible', () => makeScriptSuccess('0')],
      ['Visible', () => makeScriptSuccess('1')],
    ]);
    const dispatcher = createDateViewWidgetCommandDispatcher(viewState, subcommandTable);

    expect(dispatcher(['.date.main', 'Visible'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });
  });
});
