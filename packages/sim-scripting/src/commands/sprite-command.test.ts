import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { SpriteRegistry } from '../state/sprite-registry.ts';
import {
  createSpriteCommandDispatcher,
  createSpriteState,
  createSpriteSubcommandEntries,
  createSpriteSubcommandTable,
  createSpriteWidgetCommandDispatcher,
  registerSpriteCommand,
  type SpriteState,
} from './sprite-command.ts';

describe('sprite top-level command shell', () => {
  it('creates a named sprite command and registers full sprite subcommand dispatch', () => {
    const runtime = new ScriptRuntime();
    const sprites = new SpriteRegistry<SpriteState>();
    registerSpriteCommand(runtime, {
      sprites,
    });

    expect(runtime.invoke(['sprite', 'godzilla', '5'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'godzilla',
    });

    const created = sprites.get('godzilla');
    expect(created).toBeDefined();
    if (created === undefined) {
      throw new Error('expected sprite state to be registered');
    }

    // `SpriteCmd` calls `NewSprite(argv[1], type, 0, 0)` and then sets `frame = 0`
    // in `ref/micropolis/src/sim/w_sprite.c`.
    expect(created.name).toBe('godzilla');
    expect(created.type).toBe(5);
    expect(created.frame).toBe(0);
    expect(created.width).toBe(48);
    expect(created.height).toBe(48);

    expect(runtime.invoke(['godzilla', 'name'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'godzilla',
    });
    expect(runtime.invoke(['godzilla', 'Init', '1919', '1599'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    // `InitSprite` for GOD sets `frame = 10` in lower-right world half and
    // copies init coordinates to `orig_x/orig_y` (`w_sprite.c`).
    expect(runtime.invoke(['godzilla', 'frame'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '10',
    });
    expect(runtime.invoke(['godzilla', 'orig_x'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1919',
    });
    expect(runtime.invoke(['godzilla', 'orig_y'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1599',
    });
  });

  it('matches SpriteCmd argc and type validation rules', () => {
    const runtime = new ScriptRuntime();
    const dispatcher = createSpriteCommandDispatcher({ runtime });

    expect(dispatcher(['sprite', 'godzilla'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'sprite command expects argc 3, got 2',
    });

    expect(dispatcher(['sprite', 'godzilla', 'abc'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sprite command expected an integer type in range 1..8: abc',
    });

    // `OBJN` is `9` in `ref/micropolis/src/sim/headers/sim.h`, so
    // `SpriteCmd` accepts only `1..OBJN-1` => `1..8`.
    expect(dispatcher(['sprite', 'godzilla', '0'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sprite command expected an integer type in range 1..8: 0',
    });

    expect(dispatcher(['sprite', 'godzilla', '9'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sprite command expected an integer type in range 1..8: 9',
    });

    // `SpriteCmd` uses `Tcl_GetInt`, so hex and leading-zero octal forms are valid.
    expect(dispatcher(['sprite', 'train', '0x1'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'train',
    });
    expect(dispatcher(['sprite', 'bus', '010'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'bus',
    });
  });

  it('returns a typed internal error for duplicate sprite command names', () => {
    const runtime = new ScriptRuntime();
    const dispatcher = createSpriteCommandDispatcher({ runtime });

    expect(dispatcher(['sprite', 'copter', '2'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'copter',
    });

    expect(dispatcher(['sprite', 'copter', '2'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: 'sprite command already exists: copter',
    });
  });
});

describe('sprite widget command shell', () => {
  it('dispatches sprite subcommands with case-sensitive lookup', () => {
    const spriteState = createSpriteState('copter', 2);
    const dispatcher = createSpriteWidgetCommandDispatcher(
      spriteState,
      createSpriteSubcommandTable([
        ['ping', () => makeScriptSuccess('pong')],
        ['status', (sprite) => makeScriptSuccess(`${sprite.name}:${sprite.type}`)],
      ]),
    );

    expect(dispatcher(['copter', 'ping'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'pong',
    });
    expect(dispatcher(['copter', 'status'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'copter:2',
    });

    expect(dispatcher(['copter'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'copter command requires a subcommand in argv[1]',
    });

    expect(dispatcher(['copter', 'Ping'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown sprite subcommand: Ping',
    });
  });

  it('uses last-entry-wins semantics for duplicate subcommand registrations', () => {
    const spriteState = createSpriteState('bus', 8);
    const dispatcher = createSpriteWidgetCommandDispatcher(
      spriteState,
      createSpriteSubcommandTable([
        ['mode', () => makeScriptSuccess('old')],
        ['mode', () => makeScriptSuccess('new')],
      ]),
    );

    expect(dispatcher(['bus', 'mode'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'new',
    });
  });

  it('implements every `SPRITECMD_ACCESS_INT` accessor plus `name` semantics', () => {
    const spriteState = createSpriteState('bus', 8);
    const dispatcher = createSpriteWidgetCommandDispatcher(spriteState);

    // Accessor set comes from `SPRITECMD_ACCESS_INT(...)` registrations in
    // `ref/micropolis/src/sim/w_sprite.c`.
    const intAccessors = [
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
    ] as const satisfies readonly (keyof SpriteState)[];

    for (const [index, accessor] of intAccessors.entries()) {
      const rawValue = String(index - 12);
      expect(dispatcher(['bus', accessor, rawValue])).toEqual({
        code: ScriptResultCode.Ok,
        value: String(index - 12),
      });
      expect(dispatcher(['bus', accessor])).toEqual({
        code: ScriptResultCode.Ok,
        value: String(index - 12),
      });
    }

    // `SpriteCmdname` uses `SPRITECMD_GET_STR` in `w_sprite.c`, which does
    // not argc-check and always returns `sprite->name`.
    expect(dispatcher(['bus', 'name'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'bus',
    });
    expect(dispatcher(['bus', 'name', 'ignored'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'bus',
    });
  });

  it('enforces accessor argc and Tcl integer parsing parity', () => {
    const spriteState = createSpriteState('train', 1);
    const dispatcher = createSpriteWidgetCommandDispatcher(spriteState);

    expect(dispatcher(['train', 'frame', '1', '2'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'train frame expects argc 2 or 3, got 4',
    });

    expect(dispatcher(['train', 'frame', 'abc'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'train frame expected a 32-bit integer at argv[2]: abc',
    });

    expect(dispatcher(['train', 'frame', '2147483648'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'train frame expected a 32-bit integer at argv[2]: 2147483648',
    });

    // `Tcl_GetInt` accepts hex and leading-zero octal in C.
    expect(dispatcher(['train', 'frame', '0x10'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '16',
    });
    expect(dispatcher(['train', 'x', '010'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '8',
    });
  });

  it('enforces `Init` argc and world-pixel bounds from `WORLD_X/Y`', () => {
    const spriteState = createSpriteState('copter', 2);
    const dispatcher = createSpriteWidgetCommandDispatcher(spriteState);

    // `SimWidth=120` and `SimHeight=100` in `ref/micropolis/src/sim/headers/sim.h`,
    // so `Init` bounds in `w_sprite.c` are `x: 0..1919` and `y: 0..1599`.
    expect(dispatcher(['copter', 'Init', '100'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'copter Init expects argc 4, got 3',
    });
    expect(dispatcher(['copter', 'Init', 'abc', '0'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'copter Init expected a 32-bit integer x at argv[2]: abc',
    });
    expect(dispatcher(['copter', 'Init', '-1', '0'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'copter Init expected x in range 0..1919: -1',
    });
    expect(dispatcher(['copter', 'Init', '1920', '0'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'copter Init expected x in range 0..1919: 1920',
    });
    expect(dispatcher(['copter', 'Init', '0', '1600'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'copter Init expected y in range 0..1599: 1600',
    });
  });

  it('applies C `InitSprite` per-type defaults for all sprite types', () => {
    const subcommands = createSpriteSubcommandTable(
      createSpriteSubcommandEntries({
        policeMaxX: 13,
        policeMaxY: 9,
        randomIntInclusive: (maxInclusive) => maxInclusive,
      }),
    );

    const tra = createSpriteState('tra', 1);
    const traDispatcher = createSpriteWidgetCommandDispatcher(tra, subcommands);
    expect(traDispatcher(['tra', 'Init', '64', '80'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(tra).toMatchObject({
      x: 64,
      y: 80,
      frame: 1,
      width: 32,
      height: 32,
      x_offset: 32,
      y_offset: -16,
      x_hot: 40,
      y_hot: -8,
      dir: 4,
      control: -1,
      speed: 100,
    });

    const shi = createSpriteState('shi', 4);
    const shiDispatcher = createSpriteWidgetCommandDispatcher(shi, subcommands);
    expect(shiDispatcher(['shi', 'Init', '0', '100'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(shi).toMatchObject({
      frame: 3,
      new_dir: 3,
      dir: 10,
      count: 1,
      width: 48,
      height: 48,
    });

    const god = createSpriteState('god', 5);
    const godDispatcher = createSpriteWidgetCommandDispatcher(god, subcommands);
    expect(godDispatcher(['god', 'Init', '961', '801'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(god).toMatchObject({
      frame: 10,
      count: 1000,
      dest_x: 208,
      dest_y: 144,
      orig_x: 961,
      orig_y: 801,
      width: 48,
      height: 48,
    });

    const cop = createSpriteState('cop', 2);
    const copDispatcher = createSpriteWidgetCommandDispatcher(cop, subcommands);
    expect(copDispatcher(['cop', 'Init', '100', '200'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(cop).toMatchObject({
      frame: 5,
      count: 1500,
      dest_x: 1919,
      dest_y: 1599,
      orig_x: 70,
      orig_y: 200,
      width: 32,
      height: 32,
    });

    const air = createSpriteState('air', 3);
    const airDispatcher = createSpriteWidgetCommandDispatcher(air, subcommands);
    expect(airDispatcher(['air', 'Init', '1700', '320'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(air).toMatchObject({
      x: 1552,
      y: 320,
      frame: 7,
      dest_x: 1352,
      dest_y: 320,
      width: 48,
      height: 48,
    });

    const tor = createSpriteState('tor', 6);
    const torDispatcher = createSpriteWidgetCommandDispatcher(tor, subcommands);
    expect(torDispatcher(['tor', 'Init', '500', '600'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(tor).toMatchObject({
      frame: 1,
      count: 200,
      width: 48,
      height: 48,
      x_hot: 40,
      y_hot: 36,
    });

    const exp = createSpriteState('exp', 7);
    const expDispatcher = createSpriteWidgetCommandDispatcher(exp, subcommands);
    expect(expDispatcher(['exp', 'Init', '333', '444'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(exp).toMatchObject({
      frame: 1,
      width: 48,
      height: 48,
      x_hot: 40,
      y_hot: 16,
    });

    const bus = createSpriteState('bus', 8);
    const busDispatcher = createSpriteWidgetCommandDispatcher(bus, subcommands);
    expect(busDispatcher(['bus', 'Init', '222', '111'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(bus).toMatchObject({
      frame: 1,
      dir: 1,
      width: 32,
      height: 32,
      x_offset: 30,
      y_offset: -18,
    });
  });

  it('applies `Explode` frame/message parity and preserves C argc quirk', () => {
    const explodeEvents: Array<{
      readonly spriteName: string;
      readonly spriteType: number;
      readonly pixelX: number;
      readonly pixelY: number;
      readonly tileX: number;
      readonly tileY: number;
      readonly messageCode?: number;
    }> = [];
    const subcommands = createSpriteSubcommandTable(
      createSpriteSubcommandEntries({
        onExplode: (event) => {
          explodeEvents.push(event);
        },
      }),
    );

    const spriteState = createSpriteState('heli', 3);
    spriteState.frame = 11;
    spriteState.x = 160;
    spriteState.y = 64;
    const dispatcher = createSpriteWidgetCommandDispatcher(spriteState, subcommands);

    expect(dispatcher(['heli', 'Explode'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
    expect(spriteState.frame).toBe(0);
    expect(explodeEvents).toEqual([
      {
        spriteName: 'heli',
        spriteType: 3,
        pixelX: 208,
        pixelY: 80,
        tileX: 13,
        tileY: 5,
        messageCode: -24,
      },
    ]);

    // `SpriteCmdExplode` in `w_sprite.c` does not validate argc.
    expect(dispatcher(['heli', 'Explode', 'ignored'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });
  });
});
