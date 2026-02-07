import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { ViewRegistry } from '../state/view-registry.ts';
import {
  createEditorViewCommandDispatcher,
  createEditorViewState,
  createEditorViewSubcommandEntries,
  createEditorViewSubcommandTable,
  createEditorViewWidgetCommandDispatcher,
  type EditorViewState,
  registerEditorViewCommand,
} from './editorview-command.ts';
import { createSimKickState } from './sim-command.ts';

describe('editorview top-level command shell', () => {
  it('creates a named editor view command and applies creation-time configure options', () => {
    const runtime = new ScriptRuntime();
    const views = new ViewRegistry<EditorViewState>();
    registerEditorViewCommand(runtime, { views });

    expect(
      runtime.invoke([
        'editorview',
        '.editor.main',
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
      value: '.editor.main',
    });

    const created = views.get('.editor.main');
    expect(created).toBeDefined();
    if (created === undefined) {
      throw new Error('expected editor view state to be registered');
    }

    expect(created.configure.width).toBe(320);
    expect(created.configure.height).toBe(200);
    expect(created.configure.font).toBe('MicropolisMono');
    expect(created.configure.messageVar).toBe('statusVar');

    // `InitNewView` initializes `w_x/w_y = 0` in `ref/micropolis/src/sim/w_x.c`.
    expect(runtime.invoke(['.editor.main', 'position'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0 0',
    });

    // `InitNewView` normalizes editor default size to `256x256` before `DoResizeView`
    // in `ref/micropolis/src/sim/w_x.c` (`if (w == EDITOR_W) w = 256;`).
    expect(runtime.invoke(['.editor.main', 'size'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '256 256',
    });
  });

  it('returns typed errors for duplicate view names and creation-time configure parse failures', () => {
    const runtime = new ScriptRuntime();
    const dispatcher = createEditorViewCommandDispatcher({ runtime });

    expect(dispatcher(['editorview', '.editor.main'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '.editor.main',
    });

    expect(dispatcher(['editorview', '.editor.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: 'editorview command already exists: .editor.main',
    });

    expect(dispatcher(['editorview'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'editorview command requires a pathName in argv[1]',
    });

    expect(dispatcher(['editorview', '.editor.odd', '-width'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'editorview .editor.odd configure expects option/value pairs, got 1 trailing args',
    });

    expect(dispatcher(['editorview', '.editor.bad-int', '-width', '12.5'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'editorview .editor.bad-int configure expected an integer width: 12.5',
    });
  });
});

describe('editorview widget command shell', () => {
  it('dispatches configure/position/size with case-sensitive subcommand lookup', () => {
    const viewState = createEditorViewState('.editor.main');
    const dispatcher = createEditorViewWidgetCommandDispatcher(viewState);

    expect(dispatcher(['.editor.main', 'configure'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '-font -Adobe-Helvetica-Bold-R-Normal-*-140-* -messagevar  -width 0 -height 0',
    });

    expect(dispatcher(['.editor.main', 'configure', '-font', 'Chicago'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(dispatcher(['.editor.main', 'configure', '-font'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'Chicago',
    });

    expect(dispatcher(['.editor.main', 'Size'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown editorview subcommand: Size',
    });
  });

  it('parses Tcl-style integers for position and size like EditorCmdposition/EditorCmdsize', () => {
    const viewState = createEditorViewState('.editor.main');
    const dispatcher = createEditorViewWidgetCommandDispatcher(viewState);

    // C uses `Tcl_GetInt` in `EditorCmdposition` (`w_editor.c`), which accepts hex
    // and leading-zero octal forms. `0x10` => 16 and `010` => 8.
    expect(dispatcher(['.editor.main', 'position', '0x10', '010'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '16 8',
    });

    expect(dispatcher(['.editor.main', 'size', '-64', '128'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '-64 128',
    });
  });

  it('implements pan command math and kick coalescing like EditorCmdPan/PanTo/PanBy', () => {
    const viewState = createEditorViewState('.editor.main');
    const events: string[] = [];
    const kickState = createSimKickState();
    const subcommandTable = createEditorViewSubcommandTable(
      createEditorViewSubcommandEntries({
        kickState,
        kickHooks: {
          onKick: () => {
            events.push('kick');
          },
          onScheduleDelayedUpdate: () => {
            events.push('schedule');
          },
        },
      }),
    );
    const dispatcher = createEditorViewWidgetCommandDispatcher(viewState, subcommandTable);

    // `InitNewView` in `w_x.c` normalizes editor window size to 256 and sets
    // `pan_x = w / 2`, `pan_y = h / 2`.
    expect(dispatcher(['.editor.main', 'Pan'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '128 128',
    });

    expect(dispatcher(['.editor.main', 'Pan', '0x20', '010'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '32 8',
    });
    expect(dispatcher(['.editor.main', 'PanBy', '5', '-3'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(dispatcher(['.editor.main', 'PanStart', '10', '30'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.editor.main', 'PanTo', '7', '20'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.editor.main', 'PanTo', '7', '20'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.editor.main', 'Pan'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '40 15',
    });

    viewState.toolXConst = 0;
    expect(dispatcher(['.editor.main', 'PanStart', '100', '100'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.editor.main', 'PanTo', '50', '90'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.editor.main', 'Pan'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '40 25',
    });

    expect(dispatcher(['.editor.main', 'Pan', '99999', '-9'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1919 0',
    });

    // `DoPanTo` in `w_x.c` clamps to `0..i_width-1` / `0..i_height-1`.
    // With `WORLD_X=120` and `WORLD_Y=100` (`headers/sim.h`), this yields
    // `i_width-1 = (120 * 16) - 1 = 1919` and `i_height-1 = 1599`.
    expect(viewState.panX).toBe(1919);
    expect(viewState.panY).toBe(0);

    // Every pan mutation calls `Kick()`, while delayed scheduling only occurs
    // once until `UpdateDelayed` is consumed (`w_tk.c`).
    expect(events).toEqual(['kick', 'schedule', 'kick', 'kick', 'kick', 'kick']);
    expect(kickState.updateDelayed).toBe(true);
  });

  it('converts tool command coordinates like DoTool/ToolDown/ToolDrag/ToolUp', () => {
    const viewState = createEditorViewState('.editor.main', {
      // `chalkState` is `10` in `headers/sim.h`.
      toolState: 10,
    });
    const kickState = createSimKickState();
    const events: string[] = [];
    const downPixels: Array<readonly [number, number]> = [];
    const dragPixels: Array<readonly [number, number]> = [];
    const upPixels: Array<readonly [number, number]> = [];
    const doToolCalls: Array<readonly [number, number, number, number, number]> = [];
    const subcommandTable = createEditorViewSubcommandTable(
      createEditorViewSubcommandEntries({
        kickState,
        kickHooks: {
          onKick: () => {
            events.push('kick');
          },
          onScheduleDelayedUpdate: () => {
            events.push('schedule');
          },
        },
        toolHooks: {
          onDoTool: (_view, event) => {
            doToolCalls.push([
              event.tool,
              event.tileX,
              event.tileY,
              event.pixelX,
              event.pixelY,
            ] as const);
          },
          onToolDown: (_view, event) => {
            downPixels.push([event.pixelX, event.pixelY] as const);
          },
          onToolDrag: (_view, event) => {
            dragPixels.push([event.pixelX, event.pixelY] as const);
          },
          onToolUp: (_view, event) => {
            upPixels.push([event.pixelX, event.pixelY] as const);
          },
        },
      }),
    );
    const dispatcher = createEditorViewWidgetCommandDispatcher(viewState, subcommandTable);

    // `lastState` is `networkState` (`18`) in `headers/sim.h`.
    expect(dispatcher(['.editor.main', 'DoTool', '18', '0x10', '010'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(doToolCalls).toEqual([[18, 16, 8, 256, 128]]);

    expect(dispatcher(['.editor.main', 'ToolDown', '-50', '300'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(downPixels).toEqual([[0, 255]]);
    expect(viewState.lastX).toBe(0);
    expect(viewState.lastY).toBe(255);

    viewState.toolXConst = 3;
    viewState.toolYConst = 4;
    expect(dispatcher(['.editor.main', 'ToolDrag', '999', '999'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.editor.main', 'ToolUp', '1', '1'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    // `ViewToPixelCoords` in `w_x.c` pins constrained axes to
    // `(tool_*_const << 4) + 8`.
    expect(dragPixels).toEqual([
      [56, 72],
      [56, 72],
    ]);
    expect(upPixels).toEqual([[56, 72]]);
    expect(viewState.lastX).toBe(56);
    expect(viewState.lastY).toBe(72);

    expect(events).toEqual(['kick', 'schedule', 'kick', 'kick', 'kick']);
    expect(kickState.updateDelayed).toBe(true);
  });

  it('implements editor mode/visibility/auto commands with C parity state transitions', () => {
    const viewState = createEditorViewState('.editor.main', {
      isMapped: 0,
      autoGoto: 0,
      autoGoing: 0,
      panX: 200,
      panY: 300,
    });
    const didStopPanCalls: Array<readonly [number, number]> = [];
    const subcommandTable = createEditorViewSubcommandTable(
      createEditorViewSubcommandEntries({
        autoHooks: {
          resolveFollowSprite: (spriteName) => {
            if (spriteName === 'heli') {
              return {
                name: 'heli',
                x: 640,
                y: 480,
                xHot: 8,
                yHot: 4,
              };
            }
            return null;
          },
          onDidStopPan: (view) => {
            didStopPanCalls.push([view.panX, view.panY] as const);
          },
        },
      }),
    );
    const dispatcher = createEditorViewWidgetCommandDispatcher(viewState, subcommandTable);

    expect(dispatcher(['.editor.main', 'AutoGoto'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    expect(dispatcher(['.editor.main', 'AutoGoto', '1'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });

    // `EditorCmdAutoGoal` in `w_editor.c` uses a 64-pixel radius
    // (`(dx*dx)+(dy*dy) > (64*64)`) to decide whether auto-pan should run.
    expect(dispatcher(['.editor.main', 'AutoGoal', '264', '300'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '264 300',
    });
    expect(viewState.autoGoing).toBe(0);

    expect(dispatcher(['.editor.main', 'AutoGoto', '0'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    expect(dispatcher(['.editor.main', 'AutoGoal', '500', '300'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '500 300',
    });
    expect(viewState.autoGoing).toBe(1);
    expect(viewState.autoGoto).toBe(-1);

    expect(dispatcher(['.editor.main', 'AutoGoing', '0'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    expect(viewState.autoGoto).toBe(0);

    expect(dispatcher(['.editor.main', 'AutoSpeed'])).toEqual({
      code: ScriptResultCode.Ok,
      // `InitNewView` in `w_x.c` sets `view->auto_speed = 75`.
      value: '75',
    });
    expect(dispatcher(['.editor.main', 'AutoSpeed', '0x20'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '32',
    });

    expect(dispatcher(['.editor.main', 'Visible', '1'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    viewState.isMapped = 1;
    expect(dispatcher(['.editor.main', 'Visible', '1'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1',
    });

    expect(dispatcher(['.editor.main', 'ToolState', '010'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '8',
    });
    expect(dispatcher(['.editor.main', 'ToolMode', '-1'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '-1',
    });

    expect(dispatcher(['.editor.main', 'Skip', '3'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '3',
    });
    expect(viewState.skip).toBe(3);
    expect(viewState.skips).toBe(3);
    expect(dispatcher(['.editor.main', 'Update'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(viewState.skip).toBe(0);

    viewState.autoGoing = 9;
    viewState.autoXGoal = 77;
    viewState.autoYGoal = 88;
    expect(dispatcher(['.editor.main', 'Sound', '0'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    expect(viewState.autoGoing).toBe(0);
    expect(viewState.autoXGoal).toBe(0);
    expect(viewState.autoYGoal).toBe(0);

    expect(dispatcher(['.editor.main', 'ShowMe', '0'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    expect(dispatcher(['.editor.main', 'ShowOverlay', '0'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    expect(dispatcher(['.editor.main', 'OverlayMode', '5'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '5',
    });
    expect(dispatcher(['.editor.main', 'DynamicFilter', '7'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '7',
    });

    expect(dispatcher(['.editor.main', 'Follow', 'missing'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(dispatcher(['.editor.main', 'Follow', 'heli'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'heli',
    });
    expect(viewState.panX).toBe(648);
    expect(viewState.panY).toBe(484);
    expect(didStopPanCalls).toHaveLength(0);
  });

  it('returns typed failures for argc and integer parse errors in shell subcommands', () => {
    const viewState = createEditorViewState('.editor.main');
    const dispatcher = createEditorViewWidgetCommandDispatcher(viewState);

    expect(dispatcher(['.editor.main'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.editor.main command requires a subcommand in argv[1]',
    });

    expect(dispatcher(['.editor.main', 'position', '5'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.editor.main position expects argc 2 or 4, got 3',
    });

    expect(dispatcher(['.editor.main', 'position', 'abc', '10'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.editor.main position expected an integer x: abc',
    });

    expect(dispatcher(['.editor.main', 'size', '10', 'z'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.editor.main size expected an integer height: z',
    });

    expect(dispatcher(['.editor.main', 'configure', '-nope'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: '.editor.main configure unknown option: -nope',
    });

    expect(dispatcher(['.editor.main', 'PanBy', '1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.editor.main PanBy expects argc 4, got 3',
    });

    expect(dispatcher(['.editor.main', 'PanStart', 'x', '1'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.editor.main PanStart expected an integer x: x',
    });

    expect(dispatcher(['.editor.main', 'DoTool', '19', '0', '0'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.editor.main DoTool expected an integer tool in range 0..18: 19',
    });

    expect(dispatcher(['.editor.main', 'ToolDown', '0', 'bad'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.editor.main ToolDown expected an integer y: bad',
    });

    expect(dispatcher(['.editor.main', 'AutoSpeed', '0'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.editor.main AutoSpeed expected an integer speed >= 1: 0',
    });

    expect(dispatcher(['.editor.main', 'Visible', '2'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: '.editor.main Visible expected an integer visible in range 0..1: 2',
    });

    expect(dispatcher(['.editor.main', 'AutoGoal', '4'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.editor.main AutoGoal expects argc 2 or 4, got 3',
    });

    expect(dispatcher(['.editor.main', 'Update', 'now'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: '.editor.main Update expects argc 2, got 3',
    });
  });

  it('uses last-entry-wins semantics for duplicate subcommand registrations', () => {
    const viewState = createEditorViewState('.editor.main');
    const subcommandTable = createEditorViewSubcommandTable([
      ['size', () => makeScriptSuccess('1 1')],
      ['size', () => makeScriptSuccess('2 2')],
    ]);

    const dispatcher = createEditorViewWidgetCommandDispatcher(viewState, subcommandTable);

    expect(dispatcher(['.editor.main', 'size'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '2 2',
    });
  });
});
