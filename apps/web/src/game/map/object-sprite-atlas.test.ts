import { describe, expect, it } from 'vitest';

import { lookupObjectSpriteFrame } from './object-sprite-atlas.ts';

describe('object sprite atlas', () => {
  it('maps copter runtime frame 1 to the first COP object sprite frame', () => {
    // Magic numbers from Micropolis C:
    // - Type `2` is `COP` in `sim.h` and `w_sprite.c`.
    // - `DrawObjects` indexes object art with `(frame - 1)` in `w_sprite.c`,
    //   so runtime frame `1` draws `obj2-0.xpm`.
    const spriteFrame = lookupObjectSpriteFrame({
      spriteType: 2,
      runtimeFrame: 1,
    });

    expect(spriteFrame?.sourceFrame).toBe(0);
    expect(spriteFrame?.canonicalIdentityKey).toBe('ref/micropolis/images/obj2-0.xpm');
    expect(spriteFrame?.derivedPngPath).toBe(
      'packages/sim-assets/generated-images/images/obj2-0.png',
    );
    expect(spriteFrame?.spriteFrameUrl).toContain('obj2-0');
  });

  it('returns undefined for inactive frame 0, matching DrawObjects skip behavior', () => {
    expect(
      lookupObjectSpriteFrame({
        // Type `2` is COP in `sim.h`; frame `0` is inactive in `DrawObjects`.
        spriteType: 2,
        runtimeFrame: 0,
      }),
    ).toBeUndefined();
  });

  it('returns undefined when the requested frame is outside discovered obj frame files', () => {
    expect(
      lookupObjectSpriteFrame({
        // COP has 8 frames (`obj2-0`..`obj2-7`) per `GetObjectXpms` in `g_setup.c`.
        spriteType: 2,
        runtimeFrame: 999,
      }),
    ).toBeUndefined();
  });
});
