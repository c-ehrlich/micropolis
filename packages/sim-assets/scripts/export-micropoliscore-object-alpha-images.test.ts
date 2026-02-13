import { describe, expect, it } from 'vitest';

import {
  bakeMicropolisCoreObjectSheetToRgba,
  createFrameColorKeyMatteMask,
} from './export-micropoliscore-object-alpha-images.mjs';

function toIndexes(rows: readonly (readonly number[])[]): Uint8Array {
  const flattened = rows.flatMap((row) => row);
  return Uint8Array.from(flattened);
}

describe('export-micropoliscore-object-alpha-images', () => {
  it('treats every frame-local matte pixel as transparent', () => {
    const width = 5;
    const height = 5;
    const indexes = toIndexes([
      [0, 0, 0, 0, 0],
      [0, 1, 1, 1, 0],
      [0, 1, 0, 1, 1],
      [0, 1, 1, 1, 0],
      [0, 0, 0, 0, 0],
    ]);
    const transparentMask = createFrameColorKeyMatteMask({
      indexes,
      width,
      height,
      frameWidth: 5,
      frameHeight: 5,
    });

    // The center pixel is matte-colored (`0`) and therefore transparent.
    expect(transparentMask[2 * width + 2]).toBe(1);
    expect(transparentMask[0]).toBe(1);
    expect(transparentMask[4]).toBe(1);
  });

  it('uses frame-local top-left matte index when baking multiple frames', () => {
    // Frame dimensions mirror `InitSprite` object frame ownership from
    // `ref/micropolis/src/sim/w_sprite.c` (single-row strips split by fixed frame size).
    const width = 10;
    const height = 5;
    const indexes = toIndexes([
      [0, 0, 0, 0, 0, 2, 2, 2, 2, 2],
      [0, 1, 1, 1, 0, 2, 1, 1, 1, 2],
      [0, 1, 1, 1, 0, 2, 1, 2, 1, 1],
      [0, 1, 1, 1, 0, 2, 1, 1, 1, 2],
      [0, 0, 0, 0, 0, 2, 2, 2, 2, 2],
    ]);
    const palette = [
      [0, 0, 0],
      [255, 0, 0],
      [0, 0, 255],
    ] as const;

    const rgba = bakeMicropolisCoreObjectSheetToRgba({
      width,
      height,
      palette,
      indexes,
      frameWidth: 5,
      frameHeight: 5,
    });
    const alphaAt = (x: number, y: number) => rgba[(y * width + x) * 4 + 3];

    // Frame 0 matte index is `0`.
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(2, 2)).toBe(255);
    // Frame 1 matte index is `2`; enclosed matte pixel is transparent.
    expect(alphaAt(5, 0)).toBe(0);
    expect(alphaAt(7, 2)).toBe(0);
  });
});
