import {
  makeScriptFailure,
  makeScriptSuccess,
  ScriptRuntimeError,
  ScriptRuntimeErrorCode,
} from '../runtime/errors.ts';
import type { ScriptRuntimeResult } from '../runtime/result-code.ts';
import type { ScriptCommandHandler, ScriptRuntime } from '../runtime/script-runtime.ts';
import { ViewRegistry } from '../state/view-registry.ts';

const TCL_INT32_MIN = -2147483648n;
const TCL_INT32_MAX = 2147483647n;
const DEFAULT_EDITOR_VIEW_FONT = '-Adobe-Helvetica-Bold-R-Normal-*-140-*';
const DEFAULT_EDITOR_WINDOW_SIZE = 256;

/**
 * Mutable `editorview` configure fields.
 * Mirrors `TileViewConfigSpecs` (`-font`, `-messagevar`, `-width`, `-height`)
 * in `ref/micropolis/src/sim/w_tk.c`.
 * Difference from C: these fields are explicit TypeScript state instead of Tk-managed option slots.
 */
export interface EditorViewConfigureState {
  font: string;
  messageVar: string | null;
  width: number;
  height: number;
}

/**
 * Mutable state for one created editor view command.
 * Mirrors `SimView` fields used by `EditorCmdposition`, `EditorCmdsize`, and
 * `EditorCmdconfigure` in `ref/micropolis/src/sim/w_editor.c`.
 * Difference from C: state is decoupled from Tk/X11 objects and stores only scripting-facing fields.
 */
export interface EditorViewState {
  commandName: string;
  wX: number;
  wY: number;
  wWidth: number;
  wHeight: number;
  configure: EditorViewConfigureState;
}

/**
 * Constructor overrides for `createEditorViewState`.
 * Mirrors view initialization values set in `InitNewView` and `TileViewConfigSpecs`
 * from `ref/micropolis/src/sim/w_x.c` and `ref/micropolis/src/sim/w_tk.c`.
 */
export interface CreateEditorViewStateOptions {
  wX?: number;
  wY?: number;
  wWidth?: number;
  wHeight?: number;
  configure?: Partial<EditorViewConfigureState>;
}

/**
 * Creates the mutable state backing one `editorview` widget command.
 * Mirrors default initialization in `InitNewView` (`w_x/w_y = 0`) and
 * the editor-size path (`EDITOR_W/EDITOR_H` normalized to `256x256`) in
 * `ref/micropolis/src/sim/w_x.c`, plus `TileViewConfigSpecs` defaults in `w_tk.c`.
 * Difference from C: this state is plain data, without allocating a Tk window.
 */
export function createEditorViewState(
  commandName: string,
  options: CreateEditorViewStateOptions = {},
): EditorViewState {
  return {
    commandName,
    wX: options.wX ?? 0,
    wY: options.wY ?? 0,
    wWidth: options.wWidth ?? DEFAULT_EDITOR_WINDOW_SIZE,
    wHeight: options.wHeight ?? DEFAULT_EDITOR_WINDOW_SIZE,
    configure: {
      font: options.configure?.font ?? DEFAULT_EDITOR_VIEW_FONT,
      messageVar: options.configure?.messageVar ?? null,
      width: options.configure?.width ?? 0,
      height: options.configure?.height ?? 0,
    },
  };
}

/**
 * Subcommand names registered for the P2.1 editor view shell.
 * Mirrors `EDITOR_CMD(configure)`, `EDITOR_CMD(position)`, and `EDITOR_CMD(size)`
 * in `editor_command_init` (`ref/micropolis/src/sim/w_editor.c`).
 */
export const EDITOR_VIEW_SUBCOMMAND_NAMES = ['configure', 'position', 'size'] as const;

/**
 * Union of supported editor view shell subcommands.
 */
export type EditorViewSubcommandName = (typeof EDITOR_VIEW_SUBCOMMAND_NAMES)[number];

/**
 * Handler signature for `<editorViewPath> <Subcommand> ...`.
 * Mirrors `EditorCmd*` function pointers looked up through `EditorCmds`
 * in `DoEditorCmd` (`ref/micropolis/src/sim/w_editor.c`).
 */
export type EditorViewSubcommandHandler = (
  viewState: EditorViewState,
  argv: readonly string[],
) => ScriptRuntimeResult;

/**
 * Case-sensitive `editorview` subcommand table.
 * Mirrors `Tcl_HashTable EditorCmds` lookup behavior in `DoEditorCmd`
 * (`ref/micropolis/src/sim/w_editor.c`).
 */
export type EditorViewSubcommandTable = ReadonlyMap<string, EditorViewSubcommandHandler>;

/**
 * One `editorview` subcommand registration tuple.
 * Mirrors one `EDITOR_CMD(name)` hash-table insertion in `editor_command_init`
 * (`ref/micropolis/src/sim/w_editor.c`).
 */
export type EditorViewSubcommandEntry = readonly [
  name: string,
  handler: EditorViewSubcommandHandler,
];

const EDITOR_VIEW_CONFIGURE_OPTION_NAMES = ['-font', '-messagevar', '-width', '-height'] as const;
type EditorViewConfigureOptionName = (typeof EDITOR_VIEW_CONFIGURE_OPTION_NAMES)[number];

/**
 * Parses a Tcl-style integer and enforces 32-bit C `int` range.
 * Mirrors `Tcl_GetInt` usage in `EditorCmdposition`/`EditorCmdsize`
 * (`ref/micropolis/src/sim/w_editor.c`).
 */
function parseTclInt32(raw: string): number | null {
  const text = raw.trim();
  if (text.length === 0) {
    return null;
  }

  let sign = 1n;
  let magnitude = text;
  if (text[0] === '+' || text[0] === '-') {
    if (text[0] === '-') {
      sign = -1n;
    }
    magnitude = text.slice(1);
  }

  if (magnitude.length === 0) {
    return null;
  }

  let parsedMagnitude: bigint;
  if (/^0[xX][0-9a-fA-F]+$/.test(magnitude)) {
    parsedMagnitude = BigInt(magnitude);
  } else if (/^0[0-7]+$/.test(magnitude)) {
    parsedMagnitude = BigInt(`0o${magnitude.slice(1)}`);
  } else if (/^(0|[1-9][0-9]*)$/.test(magnitude)) {
    parsedMagnitude = BigInt(magnitude);
  } else {
    return null;
  }

  const parsed = parsedMagnitude * sign;
  if (parsed < TCL_INT32_MIN || parsed > TCL_INT32_MAX) {
    return null;
  }

  return Number(parsed);
}

/**
 * Creates a typed invalid-argc runtime result.
 * Mirrors `TCL_ERROR` returns from `EditorCmd*` handlers when argc is unexpected
 * in `ref/micropolis/src/sim/w_editor.c`.
 */
function makeInvalidArgCount(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidArgCount, message));
}

/**
 * Creates a typed invalid-integer runtime result.
 * Mirrors `Tcl_GetInt(...) != TCL_OK` error paths in `EditorCmdposition` and
 * `EditorCmdsize` (`ref/micropolis/src/sim/w_editor.c`).
 */
function makeInvalidInteger(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidInteger, message));
}

/**
 * Converts a configure option-name token to the typed option union.
 * Mirrors option-name matching done by Tk configuration APIs in
 * `EditorCmdconfigure`/`ConfigureTileView` (`ref/micropolis/src/sim/w_editor.c`, `w_tk.c`).
 */
function toEditorViewConfigureOptionName(raw: string): EditorViewConfigureOptionName | null {
  switch (raw) {
    case '-font':
    case '-messagevar':
    case '-width':
    case '-height':
      return raw;
    default:
      return null;
  }
}

/**
 * Reads one configure option from editor-view state.
 * Mirrors single-option `Tk_ConfigureInfo(..., argv[2], ...)` reads in
 * `EditorCmdconfigure` (`ref/micropolis/src/sim/w_editor.c`).
 */
function readEditorViewConfigureOption(
  viewState: EditorViewState,
  optionName: EditorViewConfigureOptionName,
): string {
  switch (optionName) {
    case '-font':
      return viewState.configure.font;
    case '-messagevar':
      return viewState.configure.messageVar ?? '';
    case '-width':
      return String(viewState.configure.width);
    case '-height':
      return String(viewState.configure.height);
  }
}

/**
 * Serializes all configure options into a Tcl-like `name value` list.
 * Mirrors no-arg `Tk_ConfigureInfo(..., NULL, ...)` behavior in
 * `EditorCmdconfigure` (`ref/micropolis/src/sim/w_editor.c`).
 * Difference from C: this returns a simplified flat list instead of Tk's full 5-field tuples.
 */
function serializeEditorViewConfigureOptions(viewState: EditorViewState): string {
  return EDITOR_VIEW_CONFIGURE_OPTION_NAMES.map((optionName) => {
    return `${optionName} ${readEditorViewConfigureOption(viewState, optionName)}`;
  }).join(' ');
}

/**
 * Applies one configure option write to editor-view state.
 * Mirrors `ConfigureTileView` field updates via `TileViewConfigSpecs` in
 * `ref/micropolis/src/sim/w_tk.c`.
 */
function writeEditorViewConfigureOption(
  viewState: EditorViewState,
  optionName: EditorViewConfigureOptionName,
  optionValue: string,
  contextLabel: string,
): ScriptRuntimeResult | null {
  switch (optionName) {
    case '-font':
      viewState.configure.font = optionValue;
      return null;
    case '-messagevar':
      viewState.configure.messageVar = optionValue;
      return null;
    case '-width': {
      const parsedWidth = parseTclInt32(optionValue);
      if (parsedWidth === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer width: ${optionValue}`);
      }
      viewState.configure.width = parsedWidth;
      return null;
    }
    case '-height': {
      const parsedHeight = parseTclInt32(optionValue);
      if (parsedHeight === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer height: ${optionValue}`);
      }
      viewState.configure.height = parsedHeight;
      return null;
    }
  }
}

/**
 * Applies `configure` option/value pairs for editor-view creation and command writes.
 * Mirrors the `ConfigureTileView(..., argc-2, argv+2, ...)` write path in
 * `EditorCmdconfigure` (`ref/micropolis/src/sim/w_editor.c`).
 */
function applyEditorViewConfigureOptionPairs(
  viewState: EditorViewState,
  optionPairs: readonly string[],
  contextLabel: string,
): ScriptRuntimeResult | null {
  if (optionPairs.length % 2 !== 0) {
    return makeInvalidArgCount(
      `${contextLabel} configure expects option/value pairs, got ${optionPairs.length} trailing args`,
    );
  }

  for (let index = 0; index < optionPairs.length; index += 2) {
    const rawOptionName = optionPairs[index];
    const optionValue = optionPairs[index + 1];
    if (rawOptionName === undefined || optionValue === undefined) {
      return makeInvalidArgCount(`${contextLabel} configure encountered missing option/value pair`);
    }

    const optionName = toEditorViewConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${contextLabel} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    const writeResult = writeEditorViewConfigureOption(
      viewState,
      optionName,
      optionValue,
      `${contextLabel} configure`,
    );
    if (writeResult !== null) {
      return writeResult;
    }
  }

  return null;
}

/**
 * Implements the `configure` editor-view subcommand.
 * Mirrors `EditorCmdconfigure` in `ref/micropolis/src/sim/w_editor.c`.
 * Parity note: this preserves argc shape and option handling but returns a
 * simplified option listing instead of Tk's full configure-info payload.
 */
function handleEditorViewConfigureSubcommand(
  viewState: EditorViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length === 2) {
    return makeScriptSuccess(serializeEditorViewConfigureOptions(viewState));
  }

  if (argv.length === 3) {
    const rawOptionName = argv[2];
    if (rawOptionName === undefined) {
      return makeInvalidArgCount(
        `${viewState.commandName} configure missing option name at argv[2]`,
      );
    }

    const optionName = toEditorViewConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${viewState.commandName} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    return makeScriptSuccess(readEditorViewConfigureOption(viewState, optionName));
  }

  const writeResult = applyEditorViewConfigureOptionPairs(
    viewState,
    argv.slice(2),
    viewState.commandName,
  );
  if (writeResult !== null) {
    return writeResult;
  }

  return makeScriptSuccess('');
}

/**
 * Implements the `position` editor-view subcommand.
 * Mirrors `EditorCmdposition` in `ref/micropolis/src/sim/w_editor.c`:
 * accepts argc 2 or 4, parses `x y` with `Tcl_GetInt`, and returns `w_x w_y`.
 */
function handleEditorViewPositionSubcommand(
  viewState: EditorViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2 && argv.length !== 4) {
    return makeInvalidArgCount(
      `${viewState.commandName} position expects argc 2 or 4, got ${argv.length}`,
    );
  }

  if (argv.length === 4) {
    const rawX = argv[2];
    const rawY = argv[3];
    if (rawX === undefined || rawY === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} position missing x/y arguments`);
    }

    const parsedX = parseTclInt32(rawX);
    if (parsedX === null) {
      return makeInvalidInteger(`${viewState.commandName} position expected an integer x: ${rawX}`);
    }

    const parsedY = parseTclInt32(rawY);
    if (parsedY === null) {
      return makeInvalidInteger(`${viewState.commandName} position expected an integer y: ${rawY}`);
    }

    viewState.wX = parsedX;
    viewState.wY = parsedY;
  }

  return makeScriptSuccess(`${viewState.wX} ${viewState.wY}`);
}

/**
 * Implements the `size` editor-view subcommand.
 * Mirrors `EditorCmdsize` in `ref/micropolis/src/sim/w_editor.c`:
 * accepts argc 2 or 4, parses `w h` with `Tcl_GetInt`, and returns `w_width w_height`.
 */
function handleEditorViewSizeSubcommand(
  viewState: EditorViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2 && argv.length !== 4) {
    return makeInvalidArgCount(
      `${viewState.commandName} size expects argc 2 or 4, got ${argv.length}`,
    );
  }

  if (argv.length === 4) {
    const rawWidth = argv[2];
    const rawHeight = argv[3];
    if (rawWidth === undefined || rawHeight === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} size missing width/height arguments`);
    }

    const parsedWidth = parseTclInt32(rawWidth);
    if (parsedWidth === null) {
      return makeInvalidInteger(
        `${viewState.commandName} size expected an integer width: ${rawWidth}`,
      );
    }

    const parsedHeight = parseTclInt32(rawHeight);
    if (parsedHeight === null) {
      return makeInvalidInteger(
        `${viewState.commandName} size expected an integer height: ${rawHeight}`,
      );
    }

    viewState.wWidth = parsedWidth;
    viewState.wHeight = parsedHeight;
  }

  return makeScriptSuccess(`${viewState.wWidth} ${viewState.wHeight}`);
}

/**
 * Builds the default subcommand entries for the editor-view shell.
 * Mirrors the first three `EDITOR_CMD(...)` registrations in
 * `editor_command_init` (`ref/micropolis/src/sim/w_editor.c`).
 */
export function createEditorViewSubcommandEntries(): readonly EditorViewSubcommandEntry[] {
  return [
    ['configure', handleEditorViewConfigureSubcommand] as const,
    ['position', handleEditorViewPositionSubcommand] as const,
    ['size', handleEditorViewSizeSubcommand] as const,
  ];
}

/**
 * Builds a case-sensitive editor-view subcommand lookup table.
 * Mirrors `Tcl_HashTable EditorCmds` registration behavior in
 * `editor_command_init`/`DoEditorCmd` (`ref/micropolis/src/sim/w_editor.c`).
 * Parity note: duplicate names use last-registration-wins map semantics.
 */
export function createEditorViewSubcommandTable(
  entries: readonly EditorViewSubcommandEntry[] = [],
): EditorViewSubcommandTable {
  const table = new Map<string, EditorViewSubcommandHandler>();

  for (const [name, handler] of entries) {
    table.set(name, handler);
  }

  return table;
}

/**
 * Default subcommand table for P2.1 editor-view shell behavior.
 * Mirrors `editor_command_init` registration for `configure`, `position`, and `size`
 * in `ref/micropolis/src/sim/w_editor.c`.
 */
export const EDITOR_VIEW_SUBCOMMAND_TABLE = createEditorViewSubcommandTable(
  createEditorViewSubcommandEntries(),
);

/**
 * Creates the per-widget editor-view dispatcher bound to one view state.
 * Mirrors `DoEditorCmd` subcommand lookup flow in `ref/micropolis/src/sim/w_editor.c`.
 * Difference from C: this uses typed runtime errors instead of `Tcl_AppendResult`.
 */
export function createEditorViewWidgetCommandDispatcher(
  viewState: EditorViewState,
  subcommands: EditorViewSubcommandTable = EDITOR_VIEW_SUBCOMMAND_TABLE,
): ScriptCommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const subcommandName = argv[1];
    if (subcommandName === undefined) {
      return makeInvalidArgCount(
        `${viewState.commandName} command requires a subcommand in argv[1]`,
      );
    }

    const subcommandHandler = subcommands.get(subcommandName);
    if (subcommandHandler === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.UnknownSubcommand,
          `unknown editorview subcommand: ${subcommandName}`,
        ),
      );
    }

    return subcommandHandler(viewState, argv);
  };
}

/**
 * Constructor options for `createEditorViewCommandDispatcher`.
 * Mirrors state and command wiring around `TileViewCmd` + `DoEditorCmd`
 * in `ref/micropolis/src/sim/w_tk.c` and `ref/micropolis/src/sim/w_editor.c`.
 */
export interface CreateEditorViewCommandDispatcherOptions {
  runtime: ScriptRuntime;
  views?: ViewRegistry<EditorViewState>;
  createViewState?: (commandName: string) => EditorViewState;
  subcommands?: EditorViewSubcommandTable;
}

/**
 * Creates the top-level `editorview` factory command dispatcher.
 * Mirrors `TileViewCmd` creation flow for `editorview pathName ?options?` in
 * `ref/micropolis/src/sim/w_tk.c`: create a view, register a widget command, and return pathName.
 * Parity note: Tk window/event setup is intentionally omitted; this shell only models scripting state.
 */
export function createEditorViewCommandDispatcher(
  options: CreateEditorViewCommandDispatcherOptions,
): ScriptCommandHandler {
  const views = options.views ?? new ViewRegistry<EditorViewState>();
  const createViewState =
    options.createViewState ?? ((commandName: string) => createEditorViewState(commandName));
  const subcommands = options.subcommands ?? EDITOR_VIEW_SUBCOMMAND_TABLE;

  return (argv: readonly string[]): ScriptRuntimeResult => {
    const commandName = argv[1];
    if (commandName === undefined || commandName.length === 0) {
      return makeInvalidArgCount('editorview command requires a pathName in argv[1]');
    }

    if (views.get(commandName) !== undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `editorview command already exists: ${commandName}`,
        ),
      );
    }

    const viewState = createViewState(commandName);
    const configureResult = applyEditorViewConfigureOptionPairs(
      viewState,
      argv.slice(2),
      `editorview ${commandName}`,
    );
    if (configureResult !== null) {
      return configureResult;
    }

    views.add(commandName, viewState);
    options.runtime.registerCommand(
      commandName,
      createEditorViewWidgetCommandDispatcher(viewState, subcommands),
    );
    return makeScriptSuccess(commandName);
  };
}

/**
 * Registers the top-level `editorview` command in a runtime.
 * Mirrors `Tcl_CreateCommand(..., "editorview", TileViewCmd, ...)` in
 * `editor_command_init` (`ref/micropolis/src/sim/w_editor.c`), scoped to editor shell behavior.
 */
export function registerEditorViewCommand(
  runtime: ScriptRuntime,
  options: Omit<CreateEditorViewCommandDispatcherOptions, 'runtime'> = {},
): void {
  runtime.registerCommand(
    'editorview',
    createEditorViewCommandDispatcher({
      runtime,
      ...options,
    }),
  );
}
