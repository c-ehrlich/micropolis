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
const DEFAULT_MAP_VIEW_FONT = '-Adobe-Helvetica-Bold-R-Normal-*-140-*';
const DEFAULT_WORLD_WIDTH = 120;
const DEFAULT_WORLD_HEIGHT = 100;
const MAP_VIEW_SCALE = 3;
const MAP_VIEW_PIXELS_PER_TILE = 16;
const MAP_VIEW_TRACK_PADDING = 4;
const MAP_VIEW_STATE_COUNT = 15;
const DEFAULT_MAP_VIEW_VISIBLE = 0;
const DEFAULT_MAP_VIEW_IS_MAPPED = 1;
const DEFAULT_MAP_VIEW_STATE = 0;
const DEFAULT_MAP_VIEW_SHOW_EDITORS = 1;
const DEFAULT_MAP_VIEW_DISPLAY_ID = 'display:0';

/**
 * Mutable `mapview` configure fields.
 * Mirrors `TileViewConfigSpecs` (`-font`, `-messagevar`, `-width`, `-height`)
 * in `ref/micropolis/src/sim/w_tk.c`.
 * Difference from C: these fields are explicit TypeScript state instead of Tk-managed option slots.
 */
export interface MapViewConfigureState {
  font: string;
  messageVar: string | null;
  width: number;
  height: number;
}

/**
 * Mutable state for one created map view command.
 * Mirrors command-visible `SimView` fields used by `MapCmdconfigure`,
 * `MapCmdposition`, `MapCmdsize`, `MapCmdMapState`, `MapCmdShowEditors`,
 * `MapCmdPanStart`, `MapCmdPanTo`, `MapCmdVisible`, and `MapCmdViewAt` in
 * `ref/micropolis/src/sim/w_map.c`,
 * plus map-view initialization in `InitNewView` (`ref/micropolis/src/sim/w_x.c`).
 * Difference from C: Tk/X11 pointers, rendering buffers, and linked-list ownership are omitted.
 */
export interface MapViewState {
  commandName: string;
  displayId: string;
  visible: number;
  isMapped: number;
  mapState: number;
  showEditors: number;
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
  invalid: number;
  lastX: number;
  lastY: number;
  trackInfo: MapViewTrackedEditorState | null;
  configure: MapViewConfigureState;
}

/**
 * Constructor overrides for `createMapViewState`.
 * Mirrors initialization inputs to `InitNewView(..., Map_Class, MAP_W, MAP_H)`
 * from `ref/micropolis/src/sim/w_tk.c` and `ref/micropolis/src/sim/w_x.c`,
 * including map defaults `map_state=ALMAP`, `show_editors=1`, and zeroed
 * track/visibility fields.
 */
export interface CreateMapViewStateOptions {
  displayId?: string;
  visible?: number;
  isMapped?: number;
  mapState?: number;
  showEditors?: number;
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
  invalid?: number;
  lastX?: number;
  lastY?: number;
  trackInfo?: MapViewTrackedEditorState | null;
  configure?: Partial<MapViewConfigureState>;
}

/**
 * Minimal editor-view shape used by map-view track/pan commands.
 * Mirrors `SimView` fields read/written by `MapCmdPanStart`/`MapCmdPanTo`
 * (`show_me`, `w_width`, `w_height`, `pan_x`, `pan_y`, `skip`, and display pointer `x`)
 * in `ref/micropolis/src/sim/w_map.c`.
 * Difference from C: this uses a typed structural interface rather than raw `SimView *`.
 */
export interface MapViewTrackedEditorState {
  displayId?: string;
  showMe: number;
  wWidth: number;
  wHeight: number;
  panX: number;
  panY: number;
  iWidth: number;
  iHeight: number;
  skip: number;
}

/**
 * Optional side-effect hooks used by map-view subcommands.
 * Mirrors side effects in `w_map.c` + `DoSetMapState` (`w_util.c`) and `DoPanBy` (`w_x.c`):
 * map-state callback dispatch, editor lookup for tracking, and pan application.
 * Difference from C: external calls are injected as callbacks instead of direct global calls.
 */
export interface MapViewSubcommandHooks {
  onSetMapState?: (viewState: MapViewState, mapState: number) => void;
  listEditorsForPan?: (viewState: MapViewState) => Iterable<MapViewTrackedEditorState>;
  onPanByEditor?: (
    mapViewState: MapViewState,
    editorViewState: MapViewTrackedEditorState,
    dx: number,
    dy: number,
  ) => void;
}

/**
 * Constructor options for `createMapViewSubcommandEntries`.
 * Mirrors `map_command_init` registration wiring and runtime dependencies used
 * by `MapCmdMapState`/`MapCmdPanTo` in `ref/micropolis/src/sim/w_map.c`.
 */
export interface CreateMapViewSubcommandEntriesOptions {
  kickState?: SimKickState;
  kickHooks?: SimKickHooks;
  hooks?: MapViewSubcommandHooks;
}

/**
 * Subcommand names registered for the P2.5 map-view shell.
 * Mirrors `MAP_CMD(configure|position|size|MapState|ShowEditors|PanStart|PanTo|Visible|ViewAt)` registrations from
 * `map_command_init` in `ref/micropolis/src/sim/w_map.c`.
 */
export const MAP_VIEW_SUBCOMMAND_NAMES = [
  'configure',
  'position',
  'size',
  'MapState',
  'ShowEditors',
  'PanStart',
  'PanTo',
  'Visible',
  'ViewAt',
] as const;

/**
 * Union of supported map-view shell subcommands.
 */
export type MapViewSubcommandName = (typeof MAP_VIEW_SUBCOMMAND_NAMES)[number];

/**
 * Handler signature for `<mapViewPath> <Subcommand> ...`.
 * Mirrors `MapCmd*` function pointers looked up through `MapCmds`
 * in `DoMapCmd` (`ref/micropolis/src/sim/w_map.c`).
 */
export type MapViewSubcommandHandler = (
  viewState: MapViewState,
  argv: readonly string[],
) => ScriptRuntimeResult;

/**
 * Case-sensitive `mapview` subcommand table.
 * Mirrors `Tcl_HashTable MapCmds` lookup behavior in `DoMapCmd`
 * (`ref/micropolis/src/sim/w_map.c`).
 */
export type MapViewSubcommandTable = ReadonlyMap<string, MapViewSubcommandHandler>;

/**
 * One `mapview` subcommand registration tuple.
 * Mirrors one `MAP_CMD(name)` hash-table insertion in `map_command_init`
 * (`ref/micropolis/src/sim/w_map.c`).
 */
export type MapViewSubcommandEntry = readonly [name: string, handler: MapViewSubcommandHandler];

const MAP_VIEW_CONFIGURE_OPTION_NAMES = ['-font', '-messagevar', '-width', '-height'] as const;
type MapViewConfigureOptionName = (typeof MAP_VIEW_CONFIGURE_OPTION_NAMES)[number];

/**
 * Parses a Tcl-style integer and enforces 32-bit C `int` range.
 * Mirrors `Tcl_GetInt` usage in `MapCmdposition`/`MapCmdsize`
 * (`ref/micropolis/src/sim/w_map.c`).
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
 * Performs C-style integer division with truncation toward zero.
 * Mirrors signed `int` division semantics used by `MapCmdPanStart`/`MapCmdPanTo`
 * in `ref/micropolis/src/sim/w_map.c` for `* 3 / 16` and `* 16 / 3` conversions.
 */
function divideIntTruncTowardZero(numerator: number, denominator: number): number {
  return Math.trunc(numerator / denominator);
}

/**
 * Creates a typed invalid-argc runtime result.
 * Mirrors `TCL_ERROR` returns from `MapCmd*` handlers when argc is unexpected
 * in `ref/micropolis/src/sim/w_map.c`.
 */
function makeInvalidArgCount(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidArgCount, message));
}

/**
 * Creates a typed invalid-integer runtime result.
 * Mirrors `Tcl_GetInt(...) != TCL_OK` error paths in `MapCmdposition` and
 * `MapCmdsize` (`ref/micropolis/src/sim/w_map.c`).
 */
function makeInvalidInteger(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidInteger, message));
}

/**
 * Converts a configure option-name token to the typed option union.
 * Mirrors option-name matching done by Tk configuration APIs in
 * `MapCmdconfigure`/`ConfigureTileView` (`ref/micropolis/src/sim/w_map.c`, `w_tk.c`).
 */
function toMapViewConfigureOptionName(raw: string): MapViewConfigureOptionName | null {
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
 * Reads one configure option from map-view state.
 * Mirrors single-option `Tk_ConfigureInfo(..., argv[2], ...)` reads in
 * `MapCmdconfigure` (`ref/micropolis/src/sim/w_map.c`).
 */
function readMapViewConfigureOption(
  viewState: MapViewState,
  optionName: MapViewConfigureOptionName,
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
 * `MapCmdconfigure` (`ref/micropolis/src/sim/w_map.c`).
 * Difference from C: this returns a simplified flat list instead of Tk's full 5-field tuples.
 */
function serializeMapViewConfigureOptions(viewState: MapViewState): string {
  return MAP_VIEW_CONFIGURE_OPTION_NAMES.map((optionName) => {
    return `${optionName} ${readMapViewConfigureOption(viewState, optionName)}`;
  }).join(' ');
}

/**
 * Applies one configure option write to map-view state.
 * Mirrors `ConfigureTileView` field updates via `TileViewConfigSpecs` in
 * `ref/micropolis/src/sim/w_tk.c`.
 */
function writeMapViewConfigureOption(
  viewState: MapViewState,
  optionName: MapViewConfigureOptionName,
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
 * Applies `configure` option/value pairs for map-view creation and command writes.
 * Mirrors the `ConfigureTileView(..., argc-2, argv+2, ...)` write path in
 * `MapCmdconfigure` (`ref/micropolis/src/sim/w_map.c`).
 */
function applyMapViewConfigureOptionPairs(
  viewState: MapViewState,
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

    const optionName = toMapViewConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${contextLabel} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    const writeResult = writeMapViewConfigureOption(
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
 * Implements the `configure` map-view subcommand.
 * Mirrors `MapCmdconfigure` in `ref/micropolis/src/sim/w_map.c`.
 * Parity note: this preserves argc shape and option handling but returns a
 * simplified option listing instead of Tk's full configure-info payload.
 */
function handleMapViewConfigureSubcommand(
  viewState: MapViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length === 2) {
    return makeScriptSuccess(serializeMapViewConfigureOptions(viewState));
  }

  if (argv.length === 3) {
    const rawOptionName = argv[2];
    if (rawOptionName === undefined) {
      return makeInvalidArgCount(
        `${viewState.commandName} configure missing option name at argv[2]`,
      );
    }

    const optionName = toMapViewConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${viewState.commandName} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    return makeScriptSuccess(readMapViewConfigureOption(viewState, optionName));
  }

  const writeResult = applyMapViewConfigureOptionPairs(
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
 * Implements the `position` map-view subcommand.
 * Mirrors `MapCmdposition` in `ref/micropolis/src/sim/w_map.c`:
 * accepts argc 2 or 4, parses `x y` with `Tcl_GetInt`, and returns `w_x w_y`.
 */
function handleMapViewPositionSubcommand(
  viewState: MapViewState,
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
 * Implements the `size` map-view subcommand.
 * Mirrors `MapCmdsize` in `ref/micropolis/src/sim/w_map.c`:
 * accepts argc 2 or 4, parses `w h` with `Tcl_GetInt`, and returns `w_width w_height`.
 */
function handleMapViewSizeSubcommand(
  viewState: MapViewState,
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
    viewState.mWidth = parsedWidth;
    viewState.mHeight = parsedHeight;
  }

  return makeScriptSuccess(`${viewState.wWidth} ${viewState.wHeight}`);
}

/**
 * Applies map-view-originated pan deltas to an editor pan target.
 * Mirrors `DoPanBy(ed, dx, dy)` clamp semantics from `ref/micropolis/src/sim/w_x.c`
 * used by `MapCmdPanTo` in `ref/micropolis/src/sim/w_map.c`.
 * Difference from C: this only updates `panX/panY` and does not trigger redraw/tile-span recomputation.
 */
function runMapViewDefaultPanByEditor(
  editorViewState: MapViewTrackedEditorState,
  dx: number,
  dy: number,
): void {
  let panX = editorViewState.panX + dx;
  let panY = editorViewState.panY + dy;

  if (panX < 0) {
    panX = 0;
  }
  if (panY < 0) {
    panY = 0;
  }
  if (panX > editorViewState.iWidth) {
    panX = editorViewState.iWidth - 1;
  }
  if (panY > editorViewState.iHeight) {
    panY = editorViewState.iHeight - 1;
  }

  editorViewState.panX = panX;
  editorViewState.panY = panY;
}

/**
 * Builds the `MapState` subcommand handler.
 * Mirrors `MapCmdMapState` in `ref/micropolis/src/sim/w_map.c`, including
 * `DoSetMapState(view, state); Kick();` sequencing on write.
 */
function createMapViewMapStateSubcommandHandler(
  kickState: SimKickState,
  kickHooks: SimKickHooks,
  hooks: MapViewSubcommandHooks,
): MapViewSubcommandHandler {
  return (viewState: MapViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 2 && argv.length !== 3) {
      return makeInvalidArgCount(
        `${viewState.commandName} MapState expects argc 2 or 3, got ${argv.length}`,
      );
    }

    if (argv.length === 3) {
      const rawState = argv[2];
      if (rawState === undefined) {
        return makeInvalidArgCount(`${viewState.commandName} MapState missing map state argument`);
      }

      const parsedState = parseTclInt32(rawState);
      if (parsedState === null || parsedState < 0 || parsedState >= MAP_VIEW_STATE_COUNT) {
        return makeInvalidInteger(
          `${viewState.commandName} MapState expected an integer state in range 0..${MAP_VIEW_STATE_COUNT - 1}: ${rawState}`,
        );
      }

      viewState.mapState = parsedState;
      viewState.invalid = 1;
      hooks.onSetMapState?.(viewState, parsedState);
      runSimKick(kickState, kickHooks);
    }

    return makeScriptSuccess(String(viewState.mapState));
  };
}

/**
 * Implements the `ShowEditors` map-view subcommand.
 * Mirrors `MapCmdShowEditors` in `ref/micropolis/src/sim/w_map.c`.
 */
function handleMapViewShowEditorsSubcommand(
  viewState: MapViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2 && argv.length !== 3) {
    return makeInvalidArgCount(
      `${viewState.commandName} ShowEditors expects argc 2 or 3, got ${argv.length}`,
    );
  }

  if (argv.length === 3) {
    const rawValue = argv[2];
    if (rawValue === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} ShowEditors missing flag argument`);
    }

    const parsedValue = parseTclInt32(rawValue);
    if (parsedValue === null) {
      return makeInvalidInteger(
        `${viewState.commandName} ShowEditors expected an integer flag: ${rawValue}`,
      );
    }

    viewState.showEditors = parsedValue;
  }

  return makeScriptSuccess(String(viewState.showEditors));
}

/**
 * Builds the `PanStart` map-view subcommand handler.
 * Mirrors `MapCmdPanStart` in `ref/micropolis/src/sim/w_map.c`, including
 * the editor-bounds hit-test conversion `value * 3 / 16` with `±4` padding.
 */
function createMapViewPanStartSubcommandHandler(
  hooks: MapViewSubcommandHooks,
): MapViewSubcommandHandler {
  return (viewState: MapViewState, argv: readonly string[]): ScriptRuntimeResult => {
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

    let trackedEditor: MapViewTrackedEditorState | null = null;
    const editors = hooks.listEditorsForPan?.(viewState);
    if (editors !== undefined) {
      for (const editorViewState of editors) {
        if (editorViewState.showMe === 0) {
          continue;
        }
        if (
          editorViewState.displayId !== undefined &&
          editorViewState.displayId !== viewState.displayId
        ) {
          continue;
        }

        const width = editorViewState.wWidth;
        const height = editorViewState.wHeight;

        let left = editorViewState.panX - divideIntTruncTowardZero(width, 2);
        let top = editorViewState.panY - divideIntTruncTowardZero(height, 2);
        let right = left + width;
        let bottom = top + height;

        left =
          divideIntTruncTowardZero(left * MAP_VIEW_SCALE, MAP_VIEW_PIXELS_PER_TILE) -
          MAP_VIEW_TRACK_PADDING;
        top =
          divideIntTruncTowardZero(top * MAP_VIEW_SCALE, MAP_VIEW_PIXELS_PER_TILE) -
          MAP_VIEW_TRACK_PADDING;
        right =
          divideIntTruncTowardZero(right * MAP_VIEW_SCALE, MAP_VIEW_PIXELS_PER_TILE) +
          MAP_VIEW_TRACK_PADDING;
        bottom =
          divideIntTruncTowardZero(bottom * MAP_VIEW_SCALE, MAP_VIEW_PIXELS_PER_TILE) +
          MAP_VIEW_TRACK_PADDING;

        if (parsedX >= left && parsedX <= right && parsedY >= top && parsedY <= bottom) {
          trackedEditor = editorViewState;
          break;
        }
      }
    }

    viewState.lastX = parsedX;
    viewState.lastY = parsedY;
    viewState.trackInfo = trackedEditor;
    return makeScriptSuccess('');
  };
}

/**
 * Builds the `PanTo` map-view subcommand handler.
 * Mirrors `MapCmdPanTo` in `ref/micropolis/src/sim/w_map.c`, including
 * delta conversion `dx = dx * 16 / 3`, `dy = dy * 16 / 3`, `ed->skip = 0`,
 * and `Kick()` only when movement occurred.
 */
function createMapViewPanToSubcommandHandler(
  kickState: SimKickState,
  kickHooks: SimKickHooks,
  hooks: MapViewSubcommandHooks,
): MapViewSubcommandHandler {
  return (viewState: MapViewState, argv: readonly string[]): ScriptRuntimeResult => {
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

    const trackedEditor = viewState.trackInfo;
    if (trackedEditor !== null) {
      let deltaX = parsedX - viewState.lastX;
      let deltaY = parsedY - viewState.lastY;
      if (deltaX !== 0 || deltaY !== 0) {
        viewState.lastX = parsedX;
        viewState.lastY = parsedY;
        deltaX = divideIntTruncTowardZero(deltaX * MAP_VIEW_PIXELS_PER_TILE, MAP_VIEW_SCALE);
        deltaY = divideIntTruncTowardZero(deltaY * MAP_VIEW_PIXELS_PER_TILE, MAP_VIEW_SCALE);
        trackedEditor.skip = 0;
        if (hooks.onPanByEditor === undefined) {
          runMapViewDefaultPanByEditor(trackedEditor, deltaX, deltaY);
        } else {
          hooks.onPanByEditor(viewState, trackedEditor, deltaX, deltaY);
        }
        runSimKick(kickState, kickHooks);
      }
    }

    return makeScriptSuccess('');
  };
}

/**
 * Implements the `Visible` map-view subcommand.
 * Mirrors `MapCmdVisible` in `ref/micropolis/src/sim/w_map.c`.
 * Difference from C: Tk mapping state is represented by `viewState.isMapped`.
 */
function handleMapViewVisibleSubcommand(
  viewState: MapViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2 && argv.length !== 3) {
    return makeInvalidArgCount(
      `${viewState.commandName} Visible expects argc 2 or 3, got ${argv.length}`,
    );
  }

  if (argv.length === 3) {
    const rawVisible = argv[2];
    if (rawVisible === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} Visible missing visible argument`);
    }

    const parsedVisible = parseTclInt32(rawVisible);
    if (parsedVisible === null || parsedVisible < 0 || parsedVisible > 1) {
      return makeInvalidInteger(
        `${viewState.commandName} Visible expected an integer visible in range 0..1: ${rawVisible}`,
      );
    }

    viewState.visible = parsedVisible !== 0 && viewState.isMapped !== 0 ? 1 : 0;
  }

  return makeScriptSuccess(String(viewState.visible));
}

/**
 * Implements the `ViewAt` map-view subcommand.
 * Mirrors `MapCmdViewAt` in `ref/micropolis/src/sim/w_map.c`.
 * Parity note: this intentionally returns the same placeholder string as C.
 */
function handleMapViewViewAtSubcommand(
  viewState: MapViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 4) {
    return makeInvalidArgCount(
      `${viewState.commandName} ViewAt expects argc 4, got ${argv.length}`,
    );
  }

  const rawX = argv[2];
  const rawY = argv[3];
  if (rawX === undefined || rawY === undefined) {
    return makeInvalidArgCount(`${viewState.commandName} ViewAt missing x/y arguments`);
  }

  const parsedX = parseTclInt32(rawX);
  if (parsedX === null || parsedX < 0 || parsedX >= viewState.worldWidth) {
    return makeInvalidInteger(
      `${viewState.commandName} ViewAt expected an integer x in range 0..${viewState.worldWidth - 1}: ${rawX}`,
    );
  }

  const parsedY = parseTclInt32(rawY);
  if (parsedY === null || parsedY < 0 || parsedY >= viewState.worldHeight) {
    return makeInvalidInteger(
      `${viewState.commandName} ViewAt expected an integer y in range 0..${viewState.worldHeight - 1}: ${rawY}`,
    );
  }

  return makeScriptSuccess('Sorry Not Implemented Yet');
}

/**
 * Creates the mutable state backing one `mapview` widget command.
 * Mirrors default initialization in `InitNewView` (`w_x/w_y = 0`) and
 * map-size initialization through `InitNewView(..., MAP_W, MAP_H)` in
 * `ref/micropolis/src/sim/w_tk.c` + `ref/micropolis/src/sim/w_x.c`,
 * with `MAP_W/H = WORLD_X/Y * 3` from `ref/micropolis/src/sim/headers/sim.h`.
 * Parity note: defaults include `map_state=ALMAP (0)`, `show_editors=1`,
 * and zeroed track metadata as in `InitNewView`.
 * Difference from C: this state is plain data, without allocating a Tk window.
 */
export function createMapViewState(
  commandName: string,
  options: CreateMapViewStateOptions = {},
): MapViewState {
  const worldWidth = options.worldWidth ?? DEFAULT_WORLD_WIDTH;
  const worldHeight = options.worldHeight ?? DEFAULT_WORLD_HEIGHT;
  const wWidth = options.wWidth ?? worldWidth * MAP_VIEW_SCALE;
  const wHeight = options.wHeight ?? worldHeight * MAP_VIEW_SCALE;

  return {
    commandName,
    displayId: options.displayId ?? DEFAULT_MAP_VIEW_DISPLAY_ID,
    visible: options.visible ?? DEFAULT_MAP_VIEW_VISIBLE,
    isMapped: options.isMapped ?? DEFAULT_MAP_VIEW_IS_MAPPED,
    mapState: options.mapState ?? DEFAULT_MAP_VIEW_STATE,
    showEditors: options.showEditors ?? DEFAULT_MAP_VIEW_SHOW_EDITORS,
    wX: options.wX ?? 0,
    wY: options.wY ?? 0,
    wWidth,
    wHeight,
    worldWidth,
    worldHeight,
    iWidth: options.iWidth ?? worldWidth << 4,
    iHeight: options.iHeight ?? worldHeight << 4,
    mWidth: options.mWidth ?? wWidth,
    mHeight: options.mHeight ?? wHeight,
    invalid: options.invalid ?? 0,
    lastX: options.lastX ?? 0,
    lastY: options.lastY ?? 0,
    trackInfo: options.trackInfo ?? null,
    configure: {
      font: options.configure?.font ?? DEFAULT_MAP_VIEW_FONT,
      messageVar: options.configure?.messageVar ?? null,
      width: options.configure?.width ?? 0,
      height: options.configure?.height ?? 0,
    },
  };
}

/**
 * Builds map-view subcommand entries for the P2.5 command set.
 * Mirrors `MAP_CMD(...)` registration in
 * `map_command_init` (`ref/micropolis/src/sim/w_map.c`).
 * Parity note: subcommand coverage is a 1:1 port.
 */
export function createMapViewSubcommandEntries(
  options: CreateMapViewSubcommandEntriesOptions = {},
): readonly MapViewSubcommandEntry[] {
  const kickState = options.kickState ?? createSimKickState();
  const kickHooks = options.kickHooks ?? {};
  const hooks = options.hooks ?? {};

  return [
    ['configure', handleMapViewConfigureSubcommand] as const,
    ['position', handleMapViewPositionSubcommand] as const,
    ['size', handleMapViewSizeSubcommand] as const,
    ['MapState', createMapViewMapStateSubcommandHandler(kickState, kickHooks, hooks)] as const,
    ['ShowEditors', handleMapViewShowEditorsSubcommand] as const,
    ['PanStart', createMapViewPanStartSubcommandHandler(hooks)] as const,
    ['PanTo', createMapViewPanToSubcommandHandler(kickState, kickHooks, hooks)] as const,
    ['Visible', handleMapViewVisibleSubcommand] as const,
    ['ViewAt', handleMapViewViewAtSubcommand] as const,
  ];
}

/**
 * Builds a case-sensitive map-view subcommand lookup table.
 * Mirrors `Tcl_HashTable MapCmds` registration behavior in
 * `map_command_init`/`DoMapCmd` (`ref/micropolis/src/sim/w_map.c`).
 * Parity note: duplicate names use last-registration-wins map semantics.
 */
export function createMapViewSubcommandTable(
  entries: readonly MapViewSubcommandEntry[] = [],
): MapViewSubcommandTable {
  const table = new Map<string, MapViewSubcommandHandler>();

  for (const [name, handler] of entries) {
    table.set(name, handler);
  }

  return table;
}

/**
 * Default subcommand table for P2.5 map-view shell behavior.
 * Mirrors `map_command_init` registrations for the full current map-view
 * command set in `ref/micropolis/src/sim/w_map.c`.
 */
export const MAP_VIEW_SUBCOMMAND_TABLE = createMapViewSubcommandTable(
  createMapViewSubcommandEntries(),
);

/**
 * Creates the per-widget map-view dispatcher bound to one view state.
 * Mirrors `DoMapCmd` subcommand lookup flow in `ref/micropolis/src/sim/w_map.c`.
 * Difference from C: this uses typed runtime errors instead of `Tcl_AppendResult`.
 */
export function createMapViewWidgetCommandDispatcher(
  viewState: MapViewState,
  subcommands: MapViewSubcommandTable = MAP_VIEW_SUBCOMMAND_TABLE,
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
          `unknown mapview subcommand: ${subcommandName}`,
        ),
      );
    }

    return subcommandHandler(viewState, argv);
  };
}

/**
 * Constructor options for `createMapViewCommandDispatcher`.
 * Mirrors state and command wiring around `TileViewCmd` + `DoMapCmd`
 * in `ref/micropolis/src/sim/w_tk.c` and `ref/micropolis/src/sim/w_map.c`.
 */
export interface CreateMapViewCommandDispatcherOptions {
  runtime: ScriptRuntime;
  views?: ViewRegistry<MapViewState>;
  createViewState?: (commandName: string) => MapViewState;
  subcommands?: MapViewSubcommandTable;
}

/**
 * Creates the top-level `mapview` factory command dispatcher.
 * Mirrors `TileViewCmd` creation flow for `mapview pathName ?options?` in
 * `ref/micropolis/src/sim/w_tk.c`: create a view, register a widget command, and return pathName.
 * Parity note: Tk window/event setup is intentionally omitted; this shell only models scripting state.
 */
export function createMapViewCommandDispatcher(
  options: CreateMapViewCommandDispatcherOptions,
): ScriptCommandHandler {
  const views = options.views ?? new ViewRegistry<MapViewState>();
  const createViewState =
    options.createViewState ?? ((commandName: string) => createMapViewState(commandName));
  const subcommands = options.subcommands ?? MAP_VIEW_SUBCOMMAND_TABLE;

  return (argv: readonly string[]): ScriptRuntimeResult => {
    const commandName = argv[1];
    if (commandName === undefined || commandName.length === 0) {
      return makeInvalidArgCount('mapview command requires a pathName in argv[1]');
    }

    if (views.get(commandName) !== undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `mapview command already exists: ${commandName}`,
        ),
      );
    }

    const viewState = createViewState(commandName);
    const configureResult = applyMapViewConfigureOptionPairs(
      viewState,
      argv.slice(2),
      `mapview ${commandName}`,
    );
    if (configureResult !== null) {
      return configureResult;
    }

    views.add(commandName, viewState);
    options.runtime.registerCommand(
      commandName,
      createMapViewWidgetCommandDispatcher(viewState, subcommands),
    );
    return makeScriptSuccess(commandName);
  };
}

/**
 * Registers the top-level `mapview` command in a runtime.
 * Mirrors `Tcl_CreateCommand(..., "mapview", TileViewCmd, ...)` in
 * `map_command_init` (`ref/micropolis/src/sim/w_map.c`), scoped to map-view shell behavior.
 * Parity note: top-level command-name registration is a 1:1 behavior port.
 */
export function registerMapViewCommand(
  runtime: ScriptRuntime,
  options: Omit<CreateMapViewCommandDispatcherOptions, 'runtime'> = {},
): void {
  runtime.registerCommand(
    'mapview',
    createMapViewCommandDispatcher({
      runtime,
      ...options,
    }),
  );
}
