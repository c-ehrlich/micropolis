import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { ViewRegistry } from '../state/view-registry.ts';
import {
  createGraphViewCommandDispatcher,
  createGraphViewRedrawState,
  createGraphViewState,
  createGraphViewSubcommandEntries,
  createGraphViewSubcommandTable,
  createGraphViewWidgetCommandDispatcher,
  type GraphViewState,
} from './graphview-command.ts';

describe('graphview top-level command shell', () => {
  it('creates a named graph view command and applies creation-time configure options', () => {
    const runtime = new ScriptRuntime();
    const views = new ViewRegistry<GraphViewState>();
    runtime.registerCommand(
      'graphview',
      createGraphViewCommandDispatcher({
        runtime,
        views,
      }),
    );

    expect(
      runtime.invoke([
        'graphview',
        '.graph.main',
        '-font',
        'MicropolisMono',
        '-background',
        '#112233',
        '-borderwidth',
        '4',
        '-relief',
        'ridge',
      ]),
    ).toEqual({
      code: ScriptResultCode.Ok,
      value: '.graph.main',
    });

    const created = views.get('.graph.main');
    expect(created).toBeDefined();
    if (created === undefined) {
      throw new Error('expected graph view state to be registered');
    }

    expect(created.configure.font).toBe('MicropolisMono');
    expect(created.configure.background).toBe('#112233');
    expect(created.configure.borderWidth).toBe(4);
    expect(created.configure.relief).toBe('ridge');

    // `InitNewGraph` sets `w_x/w_y = 0`, `range = 10`, and `visible = 0`.
    // `DoResizeGraph(graph, 16, 16)` sets default `w_width/w_height`.
    // Source: `ref/micropolis/src/sim/w_graph.c`.
    expect(runtime.invoke(['.graph.main', 'position'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0 0',
    });
    expect(runtime.invoke(['.graph.main', 'size'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '16 16',
    });
    expect(runtime.invoke(['.graph.main', 'Visible'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    expect(runtime.invoke(['.graph.main', 'Range'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '10',
    });

    // `ALL_HISTORIES` is `(1 << HISTORIES) - 1` in `sim.h`.
    // `HISTORIES` is `6`, so the default graph mask is `63`.
    expect(runtime.invoke(['.graph.main', 'Mask'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '63',
    });
  });

  it('returns typed errors for duplicate view names and creation-time configure parse failures', () => {
    const runtime = new ScriptRuntime();
    const dispatcher = createGraphViewCommandDispatcher({ runtime });

    expect(dispatcher(['graphview', '.graph.main'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '.graph.main',
    });

    expect(dispatcher(['graphview', '.graph.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: 'graphview command already exists: .graph.main',
    });

    expect(dispatcher(['graphview'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'graphview command requires a pathName in argv[1]',
    });

    expect(dispatcher(['graphview', '.graph.odd', '-font'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'graphview .graph.odd configure expects option/value pairs, got 1 trailing args',
    });

    expect(dispatcher(['graphview', '.graph.bad-int', '-borderwidth', '12.5'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'graphview .graph.bad-int configure expected an integer border width: 12.5',
    });
  });
});

describe('graphview widget command shell', () => {
  it('dispatches graph subcommands with case-sensitive lookup', () => {
    const viewState = createGraphViewState('.graph.main');
    const dispatcher = createGraphViewWidgetCommandDispatcher(viewState);

    expect(dispatcher(['.graph.main', 'configure'])).toEqual({
      code: ScriptResultCode.Ok,
      value:
        '-font -Adobe-Helvetica-Bold-R-Normal-*-140-* -background #b0b0b0 -borderwidth 0 -relief flat',
    });

    expect(dispatcher(['.graph.main', 'configure', '-font', 'Chicago'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(dispatcher(['.graph.main', 'configure', '-font'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'Chicago',
    });

    expect(dispatcher(['.graph.main', 'Size'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown graphview subcommand: Size',
    });
  });

  it('parses Tcl-style integers for position and size like GraphCmdposition/GraphCmdsize', () => {
    const viewState = createGraphViewState('.graph.main');
    const dispatcher = createGraphViewWidgetCommandDispatcher(viewState);

    // `GraphCmdposition`/`GraphCmdsize` use `Tcl_GetInt` in `w_graph.c`,
    // which accepts hex and leading-zero octal forms.
    expect(dispatcher(['.graph.main', 'position', '0x10', '010'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '16 8',
    });

    expect(dispatcher(['.graph.main', 'size', '-64', '0200'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '-64 128',
    });
  });

  it('implements Visible, Range, and Mask behavior with NewGraph side effects like w_graph.c', () => {
    const viewState = createGraphViewState('.graph.main');
    const redrawState = createGraphViewRedrawState();
    const redrawEvents: Array<readonly [string, 'Range' | 'Mask']> = [];
    const subcommandTable = createGraphViewSubcommandTable(
      createGraphViewSubcommandEntries({
        redrawState,
        hooks: {
          onMarkNewGraph: (view, source) => {
            redrawEvents.push([view.commandName, source] as const);
          },
        },
      }),
    );
    const dispatcher = createGraphViewWidgetCommandDispatcher(viewState, subcommandTable);

    expect(dispatcher(['.graph.main', 'Visible', '1'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });
    expect(redrawState.newGraph).toBe(false);

    expect(dispatcher(['.graph.main', 'Range', '120'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '120',
    });
    expect(redrawState.newGraph).toBe(true);
    expect(redrawEvents).toEqual([['.graph.main', 'Range']]);

    redrawState.newGraph = false;
    expect(dispatcher(['.graph.main', 'Mask', '0x3f'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '63',
    });
    expect(redrawState.newGraph).toBe(true);
    expect(redrawEvents).toEqual([
      ['.graph.main', 'Range'],
      ['.graph.main', 'Mask'],
    ]);
  });

  it('returns typed failures for argc, ranges, and parse errors in graph commands', () => {
    const viewState = createGraphViewState('.graph.main');
    const dispatcher = createGraphViewWidgetCommandDispatcher(viewState);

    expect(dispatcher(['.graph.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.graph.main command requires a subcommand in argv[1]',
    });

    expect(dispatcher(['.graph.main', 'position', 'x', '1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.graph.main position expected an integer x: x',
    });

    expect(dispatcher(['.graph.main', 'size', '1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.graph.main size expects argc 2 or 4, got 3',
    });

    expect(dispatcher(['.graph.main', 'Visible', '2'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.graph.main Visible expected an integer visible in range 0..1: 2',
    });

    expect(dispatcher(['.graph.main', 'Range', '11'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.graph.main Range expected an integer range of 10 or 120: 11',
    });

    expect(dispatcher(['.graph.main', 'Mask', '64'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.graph.main Mask expected an integer mask in range 0..63: 64',
    });
  });

  it('uses last-entry-wins semantics for duplicate subcommand registrations', () => {
    const viewState = createGraphViewState('.graph.main');
    const subcommandTable = createGraphViewSubcommandTable([
      ['Visible', () => makeScriptSuccess('0')],
      ['Visible', () => makeScriptSuccess('1')],
    ]);
    const dispatcher = createGraphViewWidgetCommandDispatcher(viewState, subcommandTable);

    expect(dispatcher(['.graph.main', 'Visible'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });
  });
});
