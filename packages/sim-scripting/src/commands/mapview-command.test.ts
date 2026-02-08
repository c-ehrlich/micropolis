import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { ViewRegistry } from '../state/view-registry.ts';
import {
  createMapViewCommandDispatcher,
  createMapViewState,
  createMapViewSubcommandEntries,
  createMapViewSubcommandTable,
  createMapViewWidgetCommandDispatcher,
  type MapViewState,
} from './mapview-command.ts';
import { createSimKickState } from './sim-command.ts';

describe('mapview top-level command shell', () => {
  it('creates a named map view command and applies creation-time configure options', () => {
    const runtime = new ScriptRuntime();
    const views = new ViewRegistry<MapViewState>();
    runtime.registerCommand(
      'mapview',
      createMapViewCommandDispatcher({
        runtime,
        views,
      }),
    );

    expect(
      runtime.invoke([
        'mapview',
        '.map.main',
        '-width',
        '320',
        '-height',
        '200',
        '-font',
        'MicropolisMono',
        '-messagevar',
        'statusVar',
      ]),
    ).toEqual({
      code: ScriptResultCode.Ok,
      value: '.map.main',
    });

    const created = views.get('.map.main');
    expect(created).toBeDefined();
    if (created === undefined) {
      throw new Error('expected map view state to be registered');
    }

    expect(created.configure.width).toBe(320);
    expect(created.configure.height).toBe(200);
    expect(created.configure.font).toBe('MicropolisMono');
    expect(created.configure.messageVar).toBe('statusVar');

    // `InitNewView` initializes `w_x/w_y = 0` and `map_state = ALMAP (0)`
    // in `ref/micropolis/src/sim/w_x.c`.
    expect(runtime.invoke(['.map.main', 'position'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0 0',
    });
    expect(runtime.invoke(['.map.main', 'MapState'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });

    // `MAP_W` and `MAP_H` are `WORLD_X * 3` and `WORLD_Y * 3`
    // in `ref/micropolis/src/sim/headers/sim.h` (`WORLD_X=120`, `WORLD_Y=100`).
    expect(runtime.invoke(['.map.main', 'size'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '360 300',
    });
  });

  it('returns typed errors for duplicate view names and creation-time configure parse failures', () => {
    const runtime = new ScriptRuntime();
    const dispatcher = createMapViewCommandDispatcher({ runtime });

    expect(dispatcher(['mapview', '.map.main'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '.map.main',
    });

    expect(dispatcher(['mapview', '.map.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: 'mapview command already exists: .map.main',
    });

    expect(dispatcher(['mapview'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'mapview command requires a pathName in argv[1]',
    });

    expect(dispatcher(['mapview', '.map.odd', '-width'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'mapview .map.odd configure expects option/value pairs, got 1 trailing args',
    });

    expect(dispatcher(['mapview', '.map.bad-int', '-width', '12.5'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'mapview .map.bad-int configure expected an integer width: 12.5',
    });
  });
});

describe('mapview widget command shell', () => {
  it('dispatches map subcommands with case-sensitive lookup', () => {
    const viewState = createMapViewState('.map.main');
    const dispatcher = createMapViewWidgetCommandDispatcher(viewState);

    expect(dispatcher(['.map.main', 'configure'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '-font -Adobe-Helvetica-Bold-R-Normal-*-140-* -messagevar  -width 0 -height 0',
    });

    expect(dispatcher(['.map.main', 'configure', '-font', 'Chicago'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(dispatcher(['.map.main', 'configure', '-font'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'Chicago',
    });

    expect(dispatcher(['.map.main', 'Size'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown mapview subcommand: Size',
    });
  });

  it('parses Tcl-style integers for position and size like MapCmdposition/MapCmdsize', () => {
    const viewState = createMapViewState('.map.main');
    const dispatcher = createMapViewWidgetCommandDispatcher(viewState);

    // C uses `Tcl_GetInt` in `MapCmdposition` (`w_map.c`), which accepts hex
    // and leading-zero octal forms. `0x10` => 16 and `010` => 8.
    expect(dispatcher(['.map.main', 'position', '0x10', '010'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '16 8',
    });

    expect(dispatcher(['.map.main', 'size', '-64', '0200'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '-64 128',
    });
  });

  it('implements map state, visibility, and ViewAt placeholder behavior like w_map.c', () => {
    const viewState = createMapViewState('.map.main', {
      isMapped: 0,
    });
    const kickEvents: string[] = [];
    const mapStateEvents: Array<readonly [string, number]> = [];
    const kickState = createSimKickState();
    const subcommandTable = createMapViewSubcommandTable(
      createMapViewSubcommandEntries({
        kickState,
        kickHooks: {
          onKick: () => {
            kickEvents.push('kick');
          },
          onScheduleDelayedUpdate: () => {
            kickEvents.push('schedule');
          },
        },
        hooks: {
          onSetMapState: (view, mapState) => {
            mapStateEvents.push([view.commandName, mapState] as const);
          },
        },
      }),
    );
    const dispatcher = createMapViewWidgetCommandDispatcher(viewState, subcommandTable);

    expect(dispatcher(['.map.main', 'MapState'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });

    // `NMAPS` is `15` in `ref/micropolis/src/sim/headers/sim.h`, so valid
    // map states are `0..14`.
    expect(dispatcher(['.map.main', 'MapState', '14'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '14',
    });
    expect(viewState.invalid).toBe(1);
    expect(mapStateEvents).toEqual([['.map.main', 14]]);

    expect(dispatcher(['.map.main', 'ShowEditors', '-5'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '-5',
    });

    expect(dispatcher(['.map.main', 'Visible', '1'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    viewState.isMapped = 1;
    expect(dispatcher(['.map.main', 'Visible', '1'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });

    expect(dispatcher(['.map.main', 'ViewAt', '010', '0x10'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'Sorry Not Implemented Yet',
    });

    expect(kickEvents).toEqual(['kick', 'schedule']);
    expect(kickState.updateDelayed).toBe(true);
  });

  it('uses C integer division for map/editor pan conversion (`*3/16` hit box and `*16/3` deltas)', () => {
    const viewState = createMapViewState('.map.main', {
      displayId: 'a',
    });
    const kickState = createSimKickState();
    const kickEvents: string[] = [];
    const trackedEditor = {
      displayId: 'a',
      showMe: 1,
      wWidth: 257,
      wHeight: 101,
      panX: 100,
      panY: 200,
      iWidth: 1920,
      iHeight: 1600,
      skip: 9,
    };
    const hiddenEditor = {
      displayId: 'a',
      showMe: 0,
      wWidth: 500,
      wHeight: 500,
      panX: 0,
      panY: 0,
      iWidth: 1920,
      iHeight: 1600,
      skip: 3,
    };
    const otherDisplayEditor = {
      displayId: 'b',
      showMe: 1,
      wWidth: 500,
      wHeight: 500,
      panX: 0,
      panY: 0,
      iWidth: 1920,
      iHeight: 1600,
      skip: 3,
    };
    const deltas: Array<readonly [number, number]> = [];
    const subcommandTable = createMapViewSubcommandTable(
      createMapViewSubcommandEntries({
        kickState,
        kickHooks: {
          onKick: () => {
            kickEvents.push('kick');
          },
          onScheduleDelayedUpdate: () => {
            kickEvents.push('schedule');
          },
        },
        hooks: {
          listEditorsForPan: () => {
            return [otherDisplayEditor, hiddenEditor, trackedEditor];
          },
          onPanByEditor: (_mapView, editor, dx, dy) => {
            deltas.push([dx, dy] as const);
            editor.panX += dx;
            editor.panY += dy;
          },
        },
      }),
    );
    const dispatcher = createMapViewWidgetCommandDispatcher(viewState, subcommandTable);

    expect(dispatcher(['.map.main', 'PanStart', '-10', '24'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(viewState.trackInfo).toBeNull();

    // `MapCmdPanStart` uses `left = left * 3 / 16 - 4` in `w_map.c`.
    // For this editor geometry (`w_width=257`, `pan_x=100`), the left edge is
    // `-9` after C integer truncation toward zero, so `x=-9` is inside.
    expect(dispatcher(['.map.main', 'PanStart', '-9', '24'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(viewState.trackInfo).toBe(trackedEditor);

    expect(dispatcher(['.map.main', 'PanTo', '-8', '23'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    // `MapCmdPanTo` scales map deltas with `dx = dx * 16 / 3` and `dy = dy * 16 / 3`.
    // For `dx=1`, `dy=-1`, this yields `5` and `-5` with C truncation semantics.
    expect(deltas).toEqual([[5, -5]]);
    expect(trackedEditor.panX).toBe(105);
    expect(trackedEditor.panY).toBe(195);
    expect(trackedEditor.skip).toBe(0);

    expect(dispatcher(['.map.main', 'PanTo', '-8', '23'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(deltas).toEqual([[5, -5]]);

    expect(kickEvents).toEqual(['kick', 'schedule']);
    expect(kickState.updateDelayed).toBe(true);
  });

  it('returns typed failures for argc, ranges, and parse errors in map commands', () => {
    const viewState = createMapViewState('.map.main');
    const dispatcher = createMapViewWidgetCommandDispatcher(viewState);

    expect(dispatcher(['.map.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.map.main command requires a subcommand in argv[1]',
    });

    expect(dispatcher(['.map.main', 'MapState', '15'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.map.main MapState expected an integer state in range 0..14: 15',
    });

    expect(dispatcher(['.map.main', 'PanStart', 'x', '1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.map.main PanStart expected an integer x: x',
    });

    expect(dispatcher(['.map.main', 'PanTo', '1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.map.main PanTo expects argc 4, got 3',
    });

    expect(dispatcher(['.map.main', 'Visible', '2'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.map.main Visible expected an integer visible in range 0..1: 2',
    });

    expect(dispatcher(['.map.main', 'ViewAt', '120', '0'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.map.main ViewAt expected an integer x in range 0..119: 120',
    });
  });

  it('uses last-entry-wins semantics for duplicate subcommand registrations', () => {
    const viewState = createMapViewState('.map.main');
    const subcommandTable = createMapViewSubcommandTable([
      ['Visible', () => makeScriptSuccess('0')],
      ['Visible', () => makeScriptSuccess('1')],
    ]);
    const dispatcher = createMapViewWidgetCommandDispatcher(viewState, subcommandTable);

    expect(dispatcher(['.map.main', 'Visible'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });
  });
});
