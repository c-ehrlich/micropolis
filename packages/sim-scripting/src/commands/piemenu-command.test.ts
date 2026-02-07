import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { WidgetRegistry } from '../state/widget-registry.ts';
import {
  createPieMenuCommandDispatcher,
  createPieMenuState,
  createPieMenuSubcommandEntries,
  createPieMenuSubcommandTable,
  createPieMenuWidgetCommandDispatcher,
  type PieMenuState,
} from './piemenu-command.ts';

describe('piemenu top-level command shell', () => {
  it('creates a named pie menu command and applies creation-time configure options', () => {
    const runtime = new ScriptRuntime();
    const widgets = new WidgetRegistry<PieMenuState>();
    runtime.registerCommand(
      'piemenu',
      createPieMenuCommandDispatcher({
        runtime,
        widgets,
      }),
    );

    expect(
      runtime.invoke([
        'piemenu',
        '.pie.main',
        '-title',
        'Build',
        '-font',
        'MicropolisPie',
        '-activeforeground',
        '#112233',
        '-popupdelay',
        '0500',
        '-active',
        '0x2',
      ]),
    ).toEqual({
      code: ScriptResultCode.Ok,
      value: '.pie.main',
    });

    const created = widgets.get('.pie.main');
    expect(created).toBeDefined();
    if (created === undefined) {
      throw new Error('expected pie menu state to be registered');
    }

    expect(created.configure.title).toBe('Build');
    expect(created.configure.font).toBe('MicropolisPie');
    expect(created.configure.activeForeground).toBe('#112233');
    // `PIE_POPUP_DELAY` is `"250"` in `ref/micropolis/src/sim/w_piem.c`.
    // `Tcl_GetInt` parsing in C accepts octal, so `0500` stores decimal 320.
    expect(created.configure.popupDelay).toBe(320);
    expect(created.active).toBe(2);

    // `PIE_MIN_RADIUS` and `PIE_SHAPED` defaults are `16` and `1` in
    // `ref/micropolis/src/sim/w_piem.c` config defaults.
    expect(runtime.invoke(['.pie.main', 'configure', '-minradius'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '16',
    });
    expect(runtime.invoke(['.pie.main', 'configure', '-shaped'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });
  });

  it('returns typed errors for duplicate names and creation-time configure parse failures', () => {
    const runtime = new ScriptRuntime();
    const dispatcher = createPieMenuCommandDispatcher({ runtime });

    expect(dispatcher(['piemenu', '.pie.main'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '.pie.main',
    });

    expect(dispatcher(['piemenu', '.pie.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: 'piemenu command already exists: .pie.main',
    });

    expect(dispatcher(['piemenu'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'piemenu command requires a pathName in argv[1]',
    });

    expect(dispatcher(['piemenu', '.pie.odd', '-title'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'piemenu .pie.odd configure expects option/value pairs, got 1 trailing args',
    });

    expect(dispatcher(['piemenu', '.pie.bad-int', '-popupdelay', '12.5'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'piemenu .pie.bad-int configure expected an integer popup delay: 12.5',
    });
  });
});

describe('piemenu widget command shell', () => {
  it('dispatches pie menu subcommands with case-sensitive lookup', () => {
    const menuState = createPieMenuState('.pie.main');
    const dispatcher = createPieMenuWidgetCommandDispatcher(menuState);

    expect(dispatcher(['.pie.main', 'configure'])).toEqual({
      code: ScriptResultCode.Ok,
      value:
        '-activebackground #bfbfbf -activeborderwidth 2 -activeforeground black -background #bfbfbf -borderwidth 2 -cursor circle -foreground black -font -Adobe-Helvetica-Bold-R-Normal-*-120-* -title  -preview  -titlefont -Adobe-Helvetica-Bold-R-Normal-*-120-* -initialangle 0 -inactiveradius 8 -minradius 16 -extraradius 2 -fixedradius 0 -active -1 -popupdelay 250 -shaped 1',
    });

    expect(dispatcher(['.pie.main', 'configure', '-bd', '6'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(dispatcher(['.pie.main', 'configure', '-borderwidth'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '6',
    });

    expect(dispatcher(['.pie.main', 'Configure'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown piemenu subcommand: Configure',
    });
  });

  it('implements add/delete/entryconfigure state transitions from PieMenuWidgetCmd', () => {
    const menuState = createPieMenuState('.pie.main');
    const dispatcher = createPieMenuWidgetCommandDispatcher(menuState);

    expect(
      dispatcher([
        '.pie.main',
        'add',
        'command',
        '-label',
        'Road',
        '-command',
        'DoRoad',
        '-xoffset',
        '0x10',
      ]),
    ).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(
      dispatcher([
        '.pie.main',
        'add',
        'piemenu',
        '-label',
        'Utilities',
        '-piemenu',
        '.pie.util',
        '-yoffset',
        '010',
      ]),
    ).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(menuState.entries).toHaveLength(2);
    expect(menuState.entries[0]?.type).toBe('command');
    expect(menuState.entries[0]?.xOffset).toBe(16);
    expect(menuState.entries[1]?.type).toBe('piemenu');
    expect(menuState.entries[1]?.yOffset).toBe(8);

    expect(dispatcher(['.pie.main', 'entryconfigure', '1', '-label'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'Utilities',
    });

    expect(
      dispatcher(['.pie.main', 'entryconfigure', '1', '-label', 'Power', '-yoffset', '12']),
    ).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(menuState.entries[1]?.label).toBe('Power');
    expect(menuState.entries[1]?.yOffset).toBe(12);

    expect(dispatcher(['.pie.main', 'configure', '-active', '1'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(menuState.active).toBe(1);

    expect(dispatcher(['.pie.main', 'delete', 'active'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(menuState.entries).toHaveLength(1);
    expect(menuState.active).toBe(-1);
  });

  it('implements index parsing forms used by GetPieMenuIndex', () => {
    const menuState = createPieMenuState('.pie.main', {
      active: 1,
      entries: [
        {
          type: 'command',
          label: 'Road',
          command: 'DoRoad',
          preview: null,
          piemenu: null,
          bitmap: null,
          font: null,
          background: null,
          activeBackground: null,
          xOffset: 0,
          yOffset: 0,
        },
        {
          type: 'command',
          label: 'Rail',
          command: 'DoRail',
          preview: null,
          piemenu: null,
          bitmap: null,
          font: null,
          background: null,
          activeBackground: null,
          xOffset: 0,
          yOffset: 0,
        },
      ],
    });

    const subcommands = createPieMenuSubcommandTable(
      createPieMenuSubcommandEntries({
        hooks: {
          resolveIndexAtCoordinates: (_menu, x, y) => {
            if (x === 10 && y === 20) {
              return 0;
            }
            return -1;
          },
        },
      }),
    );
    const dispatcher = createPieMenuWidgetCommandDispatcher(menuState, subcommands);

    expect(dispatcher(['.pie.main', 'index', 'active'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });
    expect(dispatcher(['.pie.main', 'index', 'last'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });
    expect(dispatcher(['.pie.main', 'index', 'none'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'none',
    });

    // `GetPieMenuIndex` delegates label matching to `Tcl_StringMatch`
    // in `ref/micropolis/src/sim/w_piem.c`, so glob patterns are accepted.
    expect(dispatcher(['.pie.main', 'index', 'Ra*'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });
    expect(dispatcher(['.pie.main', 'index', '@10,20'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });

    // Numeric indices only parse when the first character is a digit in C.
    expect(dispatcher(['.pie.main', 'index', '01'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });
  });

  it('returns typed failures for argc/parse/option errors in pie menu commands', () => {
    const menuState = createPieMenuState('.pie.main');
    const dispatcher = createPieMenuWidgetCommandDispatcher(menuState);

    expect(dispatcher(['.pie.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.pie.main command requires a subcommand in argv[1]',
    });

    expect(dispatcher(['.pie.main', 'add'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.pie.main add expects argc >= 3, got 2',
    });

    expect(dispatcher(['.pie.main', 'add', 'widget'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: 'bad menu entry type "widget":  must be command or piemenu',
    });

    expect(dispatcher(['.pie.main', 'entryconfigure'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.pie.main entryconfigure expects argc >= 3, got 2',
    });

    expect(dispatcher(['.pie.main', 'delete', '42'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: 'bad menu entry index "42"',
    });

    expect(dispatcher(['.pie.main', 'index', '@x,y'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: 'bad menu entry index "@x,y"',
    });

    expect(dispatcher(['.pie.main', 'index'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.pie.main index expects argc 3, got 2',
    });
  });

  it('uses last-entry-wins semantics for duplicate subcommand registrations', () => {
    const menuState = createPieMenuState('.pie.main');
    const subcommandTable = createPieMenuSubcommandTable([
      ['index', () => makeScriptSuccess('0')],
      ['index', () => makeScriptSuccess('1')],
    ]);
    const dispatcher = createPieMenuWidgetCommandDispatcher(menuState, subcommandTable);

    expect(dispatcher(['.pie.main', 'index', 'none'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });
  });
});
