import {
  makeScriptFailure,
  makeScriptSuccess,
  ScriptRuntimeError,
  ScriptRuntimeErrorCode,
} from '../runtime/errors.ts';
import type { ScriptRuntimeResult } from '../runtime/result-code.ts';
import type { ScriptCommandHandler, ScriptRuntime } from '../runtime/script-runtime.ts';
import { ViewRegistry } from '../state/view-registry.ts';
import {
  createSimKickState,
  runSimKick,
  type SimKickHooks,
  type SimKickState,
} from './sim-command.ts';

const TCL_INT32_MIN = -2147483648n;
const TCL_INT32_MAX = 2147483647n;
const DEFAULT_EDITOR_VIEW_FONT = '-Adobe-Helvetica-Bold-R-Normal-*-140-*';
const DEFAULT_EDITOR_WINDOW_SIZE = 256;
const DEFAULT_WORLD_WIDTH = 120;
const DEFAULT_WORLD_HEIGHT = 100;
const DEFAULT_EDITOR_TOOL_STATE = 7;
const CHALK_EDITOR_TOOL_STATE = 10;
const ERASER_EDITOR_TOOL_STATE = 11;
const LAST_EDITOR_TOOL_STATE = 18;

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
 * Mirrors scripting-visible `SimView` fields used by `EditorCmdconfigure`,
 * `EditorCmdposition`, `EditorCmdsize`, `EditorCmdPan*`, and `EditorCmdTool*`
 * in `ref/micropolis/src/sim/w_editor.c`, plus pan/coordinate fields from
 * `ref/micropolis/src/sim/w_x.c` and `ref/micropolis/src/sim/w_tool.c`.
 * Difference from C: Tk/X11 pointers and rendering buffers are omitted.
 */
export interface EditorViewState {
  commandName: string;
  wX: number;
  wY: number;
  wWidth: number;
  wHeight: number;
  worldWidth: number;
  worldHeight: number;
  iWidth: number;
  iHeight: number;
  mWidth: number;
  mHeight: number;
  panX: number;
  panY: number;
  tileX: number;
  tileY: number;
  tileWidth: number;
  tileHeight: number;
  screenX: number;
  screenY: number;
  screenWidth: number;
  screenHeight: number;
  toolX: number;
  toolY: number;
  toolXConst: number;
  toolYConst: number;
  toolState: number;
  skip: number;
  invalid: number;
  lastX: number;
  lastY: number;
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
  worldWidth?: number;
  worldHeight?: number;
  iWidth?: number;
  iHeight?: number;
  mWidth?: number;
  mHeight?: number;
  panX?: number;
  panY?: number;
  toolX?: number;
  toolY?: number;
  toolXConst?: number;
  toolYConst?: number;
  toolState?: number;
  skip?: number;
  invalid?: number;
  lastX?: number;
  lastY?: number;
  configure?: Partial<EditorViewConfigureState>;
}

interface EditorViewToolEvent {
  viewX: number;
  viewY: number;
  pixelX: number;
  pixelY: number;
}

interface EditorViewDoToolEvent {
  tool: number;
  tileX: number;
  tileY: number;
  pixelX: number;
  pixelY: number;
}

interface EditorViewToolHooks {
  onDoTool?: (viewState: EditorViewState, event: EditorViewDoToolEvent) => void;
  onToolDown?: (viewState: EditorViewState, event: EditorViewToolEvent) => void;
  onToolDrag?: (viewState: EditorViewState, event: EditorViewToolEvent) => void;
  onToolUp?: (viewState: EditorViewState, event: EditorViewToolEvent) => void;
}

interface CreateEditorViewSubcommandEntriesOptions {
  kickState?: SimKickState;
  kickHooks?: SimKickHooks;
  toolHooks?: EditorViewToolHooks;
}

/**
 * C-style editor memory-span growth used by `DoResizeView` for editor classes.
 * Mirrors `view->m_width/m_height` updates in `ref/micropolis/src/sim/w_x.c`:
 * `(w + 31) & (~15)` and `(h + 31) & (~15)`.
 */
function toEditorMemorySpan(windowSpan: number): number {
  return (windowSpan + 31) & ~15;
}

/**
 * Recomputes tile/screen bounds from the current pan and window dimensions.
 * Mirrors `DoAdjustPan` in `ref/micropolis/src/sim/w_x.c`.
 * Difference from C: redraw/scroll-copy side effects are not modeled; only state fields are updated.
 */
function doAdjustEditorPan(viewState: EditorViewState): void {
  const halfWidth = viewState.wWidth >> 1;
  const halfHeight = viewState.wHeight >> 1;
  const panX = viewState.panX;
  const panY = viewState.panY;

  let tileX = (panX - halfWidth) >> 4;
  let tileY = (panY - halfHeight) >> 4;

  if (tileX < 0) {
    tileX = 0;
  }
  if (tileY < 0) {
    tileY = 0;
  }

  let tileWidth = (15 + panX + halfWidth) >> 4;
  let tileHeight = (15 + panY + halfHeight) >> 4;

  const idealTileWidth = viewState.iWidth >> 4;
  const idealTileHeight = viewState.iHeight >> 4;
  if (tileWidth > idealTileWidth) {
    tileWidth = idealTileWidth;
  }
  if (tileHeight > idealTileHeight) {
    tileHeight = idealTileHeight;
  }

  tileWidth -= tileX;
  tileHeight -= tileY;

  const memoryTileWidth = viewState.mWidth >> 4;
  const memoryTileHeight = viewState.mHeight >> 4;
  if (tileWidth > memoryTileWidth) {
    tileWidth = memoryTileWidth;
  }
  if (tileHeight > memoryTileHeight) {
    tileHeight = memoryTileHeight;
  }

  if (tileWidth < 0) {
    tileWidth = 0;
  }
  if (tileHeight < 0) {
    tileHeight = 0;
  }

  viewState.tileX = tileX;
  viewState.tileY = tileY;
  viewState.tileWidth = tileWidth;
  viewState.tileHeight = tileHeight;
  viewState.screenX = halfWidth - panX + (tileX << 4);
  viewState.screenY = halfHeight - panY + (tileY << 4);
  viewState.screenWidth = tileWidth << 4;
  viewState.screenHeight = tileHeight << 4;
  viewState.invalid = 1;
}

/**
 * Implements `DoPanTo` clamp/update behavior for editor views.
 * Mirrors `DoPanTo` in `ref/micropolis/src/sim/w_x.c`.
 */
function doEditorPanTo(viewState: EditorViewState, x: number, y: number): void {
  let clampedX = x;
  let clampedY = y;
  if (clampedX < 0) {
    clampedX = 0;
  }
  if (clampedY < 0) {
    clampedY = 0;
  }
  if (clampedX > viewState.iWidth) {
    clampedX = viewState.iWidth - 1;
  }
  if (clampedY > viewState.iHeight) {
    clampedY = viewState.iHeight - 1;
  }

  if (viewState.panX !== clampedX || viewState.panY !== clampedY) {
    viewState.panX = clampedX;
    viewState.panY = clampedY;
    doAdjustEditorPan(viewState);
  }
}

/**
 * Implements `DoPanBy` pixel-delta behavior.
 * Mirrors `DoPanBy` in `ref/micropolis/src/sim/w_x.c`.
 */
function doEditorPanBy(viewState: EditorViewState, dx: number, dy: number): void {
  doEditorPanTo(viewState, viewState.panX + dx, viewState.panY + dy);
}

/**
 * Converts view-local coordinates to clamped pixel coordinates.
 * Mirrors `ViewToPixelCoords` in `ref/micropolis/src/sim/w_x.c`.
 */
function viewToPixelCoords(
  viewState: EditorViewState,
  viewX: number,
  viewY: number,
): EditorViewToolEvent {
  let pixelX = viewState.panX - ((viewState.wWidth >> 1) - viewX);
  let pixelY = viewState.panY - ((viewState.wHeight >> 1) - viewY);

  const worldMaxX = (viewState.worldWidth << 4) - 1;
  const worldMaxY = (viewState.worldHeight << 4) - 1;
  if (pixelX < 0) {
    pixelX = 0;
  }
  if (pixelY < 0) {
    pixelY = 0;
  }
  if (pixelX >= worldMaxX + 1) {
    pixelX = worldMaxX;
  }
  if (pixelY >= worldMaxY + 1) {
    pixelY = worldMaxY;
  }

  const minTilePixelX = viewState.tileX << 4;
  const minTilePixelY = viewState.tileY << 4;
  const maxTilePixelX = ((viewState.tileX + viewState.tileWidth) << 4) - 1;
  const maxTilePixelY = ((viewState.tileY + viewState.tileHeight) << 4) - 1;

  if (pixelX < minTilePixelX) {
    pixelX = minTilePixelX;
  }
  if (pixelY < minTilePixelY) {
    pixelY = minTilePixelY;
  }
  if (pixelX >= (viewState.tileX + viewState.tileWidth) << 4) {
    pixelX = maxTilePixelX;
  }
  if (pixelY >= (viewState.tileY + viewState.tileHeight) << 4) {
    pixelY = maxTilePixelY;
  }

  if (viewState.toolXConst !== -1) {
    pixelX = (viewState.toolXConst << 4) + 8;
  }
  if (viewState.toolYConst !== -1) {
    pixelY = (viewState.toolYConst << 4) + 8;
  }

  return {
    viewX,
    viewY,
    pixelX,
    pixelY,
  };
}

/**
 * Simplified `DoTool` state effects used by script command wrappers.
 * Mirrors the command-facing flow in `EditorCmdDoTool` (`w_editor.c`) and
 * reset side effects in `DoTool` (`w_tool.c`).
 * Difference from C: map edits/sound/messages are delegated to optional hooks.
 */
function runEditorDoTool(
  viewState: EditorViewState,
  tool: number,
  tileX: number,
  tileY: number,
  toolHooks: EditorViewToolHooks,
): void {
  toolHooks.onDoTool?.(viewState, {
    tool,
    tileX,
    tileY,
    pixelX: tileX << 4,
    pixelY: tileY << 4,
  });

  viewState.skip = 0;
}

/**
 * Simplified `ToolDown` effects for script command wrappers.
 * Mirrors `ToolDown` in `ref/micropolis/src/sim/w_tool.c`.
 * Difference from C: actual tool execution is delegated to optional hooks.
 */
function runEditorToolDown(
  viewState: EditorViewState,
  viewX: number,
  viewY: number,
  toolHooks: EditorViewToolHooks,
): void {
  const event = viewToPixelCoords(viewState, viewX, viewY);
  viewState.lastX = event.pixelX;
  viewState.lastY = event.pixelY;
  viewState.skip = 0;
  viewState.invalid = 1;
  toolHooks.onToolDown?.(viewState, event);
}

/**
 * Simplified `ToolDrag` effects for script command wrappers.
 * Mirrors coordinate conversion and `last_x/last_y` updates in
 * `ToolDrag` from `ref/micropolis/src/sim/w_tool.c`.
 * Difference from C: intermediate interpolation path edits are omitted.
 */
function runEditorToolDrag(
  viewState: EditorViewState,
  viewX: number,
  viewY: number,
  toolHooks: EditorViewToolHooks,
): void {
  const event = viewToPixelCoords(viewState, viewX, viewY);
  viewState.toolX = event.pixelX;
  viewState.toolY = event.pixelY;
  toolHooks.onToolDrag?.(viewState, event);

  if (
    viewState.toolState === CHALK_EDITOR_TOOL_STATE ||
    viewState.toolState === ERASER_EDITOR_TOOL_STATE
  ) {
    viewState.lastX = event.pixelX;
    viewState.lastY = event.pixelY;
  } else {
    const tileX = event.pixelX >> 4;
    const tileY = event.pixelY >> 4;
    const lastTileX = viewState.lastX >> 4;
    const lastTileY = viewState.lastY >> 4;

    if (tileX === lastTileX && tileY === lastTileY) {
      return;
    }

    viewState.lastX = (tileX << 4) + 8;
    viewState.lastY = (tileY << 4) + 8;
  }

  viewState.skip = 0;
  viewState.invalid = 1;
}

/**
 * `ToolUp` simply reuses drag behavior with the release coordinates.
 * Mirrors `ToolUp` calling `ToolDrag` in `ref/micropolis/src/sim/w_tool.c`.
 */
function runEditorToolUp(
  viewState: EditorViewState,
  viewX: number,
  viewY: number,
  toolHooks: EditorViewToolHooks,
): void {
  const event = viewToPixelCoords(viewState, viewX, viewY);
  toolHooks.onToolUp?.(viewState, event);
  runEditorToolDrag(viewState, viewX, viewY, toolHooks);
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
  const wWidth = options.wWidth ?? DEFAULT_EDITOR_WINDOW_SIZE;
  const wHeight = options.wHeight ?? DEFAULT_EDITOR_WINDOW_SIZE;
  const worldWidth = options.worldWidth ?? DEFAULT_WORLD_WIDTH;
  const worldHeight = options.worldHeight ?? DEFAULT_WORLD_HEIGHT;
  const iWidth = options.iWidth ?? worldWidth << 4;
  const iHeight = options.iHeight ?? worldHeight << 4;

  const viewState: EditorViewState = {
    commandName,
    wX: options.wX ?? 0,
    wY: options.wY ?? 0,
    wWidth,
    wHeight,
    worldWidth,
    worldHeight,
    iWidth,
    iHeight,
    mWidth: options.mWidth ?? toEditorMemorySpan(wWidth),
    mHeight: options.mHeight ?? toEditorMemorySpan(wHeight),
    panX: options.panX ?? wWidth >> 1,
    panY: options.panY ?? wHeight >> 1,
    tileX: 0,
    tileY: 0,
    tileWidth: 0,
    tileHeight: 0,
    screenX: 0,
    screenY: 0,
    screenWidth: 0,
    screenHeight: 0,
    toolX: options.toolX ?? 0,
    toolY: options.toolY ?? 0,
    toolXConst: options.toolXConst ?? -1,
    toolYConst: options.toolYConst ?? -1,
    toolState: options.toolState ?? DEFAULT_EDITOR_TOOL_STATE,
    skip: options.skip ?? 0,
    invalid: options.invalid ?? 0,
    lastX: options.lastX ?? 0,
    lastY: options.lastY ?? 0,
    configure: {
      font: options.configure?.font ?? DEFAULT_EDITOR_VIEW_FONT,
      messageVar: options.configure?.messageVar ?? null,
      width: options.configure?.width ?? 0,
      height: options.configure?.height ?? 0,
    },
  };

  doAdjustEditorPan(viewState);
  return viewState;
}

/**
 * Subcommand names registered for the P2.1/P2.2 editor view shell.
 * Mirrors `EDITOR_CMD(...)` registrations for `configure`, `position`, `size`,
 * `Pan`, `PanStart`, `PanTo`, `PanBy`, `ToolDown`, `ToolDrag`, `ToolUp`,
 * and `DoTool` in `editor_command_init` (`ref/micropolis/src/sim/w_editor.c`).
 */
export const EDITOR_VIEW_SUBCOMMAND_NAMES = [
  'configure',
  'position',
  'size',
  'Pan',
  'PanStart',
  'PanTo',
  'PanBy',
  'ToolDown',
  'ToolDrag',
  'ToolUp',
  'DoTool',
] as const;

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
 * Builds the `Pan` subcommand handler.
 * Mirrors `EditorCmdPan` in `ref/micropolis/src/sim/w_editor.c`.
 */
function createEditorViewPanSubcommandHandler(
  kickState: SimKickState,
  kickHooks: SimKickHooks,
): EditorViewSubcommandHandler {
  return (viewState: EditorViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 2 && argv.length !== 4) {
      return makeInvalidArgCount(
        `${viewState.commandName} Pan expects argc 2 or 4, got ${argv.length}`,
      );
    }

    if (argv.length === 4) {
      const rawX = argv[2];
      const rawY = argv[3];
      if (rawX === undefined || rawY === undefined) {
        return makeInvalidArgCount(`${viewState.commandName} Pan missing x/y arguments`);
      }

      const parsedX = parseTclInt32(rawX);
      if (parsedX === null) {
        return makeInvalidInteger(`${viewState.commandName} Pan expected an integer x: ${rawX}`);
      }

      const parsedY = parseTclInt32(rawY);
      if (parsedY === null) {
        return makeInvalidInteger(`${viewState.commandName} Pan expected an integer y: ${rawY}`);
      }

      doEditorPanTo(viewState, parsedX, parsedY);
      runSimKick(kickState, kickHooks);
    }

    return makeScriptSuccess(`${viewState.panX} ${viewState.panY}`);
  };
}

/**
 * Builds the `PanStart` subcommand handler.
 * Mirrors `EditorCmdPanStart` in `ref/micropolis/src/sim/w_editor.c`.
 */
function handleEditorViewPanStartSubcommand(
  viewState: EditorViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 4) {
    return makeInvalidArgCount(
      `${viewState.commandName} PanStart expects argc 4, got ${argv.length}`,
    );
  }

  const rawX = argv[2];
  const rawY = argv[3];
  if (rawX === undefined || rawY === undefined) {
    return makeInvalidArgCount(`${viewState.commandName} PanStart missing x/y arguments`);
  }

  const parsedX = parseTclInt32(rawX);
  if (parsedX === null) {
    return makeInvalidInteger(`${viewState.commandName} PanStart expected an integer x: ${rawX}`);
  }

  const parsedY = parseTclInt32(rawY);
  if (parsedY === null) {
    return makeInvalidInteger(`${viewState.commandName} PanStart expected an integer y: ${rawY}`);
  }

  viewState.lastX = parsedX;
  viewState.lastY = parsedY;
  return makeScriptSuccess();
}

/**
 * Builds the `PanTo` subcommand handler.
 * Mirrors `EditorCmdPanTo` in `ref/micropolis/src/sim/w_editor.c`.
 */
function createEditorViewPanToSubcommandHandler(
  kickState: SimKickState,
  kickHooks: SimKickHooks,
): EditorViewSubcommandHandler {
  return (viewState: EditorViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 4) {
      return makeInvalidArgCount(
        `${viewState.commandName} PanTo expects argc 4, got ${argv.length}`,
      );
    }

    const rawX = argv[2];
    const rawY = argv[3];
    if (rawX === undefined || rawY === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} PanTo missing x/y arguments`);
    }

    const parsedX = parseTclInt32(rawX);
    if (parsedX === null) {
      return makeInvalidInteger(`${viewState.commandName} PanTo expected an integer x: ${rawX}`);
    }

    const parsedY = parseTclInt32(rawY);
    if (parsedY === null) {
      return makeInvalidInteger(`${viewState.commandName} PanTo expected an integer y: ${rawY}`);
    }

    const dx = viewState.toolXConst === -1 ? viewState.lastX - parsedX : 0;
    const dy = viewState.toolYConst === -1 ? viewState.lastY - parsedY : 0;
    if (dx !== 0 || dy !== 0) {
      viewState.lastX = parsedX;
      viewState.lastY = parsedY;
      doEditorPanBy(viewState, dx, dy);
      runSimKick(kickState, kickHooks);
    }

    return makeScriptSuccess();
  };
}

/**
 * Builds the `PanBy` subcommand handler.
 * Mirrors `EditorCmdPanBy` in `ref/micropolis/src/sim/w_editor.c`.
 */
function createEditorViewPanBySubcommandHandler(
  kickState: SimKickState,
  kickHooks: SimKickHooks,
): EditorViewSubcommandHandler {
  return (viewState: EditorViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 4) {
      return makeInvalidArgCount(
        `${viewState.commandName} PanBy expects argc 4, got ${argv.length}`,
      );
    }

    const rawDx = argv[2];
    const rawDy = argv[3];
    if (rawDx === undefined || rawDy === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} PanBy missing dx/dy arguments`);
    }

    const parsedDx = parseTclInt32(rawDx);
    if (parsedDx === null) {
      return makeInvalidInteger(`${viewState.commandName} PanBy expected an integer dx: ${rawDx}`);
    }

    const parsedDy = parseTclInt32(rawDy);
    if (parsedDy === null) {
      return makeInvalidInteger(`${viewState.commandName} PanBy expected an integer dy: ${rawDy}`);
    }

    doEditorPanBy(viewState, parsedDx, parsedDy);
    runSimKick(kickState, kickHooks);
    return makeScriptSuccess();
  };
}

/**
 * Builds the `DoTool` subcommand handler.
 * Mirrors `EditorCmdDoTool` in `ref/micropolis/src/sim/w_editor.c`.
 */
function createEditorViewDoToolSubcommandHandler(
  kickState: SimKickState,
  kickHooks: SimKickHooks,
  toolHooks: EditorViewToolHooks,
): EditorViewSubcommandHandler {
  return (viewState: EditorViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 5) {
      return makeInvalidArgCount(
        `${viewState.commandName} DoTool expects argc 5, got ${argv.length}`,
      );
    }

    const rawTool = argv[2];
    const rawTileX = argv[3];
    const rawTileY = argv[4];
    if (rawTool === undefined || rawTileX === undefined || rawTileY === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} DoTool missing tool/tile arguments`);
    }

    const parsedTool = parseTclInt32(rawTool);
    if (parsedTool === null || parsedTool < 0 || parsedTool > LAST_EDITOR_TOOL_STATE) {
      return makeInvalidInteger(
        `${viewState.commandName} DoTool expected an integer tool in range 0..${LAST_EDITOR_TOOL_STATE}: ${rawTool}`,
      );
    }

    const parsedTileX = parseTclInt32(rawTileX);
    if (parsedTileX === null) {
      return makeInvalidInteger(
        `${viewState.commandName} DoTool expected an integer tileX: ${rawTileX}`,
      );
    }

    const parsedTileY = parseTclInt32(rawTileY);
    if (parsedTileY === null) {
      return makeInvalidInteger(
        `${viewState.commandName} DoTool expected an integer tileY: ${rawTileY}`,
      );
    }

    runEditorDoTool(viewState, parsedTool, parsedTileX, parsedTileY, toolHooks);
    runSimKick(kickState, kickHooks);
    return makeScriptSuccess();
  };
}

/**
 * Builds the `ToolDown` subcommand handler.
 * Mirrors `EditorCmdToolDown` in `ref/micropolis/src/sim/w_editor.c`.
 */
function createEditorViewToolDownSubcommandHandler(
  kickState: SimKickState,
  kickHooks: SimKickHooks,
  toolHooks: EditorViewToolHooks,
): EditorViewSubcommandHandler {
  return (viewState: EditorViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 4) {
      return makeInvalidArgCount(
        `${viewState.commandName} ToolDown expects argc 4, got ${argv.length}`,
      );
    }

    const rawX = argv[2];
    const rawY = argv[3];
    if (rawX === undefined || rawY === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} ToolDown missing x/y arguments`);
    }

    const parsedX = parseTclInt32(rawX);
    if (parsedX === null) {
      return makeInvalidInteger(`${viewState.commandName} ToolDown expected an integer x: ${rawX}`);
    }

    const parsedY = parseTclInt32(rawY);
    if (parsedY === null) {
      return makeInvalidInteger(`${viewState.commandName} ToolDown expected an integer y: ${rawY}`);
    }

    runEditorToolDown(viewState, parsedX, parsedY, toolHooks);
    runSimKick(kickState, kickHooks);
    return makeScriptSuccess();
  };
}

/**
 * Builds the `ToolDrag` subcommand handler.
 * Mirrors `EditorCmdToolDrag` in `ref/micropolis/src/sim/w_editor.c`.
 */
function createEditorViewToolDragSubcommandHandler(
  kickState: SimKickState,
  kickHooks: SimKickHooks,
  toolHooks: EditorViewToolHooks,
): EditorViewSubcommandHandler {
  return (viewState: EditorViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 4) {
      return makeInvalidArgCount(
        `${viewState.commandName} ToolDrag expects argc 4, got ${argv.length}`,
      );
    }

    const rawX = argv[2];
    const rawY = argv[3];
    if (rawX === undefined || rawY === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} ToolDrag missing x/y arguments`);
    }

    const parsedX = parseTclInt32(rawX);
    if (parsedX === null) {
      return makeInvalidInteger(`${viewState.commandName} ToolDrag expected an integer x: ${rawX}`);
    }

    const parsedY = parseTclInt32(rawY);
    if (parsedY === null) {
      return makeInvalidInteger(`${viewState.commandName} ToolDrag expected an integer y: ${rawY}`);
    }

    runEditorToolDrag(viewState, parsedX, parsedY, toolHooks);
    runSimKick(kickState, kickHooks);
    return makeScriptSuccess();
  };
}

/**
 * Builds the `ToolUp` subcommand handler.
 * Mirrors `EditorCmdToolUp` in `ref/micropolis/src/sim/w_editor.c`.
 */
function createEditorViewToolUpSubcommandHandler(
  kickState: SimKickState,
  kickHooks: SimKickHooks,
  toolHooks: EditorViewToolHooks,
): EditorViewSubcommandHandler {
  return (viewState: EditorViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 4) {
      return makeInvalidArgCount(
        `${viewState.commandName} ToolUp expects argc 4, got ${argv.length}`,
      );
    }

    const rawX = argv[2];
    const rawY = argv[3];
    if (rawX === undefined || rawY === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} ToolUp missing x/y arguments`);
    }

    const parsedX = parseTclInt32(rawX);
    if (parsedX === null) {
      return makeInvalidInteger(`${viewState.commandName} ToolUp expected an integer x: ${rawX}`);
    }

    const parsedY = parseTclInt32(rawY);
    if (parsedY === null) {
      return makeInvalidInteger(`${viewState.commandName} ToolUp expected an integer y: ${rawY}`);
    }

    runEditorToolUp(viewState, parsedX, parsedY, toolHooks);
    runSimKick(kickState, kickHooks);
    return makeScriptSuccess();
  };
}

/**
 * Builds the default subcommand entries for the editor-view shell.
 * Mirrors the P2.1/P2.2 `EDITOR_CMD(...)` registrations in
 * `editor_command_init` (`ref/micropolis/src/sim/w_editor.c`) for configure,
 * position/size, pan, and tool command families.
 * Parity note: tool internals model command-facing coordinate/state behavior,
 * while detailed map-edit interpolation remains delegated to hook integration.
 */
export function createEditorViewSubcommandEntries(
  options: CreateEditorViewSubcommandEntriesOptions = {},
): readonly EditorViewSubcommandEntry[] {
  const kickState = options.kickState ?? createSimKickState();
  const kickHooks = options.kickHooks ?? {};
  const toolHooks = options.toolHooks ?? {};

  return [
    ['configure', handleEditorViewConfigureSubcommand] as const,
    ['position', handleEditorViewPositionSubcommand] as const,
    ['size', handleEditorViewSizeSubcommand] as const,
    ['Pan', createEditorViewPanSubcommandHandler(kickState, kickHooks)] as const,
    ['PanStart', handleEditorViewPanStartSubcommand] as const,
    ['PanTo', createEditorViewPanToSubcommandHandler(kickState, kickHooks)] as const,
    ['PanBy', createEditorViewPanBySubcommandHandler(kickState, kickHooks)] as const,
    ['DoTool', createEditorViewDoToolSubcommandHandler(kickState, kickHooks, toolHooks)] as const,
    [
      'ToolDown',
      createEditorViewToolDownSubcommandHandler(kickState, kickHooks, toolHooks),
    ] as const,
    [
      'ToolDrag',
      createEditorViewToolDragSubcommandHandler(kickState, kickHooks, toolHooks),
    ] as const,
    ['ToolUp', createEditorViewToolUpSubcommandHandler(kickState, kickHooks, toolHooks)] as const,
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
 * Default subcommand table for P2.1/P2.2 editor-view shell behavior.
 * Mirrors `editor_command_init` registrations for configure/position/size plus
 * pan/tool command wrappers in `ref/micropolis/src/sim/w_editor.c`.
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
