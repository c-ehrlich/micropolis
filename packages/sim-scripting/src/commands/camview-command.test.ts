import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { ViewRegistry } from '../state/view-registry.ts';
import {
  type CamViewState,
  createCamViewCommandDispatcher,
  createCamViewState,
  createCamViewSubcommandEntries,
  createCamViewSubcommandTable,
  createCamViewWidgetCommandDispatcher,
} from './camview-command.ts';

describe('camview top-level command shell', () => {
  it('creates a named cam view command and applies creation-time configure options', () => {
    const runtime = new ScriptRuntime();
    const views = new ViewRegistry<CamViewState>();
    runtime.registerCommand(
      'camview',
      createCamViewCommandDispatcher({
        runtime,
        views,
      }),
    );

    expect(runtime.invoke(['camview', '.cam.main', '-width', '320', '-height', '200'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '.cam.main',
    });

    const created = views.get('.cam.main');
    expect(created).toBeDefined();
    if (created === undefined) {
      throw new Error('expected cam view state to be registered');
    }

    expect(created.configure.width).toBe(320);
    expect(created.configure.height).toBe(200);

    // `CamCmd` initializes `w_x/w_y = 0` and `visible = 0` in `w_cam.c`.
    expect(runtime.invoke(['.cam.main', 'position'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0 0',
    });
    expect(runtime.invoke(['.cam.main', 'Visible'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });

    expect(runtime.invoke(['camview', '.cam.default'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '.cam.default',
    });

    // `InitNewCam` calls `DoResizeCam(scam, 512, 512)` in `w_cam.c`.
    expect(runtime.invoke(['.cam.default', 'size'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '512 512',
    });
  });

  it('returns typed errors for duplicate view names and creation-time configure parse failures', () => {
    const runtime = new ScriptRuntime();
    const dispatcher = createCamViewCommandDispatcher({ runtime });

    expect(dispatcher(['camview', '.cam.main'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '.cam.main',
    });

    expect(dispatcher(['camview', '.cam.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: 'camview command already exists: .cam.main',
    });

    expect(dispatcher(['camview'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'camview command requires a pathName in argv[1]',
    });

    expect(dispatcher(['camview', '.cam.odd', '-width'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'camview .cam.odd configure expects option/value pairs, got 1 trailing args',
    });

    expect(dispatcher(['camview', '.cam.bad-int', '-height', 'oops'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'camview .cam.bad-int configure expected an integer height: oops',
    });
  });
});

describe('camview widget command shell', () => {
  it('dispatches subcommands with case-sensitive lookup', () => {
    const viewState = createCamViewState('.cam.main');
    const dispatcher = createCamViewWidgetCommandDispatcher(viewState);

    expect(dispatcher(['.cam.main', 'configure'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '-width 512 -height 512',
    });

    expect(dispatcher(['.cam.main', 'configure', '-width', '640'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(dispatcher(['.cam.main', 'configure', '-width'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '640',
    });

    expect(dispatcher(['.cam.main', 'visible'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown camview subcommand: visible',
    });
  });

  it('implements camera lifecycle subcommands, including rule parsing and cam-list ordering', () => {
    const viewState = createCamViewState('.cam.main');
    const neighborhoodCalls: Array<readonly [string, number]> = [];
    const loadRuleCalls: Array<readonly [string, string]> = [];
    const randomizeCalls: string[] = [];
    const storeColorCalls: Array<readonly [number, number, number, number]> = [];

    const subcommandTable = createCamViewSubcommandTable(
      createCamViewSubcommandEntries({
        hooks: {
          onSetNeighborhood: (_view, cam, neighborhood) => {
            neighborhoodCalls.push([cam.name, neighborhood] as const);
          },
          onLoadRule: (_view, cam, ruleName) => {
            loadRuleCalls.push([cam.name, ruleName] as const);
          },
          onRandomizeCam: (_view, cam) => {
            randomizeCalls.push(cam.name);
          },
          onStoreColor: (_view, color) => {
            storeColorCalls.push([color.index, color.r, color.g, color.b] as const);
            return 17;
          },
        },
      }),
    );
    const dispatcher = createCamViewWidgetCommandDispatcher(viewState, subcommandTable);

    expect(
      dispatcher(['.cam.main', 'NewCam', 'alpha', '6', '010', '0x10', '5', '7', '-dx', '3']),
    ).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(dispatcher(['.cam.main', 'FindCam', '13', '16'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'alpha',
    });

    const alphaConfig = dispatcher(['.cam.main', 'ConfigCam', 'alpha']);
    expect(alphaConfig.code).toBe(ScriptResultCode.Ok);
    if (alphaConfig.code !== ScriptResultCode.Ok) {
      throw new Error('expected ConfigCam alpha to succeed');
    }
    // `new_cam` rounds odd dimensions to even: `w=(w+1)&~1`, `h=(h+1)&~1`.
    // Source: `ref/micropolis/src/sim/g_cam.c`.
    expect(alphaConfig.value).toContain('-width 6');
    expect(alphaConfig.value).toContain('-height 8');
    expect(alphaConfig.value).toContain('-dx 3');

    expect(dispatcher(['.cam.main', 'NewCam', 'beta', '0', '100', '100', '4', '4'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    // `CamCmdNewCam` treats parsed zero as rule-name mode, not neighborhood 0.
    // Source: `ref/micropolis/src/sim/w_cam.c`.
    expect(neighborhoodCalls).toEqual([['alpha', 6]]);
    expect(loadRuleCalls).toEqual([['beta', '0']]);

    expect(dispatcher(['.cam.main', 'FindSomeCam', '999', '999'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'beta',
    });

    expect(dispatcher(['.cam.main', 'RandomizeCam', 'alpha'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(randomizeCalls).toEqual(['alpha']);

    expect(dispatcher(['.cam.main', 'DeleteCam', 'beta'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.cam.main', 'FindSomeCam', '999', '999'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'alpha',
    });

    expect(dispatcher(['.cam.main', 'StoreColor', '5', '1', '2', '3'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '17',
    });

    // `CamCmdStoreColor` reads all channels from `argv[2]` (legacy bug).
    // Source: `ref/micropolis/src/sim/w_cam.c`.
    expect(storeColorCalls).toEqual([[5, 5, 5, 5]]);
  });

  it('returns typed failures for argc, ranges, parse errors, and missing cameras', () => {
    const viewState = createCamViewState('.cam.main');
    const dispatcher = createCamViewWidgetCommandDispatcher(viewState);

    expect(dispatcher(['.cam.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.cam.main command requires a subcommand in argv[1]',
    });

    expect(dispatcher(['.cam.main', 'Visible', '2'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.cam.main Visible expected an integer visible in range 0..1: 2',
    });

    expect(dispatcher(['.cam.main', 'NewCam', 'alpha', '1', 'x', '0', '4', '4'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.cam.main NewCam expected an integer x: x',
    });

    expect(dispatcher(['.cam.main', 'ConfigCam'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.cam.main ConfigCam expects argc >= 3, got 2',
    });

    expect(dispatcher(['.cam.main', 'ConfigCam', 'missing'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: '.cam.main ConfigCam unknown camera: missing',
    });

    expect(dispatcher(['.cam.main', 'StoreColor', 'x', '1', '2', '3'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.cam.main StoreColor expected integer color values from argv[2]: x',
    });
  });

  it('uses last-entry-wins semantics for duplicate subcommand registrations', () => {
    const viewState = createCamViewState('.cam.main');
    const subcommandTable = createCamViewSubcommandTable([
      ['Visible', () => makeScriptSuccess('0')],
      ['Visible', () => makeScriptSuccess('1')],
    ]);
    const dispatcher = createCamViewWidgetCommandDispatcher(viewState, subcommandTable);

    expect(dispatcher(['.cam.main', 'Visible'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });
  });
});
