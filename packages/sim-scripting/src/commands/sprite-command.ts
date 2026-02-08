import {
  makeScriptFailure,
  makeScriptSuccess,
  ScriptRuntimeError,
  ScriptRuntimeErrorCode,
} from '../runtime/errors.ts';
import type { ScriptRuntimeResult } from '../runtime/result-code.ts';
import type { ScriptCommandHandler, ScriptRuntime } from '../runtime/script-runtime.ts';
import { SpriteRegistry } from '../state/sprite-registry.ts';

const TCL_INT32_MIN = -2147483648n;
const TCL_INT32_MAX = 2147483647n;
const SPRITE_TYPE_MIN = 1;
const SPRITE_TYPE_MAX = 8;
const DEFAULT_SPRITE_FRAME = 0;
const DEFAULT_SPRITE_SPEED = 100;
const DEFAULT_WORLD_WIDTH_TILES = 120;
const DEFAULT_WORLD_HEIGHT_TILES = 100;
const SPRITE_PIXEL_SHIFT = 4;
const SPRITE_TYPE_TRA = 1;
const SPRITE_TYPE_COP = 2;
const SPRITE_TYPE_AIR = 3;
const SPRITE_TYPE_SHI = 4;
const SPRITE_TYPE_GOD = 5;
const SPRITE_TYPE_TOR = 6;
const SPRITE_TYPE_EXP = 7;
const SPRITE_TYPE_BUS = 8;

const SPRITE_INT_ACCESSOR_NAMES = [
  'type',
  'frame',
  'x',
  'y',
  'width',
  'height',
  'x_offset',
  'y_offset',
  'x_hot',
  'y_hot',
  'orig_x',
  'orig_y',
  'dest_x',
  'dest_y',
  'count',
  'sound_count',
  'dir',
  'new_dir',
  'step',
  'flag',
  'control',
  'turn',
  'accel',
  'speed',
] as const;

type SpriteIntAccessorName = (typeof SPRITE_INT_ACCESSOR_NAMES)[number];

interface SpriteSubcommandRuntimeContext {
  worldWidthTiles: number;
  worldHeightTiles: number;
  policeMaxX: number;
  policeMaxY: number;
  randomIntInclusive: (maxInclusive: number) => number;
  onExplode?: (event: SpriteExplodeEvent) => void;
}

interface SpriteSubcommandBuildOptions {
  worldWidthTiles?: number;
  worldHeightTiles?: number;
  policeMaxX?: number;
  policeMaxY?: number;
  randomIntInclusive?: (maxInclusive: number) => number;
  onExplode?: (event: SpriteExplodeEvent) => void;
}

interface SpriteExplodeEvent {
  readonly spriteName: string;
  readonly spriteType: number;
  readonly pixelX: number;
  readonly pixelY: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly messageCode?: number;
}

/**
 * Mutable state for one created sprite command.
 * Mirrors all script-visible `SimSprite` fields from `SpriteCmd*` accessors and
 * `InitSprite` in `ref/micropolis/src/sim/w_sprite.c` plus
 * `ref/micropolis/src/sim/headers/view.h`.
 * Parity note: `createSpriteState` initializes type-specific fields via
 * `InitSprite(..., 0, 0)` parity and then forces `frame = 0`, matching
 * `SpriteCmd` (`NewSprite(...); sprite->frame = 0`).
 */
export interface SpriteState {
  commandName: string;
  name: string;
  type: number;
  frame: number;
  x: number;
  y: number;
  width: number;
  height: number;
  x_offset: number;
  y_offset: number;
  x_hot: number;
  y_hot: number;
  orig_x: number;
  orig_y: number;
  dest_x: number;
  dest_y: number;
  count: number;
  sound_count: number;
  dir: number;
  new_dir: number;
  step: number;
  flag: number;
  control: number;
  turn: number;
  accel: number;
  speed: number;
}

/**
 * Constructor overrides for `createSpriteState`.
 * Mirrors final `SpriteCmd` state after `NewSprite(...,0,0)` initialization.
 * Difference from C: callers may override the post-create frame explicitly.
 */
export interface CreateSpriteStateOptions {
  frame?: number;
}

/**
 * Handler signature for `<spriteName> <Subcommand> ...`.
 * Mirrors `SpriteCmd*` function pointer dispatch through `SpriteCmds`
 * by `DoSpriteCmd` in `ref/micropolis/src/sim/w_sprite.c`.
 */
export type SpriteSubcommandHandler = (
  spriteState: SpriteState,
  argv: readonly string[],
) => ScriptRuntimeResult;

/**
 * Case-sensitive sprite subcommand table.
 * Mirrors `Tcl_HashTable SpriteCmds` lookup behavior in `DoSpriteCmd`
 * (`ref/micropolis/src/sim/w_sprite.c`).
 */
export type SpriteSubcommandTable = ReadonlyMap<string, SpriteSubcommandHandler>;

/**
 * One sprite subcommand registration tuple.
 * Mirrors one `SPRITE_CMD(name)` hash insertion in `sprite_command_init`
 * (`ref/micropolis/src/sim/w_sprite.c`).
 */
export type SpriteSubcommandEntry = readonly [name: string, handler: SpriteSubcommandHandler];

/**
 * Parses a Tcl-style integer and enforces 32-bit C `int` range.
 * Mirrors `Tcl_GetInt` usage in `SpriteCmd` from
 * `ref/micropolis/src/sim/w_sprite.c`.
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
 * Mirrors `TCL_ERROR` returns from `SpriteCmd`/`DoSpriteCmd` when argc is invalid
 * in `ref/micropolis/src/sim/w_sprite.c`.
 */
function makeInvalidArgCount(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidArgCount, message));
}

/**
 * Creates a typed invalid-integer runtime result.
 * Mirrors `Tcl_GetInt(...) != TCL_OK` failures in `SpriteCmd`
 * (`ref/micropolis/src/sim/w_sprite.c`).
 */
function makeInvalidInteger(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidInteger, message));
}

function parseSpritePixelCoordinate(
  spriteState: SpriteState,
  rawValue: string | undefined,
  axisName: 'x' | 'y',
  axisIndex: 2 | 3,
  maxExclusive: number,
): number | ScriptRuntimeResult {
  if (rawValue === undefined) {
    return makeInvalidArgCount(
      `${spriteState.commandName} Init missing ${axisName} argument at argv[${axisIndex}]`,
    );
  }

  const parsed = parseTclInt32(rawValue);
  if (parsed === null) {
    return makeInvalidInteger(
      `${spriteState.commandName} Init expected a 32-bit integer ${axisName} at argv[${axisIndex}]: ${rawValue}`,
    );
  }

  if (parsed < 0 || parsed >= maxExclusive) {
    return makeInvalidInteger(
      `${spriteState.commandName} Init expected ${axisName} in range 0..${maxExclusive - 1}: ${rawValue}`,
    );
  }

  return parsed;
}

function toFiniteInt(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.trunc(value);
}

function createDefaultRandomIntInclusive(maxInclusive: number): number {
  if (maxInclusive <= 0) {
    return 0;
  }

  return Math.floor(Math.random() * (maxInclusive + 1));
}

function normalizeRandomIntInclusive(maxInclusive: number, value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const truncated = Math.trunc(value);
  if (truncated < 0) {
    return 0;
  }
  if (truncated > maxInclusive) {
    return maxInclusive;
  }
  return truncated;
}

function resolveRandomIntInclusive(
  context: SpriteSubcommandRuntimeContext,
  maxInclusive: number,
): number {
  if (maxInclusive <= 0) {
    return 0;
  }

  const raw = context.randomIntInclusive(maxInclusive);
  return normalizeRandomIntInclusive(maxInclusive, raw);
}

function getWorldWidthPixels(context: SpriteSubcommandRuntimeContext): number {
  return context.worldWidthTiles << SPRITE_PIXEL_SHIFT;
}

function getWorldHeightPixels(context: SpriteSubcommandRuntimeContext): number {
  return context.worldHeightTiles << SPRITE_PIXEL_SHIFT;
}

function createSpriteSubcommandRuntimeContext(
  options: SpriteSubcommandBuildOptions = {},
): SpriteSubcommandRuntimeContext {
  const worldWidthTiles = Math.max(
    1,
    toFiniteInt(options.worldWidthTiles, DEFAULT_WORLD_WIDTH_TILES),
  );
  const worldHeightTiles = Math.max(
    1,
    toFiniteInt(options.worldHeightTiles, DEFAULT_WORLD_HEIGHT_TILES),
  );

  return {
    worldWidthTiles,
    worldHeightTiles,
    policeMaxX: toFiniteInt(options.policeMaxX, 0),
    policeMaxY: toFiniteInt(options.policeMaxY, 0),
    randomIntInclusive: options.randomIntInclusive ?? createDefaultRandomIntInclusive,
    onExplode: options.onExplode,
  };
}

function initSpriteState(
  spriteState: SpriteState,
  x: number,
  y: number,
  context: SpriteSubcommandRuntimeContext,
): void {
  const worldWidthPixels = getWorldWidthPixels(context);
  const worldHeightPixels = getWorldHeightPixels(context);

  spriteState.x = x;
  spriteState.y = y;
  spriteState.frame = 0;
  spriteState.orig_x = 0;
  spriteState.orig_y = 0;
  spriteState.dest_x = 0;
  spriteState.dest_y = 0;
  spriteState.count = 0;
  spriteState.sound_count = 0;
  spriteState.dir = 0;
  spriteState.new_dir = 0;
  spriteState.step = 0;
  spriteState.flag = 0;
  spriteState.control = -1;
  spriteState.turn = 0;
  spriteState.accel = 0;
  spriteState.speed = DEFAULT_SPRITE_SPEED;

  switch (spriteState.type) {
    case SPRITE_TYPE_TRA: {
      spriteState.width = 32;
      spriteState.height = 32;
      spriteState.x_offset = 32;
      spriteState.y_offset = -16;
      spriteState.x_hot = 40;
      spriteState.y_hot = -8;
      spriteState.frame = 1;
      spriteState.dir = 4;
      return;
    }
    case SPRITE_TYPE_SHI: {
      spriteState.width = 48;
      spriteState.height = 48;
      spriteState.x_offset = 32;
      spriteState.y_offset = -16;
      spriteState.x_hot = 48;
      spriteState.y_hot = 0;
      if (x < 4 << SPRITE_PIXEL_SHIFT) {
        spriteState.frame = 3;
      } else if (x >= (context.worldWidthTiles - 4) << SPRITE_PIXEL_SHIFT) {
        spriteState.frame = 7;
      } else if (y < 4 << SPRITE_PIXEL_SHIFT) {
        spriteState.frame = 5;
      } else if (y >= (context.worldHeightTiles - 4) << SPRITE_PIXEL_SHIFT) {
        spriteState.frame = 1;
      } else {
        spriteState.frame = 3;
      }
      spriteState.new_dir = spriteState.frame;
      spriteState.dir = 10;
      spriteState.count = 1;
      return;
    }
    case SPRITE_TYPE_GOD: {
      spriteState.width = 48;
      spriteState.height = 48;
      spriteState.x_offset = 24;
      spriteState.y_offset = 0;
      spriteState.x_hot = 40;
      spriteState.y_hot = 16;
      const worldHalfWidth = Math.trunc(worldWidthPixels / 2);
      const worldHalfHeight = Math.trunc(worldHeightPixels / 2);
      if (x > worldHalfWidth) {
        if (y > worldHalfHeight) {
          spriteState.frame = 10;
        } else {
          spriteState.frame = 7;
        }
      } else if (y > worldHalfHeight) {
        spriteState.frame = 1;
      } else {
        spriteState.frame = 4;
      }
      spriteState.count = 1000;
      spriteState.dest_x = context.policeMaxX << SPRITE_PIXEL_SHIFT;
      spriteState.dest_y = context.policeMaxY << SPRITE_PIXEL_SHIFT;
      spriteState.orig_x = spriteState.x;
      spriteState.orig_y = spriteState.y;
      return;
    }
    case SPRITE_TYPE_COP: {
      spriteState.width = 32;
      spriteState.height = 32;
      spriteState.x_offset = 32;
      spriteState.y_offset = -16;
      spriteState.x_hot = 40;
      spriteState.y_hot = -8;
      spriteState.frame = 5;
      spriteState.count = 1500;
      spriteState.dest_x = resolveRandomIntInclusive(context, worldWidthPixels - 1);
      spriteState.dest_y = resolveRandomIntInclusive(context, worldHeightPixels - 1);
      spriteState.orig_x = x - 30;
      spriteState.orig_y = y;
      return;
    }
    case SPRITE_TYPE_AIR: {
      spriteState.width = 48;
      spriteState.height = 48;
      spriteState.x_offset = 24;
      spriteState.y_offset = 0;
      spriteState.x_hot = 48;
      spriteState.y_hot = 16;
      if (x > (context.worldWidthTiles - 20) << SPRITE_PIXEL_SHIFT) {
        spriteState.x -= 100 + 48;
        spriteState.dest_x = spriteState.x - 200;
        spriteState.frame = 7;
      } else {
        spriteState.dest_x = spriteState.x + 200;
        spriteState.frame = 11;
      }
      spriteState.dest_y = spriteState.y;
      return;
    }
    case SPRITE_TYPE_TOR: {
      spriteState.width = 48;
      spriteState.height = 48;
      spriteState.x_offset = 24;
      spriteState.y_offset = 0;
      spriteState.x_hot = 40;
      spriteState.y_hot = 36;
      spriteState.frame = 1;
      spriteState.count = 200;
      return;
    }
    case SPRITE_TYPE_EXP: {
      spriteState.width = 48;
      spriteState.height = 48;
      spriteState.x_offset = 24;
      spriteState.y_offset = 0;
      spriteState.x_hot = 40;
      spriteState.y_hot = 16;
      spriteState.frame = 1;
      return;
    }
    case SPRITE_TYPE_BUS: {
      spriteState.width = 32;
      spriteState.height = 32;
      spriteState.x_offset = 30;
      spriteState.y_offset = -18;
      spriteState.x_hot = 40;
      spriteState.y_hot = -8;
      spriteState.frame = 1;
      spriteState.dir = 1;
      return;
    }
    default: {
      return;
    }
  }
}

function createSpriteAccessorIntSubcommandHandler(
  name: SpriteIntAccessorName,
): SpriteSubcommandHandler {
  return (spriteState: SpriteState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 2 && argv.length !== 3) {
      return makeInvalidArgCount(
        `${spriteState.commandName} ${name} expects argc 2 or 3, got ${argv.length}`,
      );
    }

    if (argv.length === 3) {
      const rawValue = argv[2];
      if (rawValue === undefined) {
        return makeInvalidArgCount(
          `${spriteState.commandName} ${name} missing integer argument at argv[2]`,
        );
      }

      const parsedValue = parseTclInt32(rawValue);
      if (parsedValue === null) {
        return makeInvalidInteger(
          `${spriteState.commandName} ${name} expected a 32-bit integer at argv[2]: ${rawValue}`,
        );
      }

      spriteState[name] = parsedValue;
    }

    return makeScriptSuccess(String(spriteState[name]));
  };
}

function createSpriteNameSubcommandHandler(): SpriteSubcommandHandler {
  return (spriteState: SpriteState): ScriptRuntimeResult => {
    return makeScriptSuccess(spriteState.name);
  };
}

function createSpriteExplodeSubcommandHandler(
  context: SpriteSubcommandRuntimeContext,
): SpriteSubcommandHandler {
  return (spriteState: SpriteState): ScriptRuntimeResult => {
    spriteState.frame = 0;

    const pixelX = spriteState.x + spriteState.x_hot;
    const pixelY = spriteState.y + spriteState.y_hot;
    const tileX = pixelX >> SPRITE_PIXEL_SHIFT;
    const tileY = pixelY >> SPRITE_PIXEL_SHIFT;

    let messageCode: number | undefined;
    switch (spriteState.type) {
      case SPRITE_TYPE_AIR:
        messageCode = -24;
        break;
      case SPRITE_TYPE_SHI:
        messageCode = -25;
        break;
      case SPRITE_TYPE_TRA:
      case SPRITE_TYPE_BUS:
        messageCode = -26;
        break;
      case SPRITE_TYPE_COP:
        messageCode = -27;
        break;
      default:
        break;
    }

    context.onExplode?.({
      spriteName: spriteState.name,
      spriteType: spriteState.type,
      pixelX,
      pixelY,
      tileX,
      tileY,
      messageCode,
    });

    return makeScriptSuccess();
  };
}

function createSpriteInitSubcommandHandler(
  context: SpriteSubcommandRuntimeContext,
): SpriteSubcommandHandler {
  return (spriteState: SpriteState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 4) {
      return makeInvalidArgCount(
        `${spriteState.commandName} Init expects argc 4, got ${argv.length}`,
      );
    }

    const parsedX = parseSpritePixelCoordinate(
      spriteState,
      argv[2],
      'x',
      2,
      getWorldWidthPixels(context),
    );
    if (typeof parsedX !== 'number') {
      return parsedX;
    }

    const parsedY = parseSpritePixelCoordinate(
      spriteState,
      argv[3],
      'y',
      3,
      getWorldHeightPixels(context),
    );
    if (typeof parsedY !== 'number') {
      return parsedY;
    }

    initSpriteState(spriteState, parsedX, parsedY, context);
    return makeScriptSuccess();
  };
}

/**
 * Creates mutable state backing one sprite command.
 * Mirrors `SpriteCmd` + `NewSprite` + `InitSprite` in
 * `ref/micropolis/src/sim/w_sprite.c`.
 * Difference from C: `PolMaxX/PolMaxY` and RNG dependencies are not globally
 * wired here, so defaults (`0`) and `Math.random` parity helpers are used.
 */
export function createSpriteState(
  commandName: string,
  type: number,
  options: CreateSpriteStateOptions = {},
): SpriteState {
  const spriteState: SpriteState = {
    commandName,
    name: commandName,
    type,
    frame: DEFAULT_SPRITE_FRAME,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    x_offset: 0,
    y_offset: 0,
    x_hot: 0,
    y_hot: 0,
    orig_x: 0,
    orig_y: 0,
    dest_x: 0,
    dest_y: 0,
    count: 0,
    sound_count: 0,
    dir: 0,
    new_dir: 0,
    step: 0,
    flag: 0,
    control: -1,
    turn: 0,
    accel: 0,
    speed: DEFAULT_SPRITE_SPEED,
  };

  initSpriteState(spriteState, 0, 0, createSpriteSubcommandRuntimeContext());
  spriteState.frame = options.frame ?? DEFAULT_SPRITE_FRAME;
  return spriteState;
}

/**
 * Builds sprite subcommand entries for the `sprite` widget command.
 * Mirrors `SPRITE_CMD(...)` table wiring in `sprite_command_init`
 * (`ref/micropolis/src/sim/w_sprite.c`).
 * Difference from C: side effects from `ExplodeSprite` that target global sim
 * state are exposed via an optional callback hook instead of C globals.
 */
export function createSpriteSubcommandEntries(
  options: SpriteSubcommandBuildOptions = {},
): readonly SpriteSubcommandEntry[] {
  const context = createSpriteSubcommandRuntimeContext(options);
  return [
    ['name', createSpriteNameSubcommandHandler()],
    ...SPRITE_INT_ACCESSOR_NAMES.map((name) => {
      return [name, createSpriteAccessorIntSubcommandHandler(name)] as const;
    }),
    ['Explode', createSpriteExplodeSubcommandHandler(context)],
    ['Init', createSpriteInitSubcommandHandler(context)],
  ];
}

/**
 * Builds a case-sensitive sprite subcommand lookup table.
 * Mirrors `Tcl_HashTable SpriteCmds` registration behavior in
 * `sprite_command_init`/`DoSpriteCmd` (`ref/micropolis/src/sim/w_sprite.c`).
 * Parity note: duplicate names use last-registration-wins map semantics.
 */
export function createSpriteSubcommandTable(
  entries: readonly SpriteSubcommandEntry[] = [],
): SpriteSubcommandTable {
  const table = new Map<string, SpriteSubcommandHandler>();

  for (const [name, handler] of entries) {
    table.set(name, handler);
  }

  return table;
}

/**
 * Default sprite subcommand table for sprite command dispatch.
 * Mirrors `SpriteCmds` wiring in `sprite_command_init`
 * (`ref/micropolis/src/sim/w_sprite.c`), including all accessors plus
 * `Init`/`Explode`.
 */
export const SPRITE_SUBCOMMAND_TABLE = createSpriteSubcommandTable(createSpriteSubcommandEntries());

/**
 * Creates the per-sprite command dispatcher bound to one sprite state.
 * Mirrors `DoSpriteCmd` subcommand lookup flow in `ref/micropolis/src/sim/w_sprite.c`.
 * Difference from C: errors are typed instead of Tcl string append side effects.
 */
export function createSpriteWidgetCommandDispatcher(
  spriteState: SpriteState,
  subcommands: SpriteSubcommandTable = SPRITE_SUBCOMMAND_TABLE,
): ScriptCommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const subcommandName = argv[1];
    if (subcommandName === undefined) {
      return makeInvalidArgCount(
        `${spriteState.commandName} command requires a subcommand in argv[1]`,
      );
    }

    const subcommandHandler = subcommands.get(subcommandName);
    if (subcommandHandler === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.UnknownSubcommand,
          `unknown sprite subcommand: ${subcommandName}`,
        ),
      );
    }

    return subcommandHandler(spriteState, argv);
  };
}

/**
 * Constructor options for `createSpriteCommandDispatcher`.
 * Mirrors state/command wiring around `SpriteCmd` + `DoSpriteCmd`
 * in `ref/micropolis/src/sim/w_sprite.c`.
 */
export interface CreateSpriteCommandDispatcherOptions {
  runtime: ScriptRuntime;
  sprites?: SpriteRegistry<SpriteState>;
  createSpriteState?: (commandName: string, type: number) => SpriteState;
  subcommands?: SpriteSubcommandTable;
}

/**
 * Creates the top-level `sprite` factory command dispatcher.
 * Mirrors `SpriteCmd` creation flow for `sprite <name> <type>` in
 * `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: type validation enforces `1..OBJN-1` (`OBJN=9` in `sim.h`).
 * Difference from C: duplicate sprite names return a typed internal error
 * rather than replacing an existing Tcl command.
 */
export function createSpriteCommandDispatcher(
  options: CreateSpriteCommandDispatcherOptions,
): ScriptCommandHandler {
  const sprites = options.sprites ?? new SpriteRegistry<SpriteState>();
  const createState =
    options.createSpriteState ??
    ((commandName: string, type: number) => createSpriteState(commandName, type));
  const subcommands = options.subcommands ?? SPRITE_SUBCOMMAND_TABLE;

  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 3) {
      return makeInvalidArgCount(`sprite command expects argc 3, got ${argv.length}`);
    }

    const commandName = argv[1];
    const rawType = argv[2];
    if (commandName === undefined || rawType === undefined) {
      return makeInvalidArgCount('sprite command requires <name> and <type>');
    }

    const parsedType = parseTclInt32(rawType);
    if (parsedType === null || parsedType < SPRITE_TYPE_MIN || parsedType > SPRITE_TYPE_MAX) {
      return makeInvalidInteger(
        `sprite command expected an integer type in range ${SPRITE_TYPE_MIN}..${SPRITE_TYPE_MAX}: ${rawType}`,
      );
    }

    if (sprites.get(commandName) !== undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `sprite command already exists: ${commandName}`,
        ),
      );
    }

    const spriteState = createState(commandName, parsedType);
    sprites.add(commandName, spriteState);
    options.runtime.registerCommand(
      commandName,
      createSpriteWidgetCommandDispatcher(spriteState, subcommands),
    );
    return makeScriptSuccess(commandName);
  };
}

/**
 * Registers the top-level `sprite` command in a runtime.
 * Mirrors `Tcl_CreateCommand(..., "sprite", SpriteCmd, ...)`
 * in `sprite_command_init` (`ref/micropolis/src/sim/w_sprite.c`).
 */
export function registerSpriteCommand(
  runtime: ScriptRuntime,
  options: Omit<CreateSpriteCommandDispatcherOptions, 'runtime'> = {},
): void {
  runtime.registerCommand(
    'sprite',
    createSpriteCommandDispatcher({
      runtime,
      ...options,
    }),
  );
}
