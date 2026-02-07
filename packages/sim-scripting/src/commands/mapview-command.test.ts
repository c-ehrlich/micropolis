import { describe, expect, it } from 'vitest';

import { ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { ViewRegistry } from '../state/view-registry.ts';
import {
  createMapViewCommandDispatcher,
  createMapViewState,
  createMapViewWidgetCommandDispatcher,
  type MapViewState,
  registerMapViewCommand,
} from './mapview-command.ts';

describe('mapview top-level command shell', () => {
  it('creates a named map view command and applies creation-time configure options', () => {
    const runtime = new ScriptRuntime();
    const views = new ViewRegistry<MapViewState>();
    registerMapViewCommand(runtime, { views });

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

    // `InitNewView` initializes `w_x/w_y = 0` in `ref/micropolis/src/sim/w_x.c`.
    expect(runtime.invoke(['.map.main', 'position'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0 0',
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
  it('dispatches configure/position/size with case-sensitive subcommand lookup', () => {
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
});
