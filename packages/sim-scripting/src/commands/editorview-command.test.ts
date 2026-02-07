import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { ViewRegistry } from '../state/view-registry.ts';
import {
  createEditorViewCommandDispatcher,
  createEditorViewState,
  createEditorViewSubcommandTable,
  createEditorViewWidgetCommandDispatcher,
  type EditorViewState,
  registerEditorViewCommand,
} from './editorview-command.ts';

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
