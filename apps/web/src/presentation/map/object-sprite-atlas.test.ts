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

  it('maps MicropolisCore tileset frame lookups to themed sprite sheets', () => {
    const spriteFrame = lookupObjectSpriteFrame({
      // Type `2` is COP in `sim.h`; frame indexing stays `(frame - 1)` from `DrawObjects`.
      spriteType: 2,
      runtimeFrame: 1,
      tilesetName: 'futureusa',
    });

    expect(spriteFrame?.spriteFrameUrl).toBeUndefined();
    expect(spriteFrame?.spriteSheetUrl).toContain(
      'micropoliscore-tilesets/futureusa/chopper-alpha',
    );
    expect(spriteFrame?.derivedPngPath).toBe(
      'packages/sim-assets/micropoliscore-tilesets/futureusa/chopper-alpha.png',
    );
    expect(spriteFrame?.sourceX).toBe(0);
    expect(spriteFrame?.sourceY).toBe(0);
    expect(spriteFrame?.sourceWidth).toBe(32);
    expect(spriteFrame?.sourceHeight).toBe(32);
  });

  it('falls back to classic object art when a themed tileset has no matching object type', () => {
    const spriteFrame = lookupObjectSpriteFrame({
      // Type `8` is BUS in legacy `GetObjectXpms`; MicropolisCore packs do not provide a bus sheet.
      spriteType: 8,
      runtimeFrame: 1,
      tilesetName: 'mooncolony',
    });

    expect(spriteFrame?.spriteFrameUrl).toContain('obj8-0');
    expect(spriteFrame?.spriteSheetUrl).toBeUndefined();
  });

  it('applies monochrome object filter for classic bw runtime tileset', () => {
    const spriteFrame = lookupObjectSpriteFrame({
      // Type `4` is SHI in `sim.h`; no dedicated `obj*bw` assets exist in Micropolis.
      spriteType: 4,
      runtimeFrame: 1,
      tilesetName: 'classicbw',
    });

    expect(spriteFrame?.spriteFrameUrl).toContain('obj4-0');
    expect(spriteFrame?.renderFilterCss).toContain('grayscale');
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
