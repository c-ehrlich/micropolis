import {
  makeScriptFailure,
  makeScriptSuccess,
  ScriptRuntimeError,
  ScriptRuntimeErrorCode,
} from '../runtime/errors.ts';
import { ScriptResultCode, type ScriptRuntimeResult } from '../runtime/result-code.ts';
import type { ScriptCommandHandler, ScriptRuntime } from '../runtime/script-runtime.ts';
import { WidgetRegistry } from '../state/widget-registry.ts';

const TCL_INT32_MIN = -2147483648n;
const TCL_INT32_MAX = 2147483647n;

const DEFAULT_PIE_MENU_ACTIVE_BACKGROUND = '#bfbfbf';
const DEFAULT_PIE_MENU_ACTIVE_BORDER_WIDTH = 2;
const DEFAULT_PIE_MENU_ACTIVE_FOREGROUND = 'black';
const DEFAULT_PIE_MENU_BACKGROUND = '#bfbfbf';
const DEFAULT_PIE_MENU_BORDER_WIDTH = 2;
const DEFAULT_PIE_MENU_CURSOR = 'circle';
const DEFAULT_PIE_MENU_FOREGROUND = 'black';
const DEFAULT_PIE_MENU_FONT = '-Adobe-Helvetica-Bold-R-Normal-*-120-*';
const DEFAULT_PIE_MENU_TITLE = '';
const DEFAULT_PIE_MENU_PREVIEW = '';
const DEFAULT_PIE_MENU_TITLE_FONT = DEFAULT_PIE_MENU_FONT;
const DEFAULT_PIE_MENU_INITIAL_ANGLE = 0;
const DEFAULT_PIE_MENU_INACTIVE_RADIUS = 8;
const DEFAULT_PIE_MENU_MIN_RADIUS = 16;
const DEFAULT_PIE_MENU_EXTRA_RADIUS = 2;
const DEFAULT_PIE_MENU_FIXED_RADIUS = 0;
const DEFAULT_PIE_MENU_ACTIVE_INDEX = -1;
const DEFAULT_PIE_MENU_POPUP_DELAY = 250;
const DEFAULT_PIE_MENU_SHAPED = 1;

const PIE_MENU_ENTRY_TYPE_COMMAND = 'command';
const PIE_MENU_ENTRY_TYPE_PIEMENU = 'piemenu';

const PIE_MENU_CONFIGURE_OPTION_NAMES = [
  '-activebackground',
  '-activeborderwidth',
  '-activeforeground',
  '-background',
  '-borderwidth',
  '-cursor',
  '-foreground',
  '-font',
  '-title',
  '-preview',
  '-titlefont',
  '-initialangle',
  '-inactiveradius',
  '-minradius',
  '-extraradius',
  '-fixedradius',
  '-active',
  '-popupdelay',
  '-shaped',
] as const;

const PIE_MENU_ENTRY_CONFIGURE_OPTION_NAMES = [
  '-activebackground',
  '-background',
  '-bitmap',
  '-command',
  '-preview',
  '-font',
  '-label',
  '-piemenu',
  '-xoffset',
  '-yoffset',
] as const;

/**
 * Supported pie-menu entry kinds.
 * Mirrors `COMMAND_ENTRY` and `PIEMENU_ENTRY` in
 * `ref/micropolis/src/sim/w_piem.c`.
 */
export type PieMenuEntryType =
  | typeof PIE_MENU_ENTRY_TYPE_COMMAND
  | typeof PIE_MENU_ENTRY_TYPE_PIEMENU;

/**
 * Mutable `piemenu` configure fields.
 * Mirrors `configSpecs` in `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: this stores scalar option values explicitly instead of Tk-managed config slots.
 */
export interface PieMenuConfigureState {
  activeBackground: string;
  activeBorderWidth: number;
  activeForeground: string;
  background: string;
  borderWidth: number;
  cursor: string | null;
  foreground: string;
  font: string;
  title: string;
  preview: string;
  titleFont: string;
  initialAngle: number;
  inactiveRadius: number;
  minRadius: number;
  extraRadius: number;
  fixedRadius: number;
  active: number;
  popupDelay: number;
  shaped: number;
}

/**
 * Mutable state for one pie-menu entry.
 * Mirrors `PieMenuEntry` script-configurable fields from `entryConfigSpecs`
 * in `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: pixmap/font/border handles are represented as simple nullable names.
 */
export interface PieMenuEntryState {
  type: PieMenuEntryType;
  label: string | null;
  command: string | null;
  preview: string | null;
  piemenu: string | null;
  bitmap: string | null;
  font: string | null;
  background: string | null;
  activeBackground: string | null;
  xOffset: number;
  yOffset: number;
}

/**
 * Mutable state for one created pie-menu command.
 * Mirrors script-visible portions of `PieMenu` in `ref/micropolis/src/sim/w_piem.c`
 * that are required by Phase 4 subcommands (`activate`, `show`, `pending`,
 * `defer`, `configure`, `add`, `delete`, `entryconfigure`, `index`, `invoke`,
 * `post`, `unpost`, `grab`, `ungrab`, `distance`, `direction`).
 * Difference from C: Tk window/event handles and drawing caches are not modeled.
 */
export interface PieMenuState {
  commandName: string;
  entries: PieMenuEntryState[];
  active: number;
  popupPending: boolean;
  resizePending: boolean;
  mapped: boolean;
  group: string | null;
  rootX: number;
  rootY: number;
  centerX: number;
  centerY: number;
  dx: number;
  dy: number;
  postedSubmenu: string | null;
  grabbedWindow: string | null;
  configure: PieMenuConfigureState;
}

/**
 * Constructor overrides for `createPieMenuState`.
 * Mirrors defaults initialized in `Tk_PieMenuCmd` and follow-up config in
 * `ConfigurePieMenu` (`ref/micropolis/src/sim/w_piem.c`).
 */
export interface CreatePieMenuStateOptions {
  entries?: readonly PieMenuEntryState[];
  active?: number;
  popupPending?: boolean;
  resizePending?: boolean;
  mapped?: boolean;
  group?: string | null;
  rootX?: number;
  rootY?: number;
  centerX?: number;
  centerY?: number;
  dx?: number;
  dy?: number;
  postedSubmenu?: string | null;
  grabbedWindow?: string | null;
  configure?: Partial<PieMenuConfigureState>;
}

/**
 * Hook callbacks used by pie-menu subcommands.
 * Mirrors helper/eval/window lookups used by `PieMenuWidgetCmd`,
 * `GetPieMenuIndex`, and `ActivatePieMenuEntry` in
 * `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: `@x,y` hit-testing, script eval, and window resolution
 * are injectable for deterministic tests.
 */
export interface PieMenuSubcommandHooks {
  resolveIndexAtCoordinates?: (menuState: PieMenuState, x: number, y: number) => number;
  runEntryScript?: (
    menuState: PieMenuState,
    scriptText: string,
    source: 'preview' | 'invoke',
  ) => ScriptRuntimeResult;
  resolveWindow?: (menuState: PieMenuState, windowName: string) => boolean;
}

/**
 * Constructor options for `createPieMenuSubcommandEntries`.
 * Mirrors command-table wiring in `PieMenuWidgetCmd`
 * (`ref/micropolis/src/sim/w_piem.c`).
 */
export interface CreatePieMenuSubcommandEntriesOptions {
  hooks?: PieMenuSubcommandHooks;
}

/**
 * Subcommand names registered for Phase 4 pie-menu shell behavior.
 * Mirrors the scripted `PieMenuWidgetCmd` command set in
 * `ref/micropolis/src/sim/w_piem.c`.
 */
export const PIE_MENU_SUBCOMMAND_NAMES = [
  'activate',
  'show',
  'pending',
  'defer',
  'configure',
  'add',
  'delete',
  'entryconfigure',
  'index',
  'invoke',
  'post',
  'unpost',
  'grab',
  'ungrab',
  'distance',
  'direction',
] as const;

/**
 * Union of supported pie-menu shell subcommand names.
 */
export type PieMenuSubcommandName = (typeof PIE_MENU_SUBCOMMAND_NAMES)[number];

/**
 * Handler signature for `<piePath> <Subcommand> ...`.
 * Mirrors function-pointer style dispatch in `PieMenuWidgetCmd`
 * (`ref/micropolis/src/sim/w_piem.c`).
 */
export type PieMenuSubcommandHandler = (
  menuState: PieMenuState,
  argv: readonly string[],
) => ScriptRuntimeResult;

/**
 * Case-sensitive pie-menu subcommand table.
 * Mirrors Tcl hash lookup behavior used in command dispatch across the C bridge.
 */
export type PieMenuSubcommandTable = ReadonlyMap<string, PieMenuSubcommandHandler>;

/**
 * One pie-menu subcommand registration tuple.
 * Mirrors one subcommand branch registration point in `PieMenuWidgetCmd`
 * (`ref/micropolis/src/sim/w_piem.c`).
 */
export type PieMenuSubcommandEntry = readonly [name: string, handler: PieMenuSubcommandHandler];

type PieMenuConfigureOptionName = (typeof PIE_MENU_CONFIGURE_OPTION_NAMES)[number];
type PieMenuEntryConfigureOptionName = (typeof PIE_MENU_ENTRY_CONFIGURE_OPTION_NAMES)[number];

/**
 * Parses a Tcl-style integer and enforces 32-bit C `int` range.
 * Mirrors `Tcl_GetInt` call sites in `PieMenuWidgetCmd` and `GetPieMenuIndex`
 * (`ref/micropolis/src/sim/w_piem.c`).
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

function makeInvalidArgCount(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidArgCount, message));
}

function makeInvalidInteger(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidInteger, message));
}

function toPieMenuConfigureOptionName(raw: string): PieMenuConfigureOptionName | null {
  switch (raw) {
    case '-activebackground':
    case '-activeborderwidth':
    case '-activeforeground':
    case '-background':
    case '-borderwidth':
    case '-cursor':
    case '-foreground':
    case '-font':
    case '-title':
    case '-preview':
    case '-titlefont':
    case '-initialangle':
    case '-inactiveradius':
    case '-minradius':
    case '-extraradius':
    case '-fixedradius':
    case '-active':
    case '-popupdelay':
    case '-shaped':
      return raw;
    case '-bd':
      return '-borderwidth';
    case '-bg':
      return '-background';
    case '-fg':
      return '-foreground';
    default:
      return null;
  }
}

function readPieMenuConfigureOption(
  menuState: PieMenuState,
  optionName: PieMenuConfigureOptionName,
): string {
  switch (optionName) {
    case '-activebackground':
      return menuState.configure.activeBackground;
    case '-activeborderwidth':
      return String(menuState.configure.activeBorderWidth);
    case '-activeforeground':
      return menuState.configure.activeForeground;
    case '-background':
      return menuState.configure.background;
    case '-borderwidth':
      return String(menuState.configure.borderWidth);
    case '-cursor':
      return menuState.configure.cursor ?? '';
    case '-foreground':
      return menuState.configure.foreground;
    case '-font':
      return menuState.configure.font;
    case '-title':
      return menuState.configure.title;
    case '-preview':
      return menuState.configure.preview;
    case '-titlefont':
      return menuState.configure.titleFont;
    case '-initialangle':
      return String(menuState.configure.initialAngle);
    case '-inactiveradius':
      return String(menuState.configure.inactiveRadius);
    case '-minradius':
      return String(menuState.configure.minRadius);
    case '-extraradius':
      return String(menuState.configure.extraRadius);
    case '-fixedradius':
      return String(menuState.configure.fixedRadius);
    case '-active':
      return String(menuState.active);
    case '-popupdelay':
      return String(menuState.configure.popupDelay);
    case '-shaped':
      return String(menuState.configure.shaped);
  }
}

function serializePieMenuConfigureOptions(menuState: PieMenuState): string {
  return PIE_MENU_CONFIGURE_OPTION_NAMES.map((optionName) => {
    return `${optionName} ${readPieMenuConfigureOption(menuState, optionName)}`;
  }).join(' ');
}

function writePieMenuConfigureOption(
  menuState: PieMenuState,
  optionName: PieMenuConfigureOptionName,
  optionValue: string,
  contextLabel: string,
): ScriptRuntimeResult | null {
  switch (optionName) {
    case '-activebackground':
      menuState.configure.activeBackground = optionValue;
      return null;
    case '-activeborderwidth': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer active border width: ${optionValue}`,
        );
      }
      menuState.configure.activeBorderWidth = parsed;
      return null;
    }
    case '-activeforeground':
      menuState.configure.activeForeground = optionValue;
      return null;
    case '-background':
      menuState.configure.background = optionValue;
      return null;
    case '-borderwidth': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer border width: ${optionValue}`,
        );
      }
      menuState.configure.borderWidth = parsed;
      return null;
    }
    case '-cursor':
      menuState.configure.cursor = optionValue;
      return null;
    case '-foreground':
      menuState.configure.foreground = optionValue;
      return null;
    case '-font':
      menuState.configure.font = optionValue;
      return null;
    case '-title':
      menuState.configure.title = optionValue;
      return null;
    case '-preview':
      menuState.configure.preview = optionValue;
      return null;
    case '-titlefont':
      menuState.configure.titleFont = optionValue;
      return null;
    case '-initialangle': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer initial angle: ${optionValue}`,
        );
      }
      menuState.configure.initialAngle = parsed;
      return null;
    }
    case '-inactiveradius': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer inactive radius: ${optionValue}`,
        );
      }
      menuState.configure.inactiveRadius = parsed;
      return null;
    }
    case '-minradius': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer min radius: ${optionValue}`);
      }
      menuState.configure.minRadius = parsed;
      return null;
    }
    case '-extraradius': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer extra radius: ${optionValue}`,
        );
      }
      menuState.configure.extraRadius = parsed;
      return null;
    }
    case '-fixedradius': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer fixed radius: ${optionValue}`,
        );
      }
      menuState.configure.fixedRadius = parsed;
      return null;
    }
    case '-active': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer active index: ${optionValue}`,
        );
      }
      menuState.active = parsed;
      menuState.configure.active = parsed;
      return null;
    }
    case '-popupdelay': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer popup delay: ${optionValue}`,
        );
      }
      menuState.configure.popupDelay = parsed;
      return null;
    }
    case '-shaped': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer shaped: ${optionValue}`);
      }
      menuState.configure.shaped = parsed;
      return null;
    }
  }
}

function applyPieMenuConfigureOptionPairs(
  menuState: PieMenuState,
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

    const optionName = toPieMenuConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${contextLabel} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    const writeResult = writePieMenuConfigureOption(
      menuState,
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

function toPieMenuEntryConfigureOptionName(raw: string): PieMenuEntryConfigureOptionName | null {
  switch (raw) {
    case '-activebackground':
    case '-background':
    case '-bitmap':
    case '-command':
    case '-preview':
    case '-font':
    case '-label':
    case '-piemenu':
    case '-xoffset':
    case '-yoffset':
      return raw;
    default:
      return null;
  }
}

function supportsPieMenuEntryOption(
  entry: PieMenuEntryState,
  optionName: PieMenuEntryConfigureOptionName,
): boolean {
  if (entry.type === PIE_MENU_ENTRY_TYPE_PIEMENU && optionName === '-command') {
    return false;
  }

  return true;
}

function readPieMenuEntryConfigureOption(
  entry: PieMenuEntryState,
  optionName: PieMenuEntryConfigureOptionName,
): string {
  switch (optionName) {
    case '-activebackground':
      return entry.activeBackground ?? '';
    case '-background':
      return entry.background ?? '';
    case '-bitmap':
      return entry.bitmap ?? '';
    case '-command':
      return entry.command ?? '';
    case '-preview':
      return entry.preview ?? '';
    case '-font':
      return entry.font ?? '';
    case '-label':
      return entry.label ?? '';
    case '-piemenu':
      return entry.piemenu ?? '';
    case '-xoffset':
      return String(entry.xOffset);
    case '-yoffset':
      return String(entry.yOffset);
  }
}

function serializePieMenuEntryConfigureOptions(entry: PieMenuEntryState): string {
  return PIE_MENU_ENTRY_CONFIGURE_OPTION_NAMES.filter((optionName) => {
    return supportsPieMenuEntryOption(entry, optionName);
  })
    .map((optionName) => {
      return `${optionName} ${readPieMenuEntryConfigureOption(entry, optionName)}`;
    })
    .join(' ');
}

function writePieMenuEntryConfigureOption(
  entry: PieMenuEntryState,
  optionName: PieMenuEntryConfigureOptionName,
  optionValue: string,
  contextLabel: string,
): ScriptRuntimeResult | null {
  if (!supportsPieMenuEntryOption(entry, optionName)) {
    return makeScriptFailure(
      new ScriptRuntimeError(
        ScriptRuntimeErrorCode.Internal,
        `${contextLabel} unknown option: ${optionName}`,
      ),
    );
  }

  switch (optionName) {
    case '-activebackground':
      entry.activeBackground = optionValue;
      return null;
    case '-background':
      entry.background = optionValue;
      return null;
    case '-bitmap':
      entry.bitmap = optionValue;
      return null;
    case '-command':
      entry.command = optionValue;
      return null;
    case '-preview':
      entry.preview = optionValue;
      return null;
    case '-font':
      entry.font = optionValue;
      return null;
    case '-label':
      entry.label = optionValue;
      return null;
    case '-piemenu':
      entry.piemenu = optionValue;
      return null;
    case '-xoffset': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer x offset: ${optionValue}`);
      }
      entry.xOffset = parsed;
      return null;
    }
    case '-yoffset': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer y offset: ${optionValue}`);
      }
      entry.yOffset = parsed;
      return null;
    }
  }
}

function applyPieMenuEntryConfigureOptionPairs(
  entry: PieMenuEntryState,
  optionPairs: readonly string[],
  contextLabel: string,
): ScriptRuntimeResult | null {
  if (optionPairs.length % 2 !== 0) {
    return makeInvalidArgCount(
      `${contextLabel} expects option/value pairs, got ${optionPairs.length} trailing args`,
    );
  }

  for (let index = 0; index < optionPairs.length; index += 2) {
    const rawOptionName = optionPairs[index];
    const optionValue = optionPairs[index + 1];
    if (rawOptionName === undefined || optionValue === undefined) {
      return makeInvalidArgCount(`${contextLabel} encountered missing option/value pair`);
    }

    const optionName = toPieMenuEntryConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${contextLabel} unknown option: ${rawOptionName}`,
        ),
      );
    }

    const writeResult = writePieMenuEntryConfigureOption(
      entry,
      optionName,
      optionValue,
      contextLabel,
    );
    if (writeResult !== null) {
      return writeResult;
    }
  }

  return null;
}

function parsePieMenuEntryType(raw: string): PieMenuEntryType | null {
  if (raw.length === 0) {
    return null;
  }

  if (PIE_MENU_ENTRY_TYPE_COMMAND.startsWith(raw)) {
    return PIE_MENU_ENTRY_TYPE_COMMAND;
  }

  if (PIE_MENU_ENTRY_TYPE_PIEMENU.startsWith(raw)) {
    return PIE_MENU_ENTRY_TYPE_PIEMENU;
  }

  return null;
}

function createPieMenuEntryState(type: PieMenuEntryType): PieMenuEntryState {
  return {
    type,
    label: null,
    command: null,
    preview: null,
    piemenu: null,
    bitmap: null,
    font: null,
    background: null,
    activeBackground: null,
    xOffset: 0,
    yOffset: 0,
  };
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === undefined) {
      continue;
    }

    if (char === '*') {
      source += '.*';
      continue;
    }

    if (char === '?') {
      source += '.';
      continue;
    }

    if (char === '[') {
      let classSource = '[';
      let cursor = index + 1;
      let closed = false;

      const first = pattern[cursor];
      if (first === '!' || first === '^') {
        classSource += '^';
        cursor += 1;
      }

      if (pattern[cursor] === ']') {
        classSource += ']';
        cursor += 1;
      }

      while (cursor < pattern.length) {
        const classChar = pattern[cursor];
        if (classChar === undefined) {
          break;
        }

        if (classChar === ']') {
          classSource += ']';
          closed = true;
          break;
        }

        if (classChar === '\\') {
          const escaped = pattern[cursor + 1];
          if (escaped !== undefined) {
            classSource += `\\${escaped}`;
            cursor += 2;
            continue;
          }
        }

        if ('\\'.includes(classChar)) {
          classSource += `\\${classChar}`;
        } else {
          classSource += classChar;
        }
        cursor += 1;
      }

      if (closed) {
        source += classSource;
        index = cursor;
        continue;
      }

      source += '\\[';
      continue;
    }

    if (char === '\\') {
      const escaped = pattern[index + 1];
      if (escaped !== undefined) {
        source += escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        index += 1;
        continue;
      }

      source += '\\\\';
      continue;
    }

    source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  source += '$';
  return new RegExp(source);
}

function tclStringMatch(text: string, pattern: string): boolean {
  return globPatternToRegExp(pattern).test(text);
}

function parseAtCoordinateIndex(raw: string): readonly [number, number] | null {
  if (!raw.startsWith('@')) {
    return null;
  }

  const coordinateText = raw.slice(1);
  const commaIndex = coordinateText.indexOf(',');
  if (commaIndex <= 0 || commaIndex === coordinateText.length - 1) {
    return null;
  }

  const xText = coordinateText.slice(0, commaIndex);
  const yText = coordinateText.slice(commaIndex + 1);
  const x = parseTclInt32(xText);
  const y = parseTclInt32(yText);
  if (x === null || y === null) {
    return null;
  }

  return [x, y] as const;
}

function clampResolvedIndex(value: number, maxLength: number): number {
  if (!Number.isFinite(value)) {
    return -1;
  }

  const truncated = Math.trunc(value);
  if (truncated < 0 || truncated >= maxLength) {
    return -1;
  }

  return truncated;
}

/**
 * Updates cursor delta tracking from root-window coordinates.
 * Mirrors `CalcPieMenuItem` assignment of `menu->dx`/`menu->dy`
 * in `ref/micropolis/src/sim/w_piem.c`.
 */
function setPieMenuCursorDeltaFromRootCoordinates(
  menuState: PieMenuState,
  rootX: number,
  rootY: number,
): void {
  menuState.dx = rootX - menuState.rootX + 1;
  menuState.dy = menuState.rootY - rootY - 1;
}

/**
 * Executes preview/invoke script text through injected hooks.
 * Mirrors `Tcl_GlobalEval` call sites in `ActivatePieMenuEntry` and
 * `PieMenuWidgetCmd invoke` (`ref/micropolis/src/sim/w_piem.c`).
 * Difference from C: script execution is delegated via hook callbacks.
 */
function runPieMenuEntryScript(
  menuState: PieMenuState,
  scriptText: string,
  source: 'preview' | 'invoke',
  hooks: PieMenuSubcommandHooks,
): ScriptRuntimeResult {
  if (scriptText.length === 0) {
    return makeScriptSuccess('');
  }

  return hooks.runEntryScript?.(menuState, scriptText, source) ?? makeScriptSuccess('');
}

/**
 * Applies active-entry transitions and optional preview execution.
 * Mirrors `ActivatePieMenuEntry(menuPtr, index, preview)` in
 * `ref/micropolis/src/sim/w_piem.c`.
 */
function activatePieMenuEntry(
  menuState: PieMenuState,
  index: number,
  preview: boolean,
  hooks: PieMenuSubcommandHooks,
): ScriptRuntimeResult {
  menuState.active = index;
  menuState.configure.active = index;

  if (index < 0 || !preview) {
    return makeScriptSuccess('');
  }

  const entry = menuState.entries[index];
  if (entry === undefined) {
    return makeScriptFailure(
      new ScriptRuntimeError(ScriptRuntimeErrorCode.Internal, `bad menu entry index "${index}"`),
    );
  }

  if (entry.preview === null) {
    return makeScriptSuccess('');
  }

  return runPieMenuEntryScript(menuState, entry.preview, 'preview', hooks);
}

/**
 * Immediately maps a posted pie menu and clears popup-pending state.
 * Mirrors `NowPopupPieMenu`/`PopupPieMenu` in
 * `ref/micropolis/src/sim/w_piem.c`.
 */
function popupPieMenuNow(menuState: PieMenuState): void {
  menuState.popupPending = false;
  if (menuState.mapped) {
    return;
  }

  menuState.mapped = true;
}

/**
 * Schedules a deferred popup if the menu is not already mapped.
 * Mirrors `EventuallyPopupPieMenu` (`POPUP_PENDING` + timer scheduling)
 * in `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: timer handles are represented as a boolean flag only.
 */
function schedulePieMenuPopup(menuState: PieMenuState): void {
  menuState.popupPending = false;
  if (menuState.mapped) {
    return;
  }

  menuState.popupPending = true;
}

/**
 * Re-schedules pending popup work.
 * Mirrors `DeferPopupPieMenu` in `ref/micropolis/src/sim/w_piem.c`.
 */
function deferPieMenuPopup(menuState: PieMenuState): void {
  if (!menuState.popupPending) {
    return;
  }

  schedulePieMenuPopup(menuState);
}

/**
 * Unposts any currently tracked submenu entry.
 * Mirrors `UnpostSubPieMenu` in `ref/micropolis/src/sim/w_piem.c`.
 */
function unpostPieMenuSubmenu(menuState: PieMenuState): void {
  menuState.postedSubmenu = null;
}

/**
 * Rounds floating-point values using C `(int)(value + 0.499)` semantics.
 * Mirrors `distance`/`direction` casts in `PieMenuWidgetCmd`
 * (`ref/micropolis/src/sim/w_piem.c`).
 */
function roundCIntFromFloat(raw: number): number {
  return Math.trunc(raw + 0.499);
}

/**
 * Resolves a Tk-style window name before `grab`/`ungrab`.
 * Mirrors `Tk_NameToWindow` validation in `PieMenuWidgetCmd`
 * (`ref/micropolis/src/sim/w_piem.c`).
 * Difference from C: resolution is injected as a boolean hook.
 */
function resolvePieMenuWindow(
  menuState: PieMenuState,
  windowName: string,
  hooks: PieMenuSubcommandHooks,
): boolean {
  return hooks.resolveWindow?.(menuState, windowName) ?? true;
}

/**
 * Resolves an index token to a numeric pie-menu entry index.
 * Mirrors `GetPieMenuIndex` in `ref/micropolis/src/sim/w_piem.c`.
 * Parity note: numeric parsing only starts when the first character is a digit,
 * and unmatched values produce `bad menu entry index` errors.
 */
export function resolvePieMenuIndex(
  menuState: PieMenuState,
  indexToken: string,
  hooks: PieMenuSubcommandHooks = {},
): number | ScriptRuntimeResult {
  if (indexToken === 'active') {
    return menuState.active;
  }

  if (indexToken === 'last') {
    return menuState.entries.length - 1;
  }

  if (indexToken === 'none') {
    return -1;
  }

  const coordinateIndex = parseAtCoordinateIndex(indexToken);
  if (coordinateIndex !== null) {
    const [x, y] = coordinateIndex;
    setPieMenuCursorDeltaFromRootCoordinates(menuState, x, y);
    const resolvedRaw = hooks.resolveIndexAtCoordinates?.(menuState, x, y) ?? -1;
    return clampResolvedIndex(resolvedRaw, menuState.entries.length);
  }

  const firstChar = indexToken[0];
  if (firstChar !== undefined && /[0-9]/.test(firstChar)) {
    const parsedIndex = parseTclInt32(indexToken);
    if (parsedIndex !== null && parsedIndex >= 0 && parsedIndex < menuState.entries.length) {
      return parsedIndex;
    }
  }

  for (let index = 0; index < menuState.entries.length; index += 1) {
    const entry = menuState.entries[index];
    if (entry === undefined) {
      continue;
    }

    if (entry.label !== null && tclStringMatch(entry.label, indexToken)) {
      return index;
    }
  }

  return makeScriptFailure(
    new ScriptRuntimeError(ScriptRuntimeErrorCode.Internal, `bad menu entry index "${indexToken}"`),
  );
}

/**
 * Implements the `activate` pie-menu subcommand.
 * Mirrors `PieMenuWidgetCmd` activate branch plus `DeferPopupPieMenu`
 * in `ref/micropolis/src/sim/w_piem.c`.
 */
function createPieMenuActivateSubcommandHandler(
  hooks: PieMenuSubcommandHooks,
): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    const indexToken = argv[2];
    if (argv.length !== 3 || indexToken === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} activate expects argc 3, got ${argv.length}`,
      );
    }

    const indexOrError = resolvePieMenuIndex(menuState, indexToken, hooks);
    if (typeof indexOrError !== 'number') {
      return indexOrError;
    }

    if (menuState.active === indexOrError) {
      return makeScriptSuccess('');
    }

    const activateResult = activatePieMenuEntry(menuState, indexOrError, true, hooks);
    deferPieMenuPopup(menuState);
    return activateResult;
  };
}

/**
 * Implements the `show` pie-menu subcommand.
 * Mirrors `PieMenuWidgetCmd` `show` branch calling `NowPopupPieMenu`
 * in `ref/micropolis/src/sim/w_piem.c`.
 */
function handlePieMenuShowSubcommand(
  menuState: PieMenuState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2) {
    return makeInvalidArgCount(`${menuState.commandName} show expects argc 2, got ${argv.length}`);
  }

  popupPieMenuNow(menuState);
  return makeScriptSuccess('');
}

/**
 * Implements the `pending` pie-menu subcommand.
 * Mirrors `PieMenuWidgetCmd` `pending` branch returning
 * `(flags & POPUP_PENDING) ? 1 : 0` from `ref/micropolis/src/sim/w_piem.c`.
 */
function handlePieMenuPendingSubcommand(
  menuState: PieMenuState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2) {
    return makeInvalidArgCount(
      `${menuState.commandName} pending expects argc 2, got ${argv.length}`,
    );
  }

  return makeScriptSuccess(menuState.popupPending ? '1' : '0');
}

/**
 * Implements the `defer` pie-menu subcommand.
 * Mirrors `PieMenuWidgetCmd` `defer` branch calling `DeferPopupPieMenu`
 * in `ref/micropolis/src/sim/w_piem.c`.
 */
function handlePieMenuDeferSubcommand(
  menuState: PieMenuState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2) {
    return makeInvalidArgCount(`${menuState.commandName} defer expects argc 2, got ${argv.length}`);
  }

  deferPieMenuPopup(menuState);
  return makeScriptSuccess('');
}

function handlePieMenuConfigureSubcommand(
  menuState: PieMenuState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length === 2) {
    return makeScriptSuccess(serializePieMenuConfigureOptions(menuState));
  }

  if (argv.length === 3) {
    const rawOptionName = argv[2];
    if (rawOptionName === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} configure missing option name at argv[2]`,
      );
    }

    const optionName = toPieMenuConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${menuState.commandName} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    return makeScriptSuccess(readPieMenuConfigureOption(menuState, optionName));
  }

  const writeResult = applyPieMenuConfigureOptionPairs(
    menuState,
    argv.slice(2),
    menuState.commandName,
  );
  if (writeResult !== null) {
    return writeResult;
  }

  return makeScriptSuccess('');
}

function createPieMenuAddSubcommandHandler(): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    const typeText = argv[2];
    if (typeText === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} add expects argc >= 3, got ${argv.length}`,
      );
    }

    const type = parsePieMenuEntryType(typeText);
    if (type === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `bad menu entry type "${typeText}":  must be command or piemenu`,
        ),
      );
    }

    const entry = createPieMenuEntryState(type);
    const configureResult = applyPieMenuEntryConfigureOptionPairs(
      entry,
      argv.slice(3),
      `${menuState.commandName} add`,
    );
    if (configureResult !== null) {
      return configureResult;
    }

    menuState.entries.push(entry);
    menuState.resizePending = true;

    return makeScriptSuccess('');
  };
}

function createPieMenuDeleteSubcommandHandler(
  hooks: PieMenuSubcommandHooks,
): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    const indexToken = argv[2];
    if (argv.length !== 3 || indexToken === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} delete expects argc 3, got ${argv.length}`,
      );
    }

    const indexOrError = resolvePieMenuIndex(menuState, indexToken, hooks);
    if (typeof indexOrError !== 'number') {
      return indexOrError;
    }

    if (indexOrError < 0) {
      return makeScriptSuccess('');
    }

    menuState.entries.splice(indexOrError, 1);
    menuState.resizePending = true;

    if (menuState.active === indexOrError) {
      menuState.active = -1;
      menuState.configure.active = -1;
    } else if (menuState.active > indexOrError) {
      menuState.active -= 1;
      menuState.configure.active = menuState.active;
    }

    return makeScriptSuccess('');
  };
}

function createPieMenuEntryConfigureSubcommandHandler(
  hooks: PieMenuSubcommandHooks,
): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    const indexToken = argv[2];
    if (argv.length < 3 || indexToken === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} entryconfigure expects argc >= 3, got ${argv.length}`,
      );
    }

    const indexOrError = resolvePieMenuIndex(menuState, indexToken, hooks);
    if (typeof indexOrError !== 'number') {
      return indexOrError;
    }

    if (indexOrError < 0) {
      return makeScriptSuccess('');
    }

    const entry = menuState.entries[indexOrError];
    if (entry === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `bad menu entry index "${indexToken}"`,
        ),
      );
    }

    if (argv.length === 3) {
      return makeScriptSuccess(serializePieMenuEntryConfigureOptions(entry));
    }

    if (argv.length === 4) {
      const rawOptionName = argv[3];
      if (rawOptionName === undefined) {
        return makeInvalidArgCount(
          `${menuState.commandName} entryconfigure missing option name at argv[3]`,
        );
      }

      const optionName = toPieMenuEntryConfigureOptionName(rawOptionName);
      if (optionName === null || !supportsPieMenuEntryOption(entry, optionName)) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.Internal,
            `${menuState.commandName} entryconfigure unknown option: ${rawOptionName}`,
          ),
        );
      }

      return makeScriptSuccess(readPieMenuEntryConfigureOption(entry, optionName));
    }

    const writeResult = applyPieMenuEntryConfigureOptionPairs(
      entry,
      argv.slice(3),
      `${menuState.commandName} entryconfigure`,
    );
    if (writeResult !== null) {
      return writeResult;
    }

    menuState.resizePending = true;
    return makeScriptSuccess('');
  };
}

function createPieMenuIndexSubcommandHandler(
  hooks: PieMenuSubcommandHooks,
): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    const indexToken = argv[2];
    if (argv.length !== 3 || indexToken === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} index expects argc 3, got ${argv.length}`,
      );
    }

    const indexOrError = resolvePieMenuIndex(menuState, indexToken, hooks);
    if (typeof indexOrError !== 'number') {
      return indexOrError;
    }

    if (indexOrError < 0) {
      return makeScriptSuccess('none');
    }

    return makeScriptSuccess(String(indexOrError));
  };
}

/**
 * Implements the `invoke` pie-menu subcommand.
 * Mirrors `PieMenuWidgetCmd` invoke branch (index resolution +
 * optional `Tcl_GlobalEval(mePtr->command)`) in
 * `ref/micropolis/src/sim/w_piem.c`.
 */
function createPieMenuInvokeSubcommandHandler(
  hooks: PieMenuSubcommandHooks,
): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    const indexToken = argv[2];
    if (argv.length !== 3 || indexToken === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} invoke expects argc 3, got ${argv.length}`,
      );
    }

    const indexOrError = resolvePieMenuIndex(menuState, indexToken, hooks);
    if (typeof indexOrError !== 'number') {
      return indexOrError;
    }

    if (indexOrError < 0) {
      return makeScriptSuccess('');
    }

    const entry = menuState.entries[indexOrError];
    if (entry === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `bad menu entry index "${indexToken}"`,
        ),
      );
    }

    if (entry.command === null) {
      return makeScriptSuccess('');
    }

    return runPieMenuEntryScript(menuState, entry.command, 'invoke', hooks);
  };
}

/**
 * Implements the `post` pie-menu subcommand.
 * Mirrors `PieMenuWidgetCmd` post branch in `ref/micropolis/src/sim/w_piem.c`,
 * including group defaulting, root-position updates, deferred popup scheduling,
 * and active-entry reset for newly mapped menus.
 * Difference from C: screen clamping, event sharing, and Tk/X11 window motion
 * are represented as state-only transitions.
 */
function createPieMenuPostSubcommandHandler(
  hooks: PieMenuSubcommandHooks,
): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    const rawX = argv[2];
    const rawY = argv[3];
    const rawGroup = argv[4];
    if ((argv.length !== 4 && argv.length !== 5) || rawX === undefined || rawY === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} post expects argc 4 or 5, got ${argv.length}`,
      );
    }

    const parsedX = parseTclInt32(rawX);
    if (parsedX === null) {
      return makeInvalidInteger(`${menuState.commandName} post expected an integer x: ${rawX}`);
    }

    const parsedY = parseTclInt32(rawY);
    if (parsedY === null) {
      return makeInvalidInteger(`${menuState.commandName} post expected an integer y: ${rawY}`);
    }

    const group = rawGroup ?? 'default';
    const adjustedX = parsedX - menuState.centerX;
    const adjustedY = parsedY - menuState.centerY;
    menuState.rootX = adjustedX + menuState.centerX;
    menuState.rootY = adjustedY + menuState.centerY;

    let postResult: ScriptRuntimeResult = makeScriptSuccess('');
    if (!menuState.mapped) {
      schedulePieMenuPopup(menuState);
      postResult = activatePieMenuEntry(menuState, -1, true, hooks);
    }

    menuState.group = group;
    return postResult;
  };
}

/**
 * Implements the `unpost` pie-menu subcommand.
 * Mirrors `PieMenuWidgetCmd` unpost branch (cancel pending popup, unmap,
 * deactivate entry, unpost submenu) in `ref/micropolis/src/sim/w_piem.c`.
 */
function createPieMenuUnpostSubcommandHandler(
  hooks: PieMenuSubcommandHooks,
): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 2) {
      return makeInvalidArgCount(
        `${menuState.commandName} unpost expects argc 2, got ${argv.length}`,
      );
    }

    menuState.popupPending = false;
    menuState.mapped = false;
    const deactivateResult = activatePieMenuEntry(menuState, -1, false, hooks);
    if (deactivateResult.code !== ScriptResultCode.Ok) {
      return deactivateResult;
    }

    unpostPieMenuSubmenu(menuState);
    return makeScriptSuccess('');
  };
}

/**
 * Implements the `grab` pie-menu subcommand.
 * Mirrors `PieMenuWidgetCmd` grab branch (`Tk_NameToWindow` + `XGrabPointer`)
 * in `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: X11 grab result codes are not modeled; resolved window
 * name is stored in pie-menu state.
 */
function createPieMenuGrabSubcommandHandler(
  hooks: PieMenuSubcommandHooks,
): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    const windowName = argv[2];
    if (argv.length !== 3 || windowName === undefined || windowName.length === 0) {
      return makeInvalidArgCount(
        `${menuState.commandName} grab expects argc 3, got ${argv.length}`,
      );
    }
    if (!resolvePieMenuWindow(menuState, windowName, hooks)) {
      return makeInvalidArgCount(`${menuState.commandName} grab requires a resolvable window`);
    }

    menuState.grabbedWindow = windowName;
    return makeScriptSuccess('');
  };
}

/**
 * Implements the `ungrab` pie-menu subcommand.
 * Mirrors `PieMenuWidgetCmd` ungrab branch (`Tk_NameToWindow` + `XUngrabPointer`)
 * in `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: pointer ungrab is represented as local state clearing.
 */
function createPieMenuUngrabSubcommandHandler(
  hooks: PieMenuSubcommandHooks,
): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    const windowName = argv[2];
    if (argv.length !== 3 || windowName === undefined || windowName.length === 0) {
      return makeInvalidArgCount(
        `${menuState.commandName} ungrab expects argc 3, got ${argv.length}`,
      );
    }
    if (!resolvePieMenuWindow(menuState, windowName, hooks)) {
      return makeInvalidArgCount(`${menuState.commandName} ungrab requires a resolvable window`);
    }

    menuState.grabbedWindow = null;
    return makeScriptSuccess('');
  };
}

/**
 * Implements the `distance` pie-menu subcommand.
 * Mirrors `PieMenuWidgetCmd` distance math:
 * `(int)(sqrt(dx*dx + dy*dy) + 0.499)` in `ref/micropolis/src/sim/w_piem.c`.
 */
function handlePieMenuDistanceSubcommand(
  menuState: PieMenuState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2) {
    return makeInvalidArgCount(
      `${menuState.commandName} distance expects argc 2, got ${argv.length}`,
    );
  }

  const distance = roundCIntFromFloat(
    Math.sqrt(menuState.dx * menuState.dx + menuState.dy * menuState.dy),
  );
  return makeScriptSuccess(String(distance));
}

/**
 * Implements the `direction` pie-menu subcommand.
 * Mirrors `PieMenuWidgetCmd` direction math:
 * `(int)(RAD_TO_DEG(atan2(dy, dx)) + 0.499)` with wrap-to-`[0,360)`
 * in `ref/micropolis/src/sim/w_piem.c`.
 */
function handlePieMenuDirectionSubcommand(
  menuState: PieMenuState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2) {
    return makeInvalidArgCount(
      `${menuState.commandName} direction expects argc 2, got ${argv.length}`,
    );
  }

  let direction = roundCIntFromFloat(
    (Math.atan2(menuState.dy, menuState.dx) * 360) / (Math.PI * 2),
  );
  if (direction < 0) {
    direction += 360;
  }
  return makeScriptSuccess(String(direction));
}

/**
 * Creates one pie-menu state object with Micropolis defaults.
 * Mirrors `Tk_PieMenuCmd` field initialization and `ConfigurePieMenu` defaulting
 * in `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: modeled fields are limited to script-visible state and
 * command-observable tracking flags.
 */
export function createPieMenuState(
  commandName: string,
  options: CreatePieMenuStateOptions = {},
): PieMenuState {
  const configuredActive = options.configure?.active;
  const active = options.active ?? configuredActive ?? DEFAULT_PIE_MENU_ACTIVE_INDEX;

  return {
    commandName,
    entries: (options.entries ?? []).map((entry) => ({ ...entry })),
    active,
    popupPending: options.popupPending ?? false,
    resizePending: options.resizePending ?? false,
    mapped: options.mapped ?? false,
    group: options.group ?? null,
    rootX: options.rootX ?? 0,
    rootY: options.rootY ?? 0,
    centerX: options.centerX ?? 0,
    centerY: options.centerY ?? 0,
    dx: options.dx ?? 0,
    dy: options.dy ?? 0,
    postedSubmenu: options.postedSubmenu ?? null,
    grabbedWindow: options.grabbedWindow ?? null,
    configure: {
      activeBackground: options.configure?.activeBackground ?? DEFAULT_PIE_MENU_ACTIVE_BACKGROUND,
      activeBorderWidth:
        options.configure?.activeBorderWidth ?? DEFAULT_PIE_MENU_ACTIVE_BORDER_WIDTH,
      activeForeground: options.configure?.activeForeground ?? DEFAULT_PIE_MENU_ACTIVE_FOREGROUND,
      background: options.configure?.background ?? DEFAULT_PIE_MENU_BACKGROUND,
      borderWidth: options.configure?.borderWidth ?? DEFAULT_PIE_MENU_BORDER_WIDTH,
      cursor: options.configure?.cursor ?? DEFAULT_PIE_MENU_CURSOR,
      foreground: options.configure?.foreground ?? DEFAULT_PIE_MENU_FOREGROUND,
      font: options.configure?.font ?? DEFAULT_PIE_MENU_FONT,
      title: options.configure?.title ?? DEFAULT_PIE_MENU_TITLE,
      preview: options.configure?.preview ?? DEFAULT_PIE_MENU_PREVIEW,
      titleFont: options.configure?.titleFont ?? DEFAULT_PIE_MENU_TITLE_FONT,
      initialAngle: options.configure?.initialAngle ?? DEFAULT_PIE_MENU_INITIAL_ANGLE,
      inactiveRadius: options.configure?.inactiveRadius ?? DEFAULT_PIE_MENU_INACTIVE_RADIUS,
      minRadius: options.configure?.minRadius ?? DEFAULT_PIE_MENU_MIN_RADIUS,
      extraRadius: options.configure?.extraRadius ?? DEFAULT_PIE_MENU_EXTRA_RADIUS,
      fixedRadius: options.configure?.fixedRadius ?? DEFAULT_PIE_MENU_FIXED_RADIUS,
      active,
      popupDelay: options.configure?.popupDelay ?? DEFAULT_PIE_MENU_POPUP_DELAY,
      shaped: options.configure?.shaped ?? DEFAULT_PIE_MENU_SHAPED,
    },
  };
}

/**
 * Builds pie-menu subcommand entries for the Phase 4 command set.
 * Mirrors `PieMenuWidgetCmd` branches for `activate`, `show`, `pending`,
 * `defer`, `configure`, `add`, `delete`, `entryconfigure`, `index`, `invoke`,
 * `post`, `unpost`, `grab`, `ungrab`, `distance`, and `direction` in
 * `ref/micropolis/src/sim/w_piem.c`.
 */
export function createPieMenuSubcommandEntries(
  options: CreatePieMenuSubcommandEntriesOptions = {},
): readonly PieMenuSubcommandEntry[] {
  const hooks = options.hooks ?? {};

  return [
    ['activate', createPieMenuActivateSubcommandHandler(hooks)] as const,
    ['show', handlePieMenuShowSubcommand] as const,
    ['pending', handlePieMenuPendingSubcommand] as const,
    ['defer', handlePieMenuDeferSubcommand] as const,
    ['configure', handlePieMenuConfigureSubcommand] as const,
    ['add', createPieMenuAddSubcommandHandler()] as const,
    ['delete', createPieMenuDeleteSubcommandHandler(hooks)] as const,
    ['entryconfigure', createPieMenuEntryConfigureSubcommandHandler(hooks)] as const,
    ['index', createPieMenuIndexSubcommandHandler(hooks)] as const,
    ['invoke', createPieMenuInvokeSubcommandHandler(hooks)] as const,
    ['post', createPieMenuPostSubcommandHandler(hooks)] as const,
    ['unpost', createPieMenuUnpostSubcommandHandler(hooks)] as const,
    ['grab', createPieMenuGrabSubcommandHandler(hooks)] as const,
    ['ungrab', createPieMenuUngrabSubcommandHandler(hooks)] as const,
    ['distance', handlePieMenuDistanceSubcommand] as const,
    ['direction', handlePieMenuDirectionSubcommand] as const,
  ];
}

/**
 * Builds a case-sensitive pie-menu subcommand lookup table.
 * Mirrors Tcl command table lookup behavior where duplicate registrations are
 * last-write-wins.
 */
export function createPieMenuSubcommandTable(
  entries: readonly PieMenuSubcommandEntry[] = [],
): PieMenuSubcommandTable {
  const table = new Map<string, PieMenuSubcommandHandler>();

  for (const [name, handler] of entries) {
    table.set(name, handler);
  }

  return table;
}

/**
 * Default subcommand table for Phase 4 pie-menu shell behavior.
 * Mirrors the scripted subcommand set from `PieMenuWidgetCmd`
 * in `ref/micropolis/src/sim/w_piem.c`.
 */
export const PIE_MENU_SUBCOMMAND_TABLE = createPieMenuSubcommandTable(
  createPieMenuSubcommandEntries(),
);

/**
 * Creates the per-widget pie-menu dispatcher bound to one menu state.
 * Mirrors `PieMenuWidgetCmd` subcommand lookup flow in
 * `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: typed runtime errors replace Tcl string appends.
 */
export function createPieMenuWidgetCommandDispatcher(
  menuState: PieMenuState,
  subcommands: PieMenuSubcommandTable = PIE_MENU_SUBCOMMAND_TABLE,
): ScriptCommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const subcommandName = argv[1];
    if (subcommandName === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} command requires a subcommand in argv[1]`,
      );
    }

    const subcommandHandler = subcommands.get(subcommandName);
    if (subcommandHandler === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.UnknownSubcommand,
          `unknown piemenu subcommand: ${subcommandName}`,
        ),
      );
    }

    return subcommandHandler(menuState, argv);
  };
}

/**
 * Constructor options for `createPieMenuCommandDispatcher`.
 * Mirrors state/command wiring in `Tk_PieMenuCmd` and `PieMenuWidgetCmd`
 * from `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: optional hooks allow tests to override index-hit testing,
 * script evaluation, and window name resolution.
 */
export interface CreatePieMenuCommandDispatcherOptions {
  runtime: ScriptRuntime;
  widgets?: WidgetRegistry<PieMenuState>;
  createMenuState?: (commandName: string) => PieMenuState;
  subcommands?: PieMenuSubcommandTable;
  hooks?: PieMenuSubcommandHooks;
}

/**
 * Splits command script text into argv tokens for runtime dispatch.
 * Mirrors command-string evaluation entrypoints in `Tcl_GlobalEval` call sites
 * from `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: this is whitespace tokenization only, not full Tcl parsing.
 */
function tokenizePieMenuScript(scriptText: string): readonly string[] {
  const trimmed = scriptText.trim();
  if (trimmed.length === 0) {
    return [];
  }

  return trimmed.split(/\s+/);
}

/**
 * Executes pie-menu preview/invoke script text through `ScriptRuntime`.
 * Mirrors `Tcl_GlobalEval` in `ActivatePieMenuEntry` and invoke handling
 * from `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: script parsing uses `tokenizePieMenuScript`.
 */
function runPieMenuScriptInRuntime(
  runtime: ScriptRuntime,
  scriptText: string,
): ScriptRuntimeResult {
  const scriptArgv = tokenizePieMenuScript(scriptText);
  if (scriptArgv.length === 0) {
    return makeScriptSuccess('');
  }

  return runtime.invoke(scriptArgv);
}

/**
 * Creates the top-level `piemenu` factory command dispatcher.
 * Mirrors `Tk_PieMenuCmd` creation flow for `piemenu pathName ?options?`
 * in `ref/micropolis/src/sim/w_piem.c`.
 * Parity note: Tk windowing side effects are omitted; script-visible state is preserved.
 * Difference from C: script text execution uses a whitespace tokenizer by default,
 * and full Tcl parsing can be injected via `hooks.runEntryScript`.
 */
export function createPieMenuCommandDispatcher(
  options: CreatePieMenuCommandDispatcherOptions,
): ScriptCommandHandler {
  const widgets = options.widgets ?? new WidgetRegistry<PieMenuState>();
  const createMenuState =
    options.createMenuState ?? ((commandName: string) => createPieMenuState(commandName));
  const hooks: PieMenuSubcommandHooks = {
    runEntryScript: (_menuState, scriptText) =>
      runPieMenuScriptInRuntime(options.runtime, scriptText),
    ...options.hooks,
  };
  const subcommands =
    options.subcommands ??
    createPieMenuSubcommandTable(
      createPieMenuSubcommandEntries({
        hooks,
      }),
    );

  return (argv: readonly string[]): ScriptRuntimeResult => {
    const commandName = argv[1];
    if (commandName === undefined || commandName.length === 0) {
      return makeInvalidArgCount('piemenu command requires a pathName in argv[1]');
    }

    if (widgets.get(commandName) !== undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `piemenu command already exists: ${commandName}`,
        ),
      );
    }

    const menuState = createMenuState(commandName);
    const configureResult = applyPieMenuConfigureOptionPairs(
      menuState,
      argv.slice(2),
      `piemenu ${commandName}`,
    );
    if (configureResult !== null) {
      return configureResult;
    }

    widgets.add(commandName, menuState);
    options.runtime.registerCommand(
      commandName,
      createPieMenuWidgetCommandDispatcher(menuState, subcommands),
    );
    return makeScriptSuccess(commandName);
  };
}

/**
 * Registers the top-level `piemenu` command in a runtime.
 * Mirrors `Tcl_CreateCommand(..., "piemenu", Tk_PieMenuCmd, ...)`
 * in `ref/micropolis/src/sim/w_tk.c`.
 */
export function registerPieMenuCommand(
  runtime: ScriptRuntime,
  options: Omit<CreatePieMenuCommandDispatcherOptions, 'runtime'> = {},
): void {
  runtime.registerCommand(
    'piemenu',
    createPieMenuCommandDispatcher({
      runtime,
      ...options,
    }),
  );
}
