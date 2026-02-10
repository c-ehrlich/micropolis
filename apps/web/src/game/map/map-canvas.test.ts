import { describe, expect, it } from 'vitest';

import { projectRealtimeOverlaySprites, selectMapCanvasDrawMode } from './map-canvas.tsx';

describe('map canvas draw-mode selection', () => {
  it('keeps full redraw ownership for authoritative snapshot frames', () => {
    expect(
      selectMapCanvasDrawMode({
        mapDrawMode: 'snapshot',
        renderEpoch: 3,
        lastRenderedEpoch: 2,
        resized: false,
      }),
    ).toBe('snapshot');
  });

  it('forces full redraw when canvas backing store was reset', () => {
    expect(
      selectMapCanvasDrawMode({
        mapDrawMode: 'patch',
        renderEpoch: 4,
        lastRenderedEpoch: 3,
        resized: true,
      }),
    ).toBe('snapshot');
  });

  it('forces full redraw for first authoritative paint', () => {
    expect(
      selectMapCanvasDrawMode({
        mapDrawMode: 'patch',
        renderEpoch: 2,
        lastRenderedEpoch: 0,
        resized: false,
      }),
    ).toBe('snapshot');
  });

  it('forces full redraw when runtime skipped intermediate map epochs', () => {
    // Stage 4 runtime envelopes can be batched by React state updates; when
    // more than one map epoch is skipped, redraw from full authoritative tiles.
    expect(
      selectMapCanvasDrawMode({
        mapDrawMode: 'patch',
        renderEpoch: 9,
        lastRenderedEpoch: 6,
        resized: false,
      }),
    ).toBe('snapshot');
  });

  it('keeps patch redraw when epochs are contiguous', () => {
    expect(
      selectMapCanvasDrawMode({
        mapDrawMode: 'patch',
        renderEpoch: 7,
        lastRenderedEpoch: 6,
        resized: false,
      }),
    ).toBe('patch');
  });

  it('projects train overlay placement using Micropolis sprite offsets', () => {
    const overlays = projectRealtimeOverlaySprites({
      // `TRA` sprite frame/position mirrors `SimSprite` in `w_sprite.c`.
      objects: [{ name: 'TRA', type: 1, x: 64, y: 80, frame: 2 }],
      tileSize: 4,
      mapWidth: 120,
      mapHeight: 100,
    });

    expect(overlays).toHaveLength(1);
    const projected = overlays[0];
    if (projected === undefined) {
      throw new Error('Expected one realtime overlay sprite projection');
    }

    // `InitSprite` for `TRA` sets width/height=32 and offsets x=32,y=-16 in `w_sprite.c`.
    expect(projected.left).toBe(24);
    expect(projected.top).toBe(16);
    expect(projected.width).toBe(8);
    expect(projected.height).toBe(8);
    expect(projected.label).toBe('TRN');
  });

  it('skips inactive and out-of-bounds realtime overlay objects', () => {
    const overlays = projectRealtimeOverlaySprites({
      objects: [
        { name: 'EXP', type: 7, x: 128, y: 128, frame: 0 },
        { name: 'EXP', type: 7, x: -2000, y: -2000, frame: 1 },
      ],
      tileSize: 4,
      mapWidth: 120,
      mapHeight: 100,
    });

    expect(overlays).toEqual([]);
  });

  it('projects train/ship/plane/copter/monster/tornado/explosion overlays', () => {
    const overlays = projectRealtimeOverlaySprites({
      objects: [
        { name: 'TRA', type: 1, x: 128, y: 128, frame: 1 },
        { name: 'SHI', type: 4, x: 128, y: 128, frame: 1 },
        { name: 'AIR', type: 3, x: 128, y: 128, frame: 1 },
        { name: 'COP', type: 2, x: 128, y: 128, frame: 1 },
        { name: 'GOD', type: 5, x: 128, y: 128, frame: 1 },
        { name: 'TOR', type: 6, x: 128, y: 128, frame: 1 },
        { name: 'EXP', type: 7, x: 128, y: 128, frame: 1 },
      ],
      tileSize: 16,
      mapWidth: 120,
      mapHeight: 100,
    });

    expect(
      overlays.map((overlay) => ({
        name: overlay.name,
        label: overlay.label,
        left: overlay.left,
        top: overlay.top,
        width: overlay.width,
        height: overlay.height,
      })),
    ).toEqual([
      // `InitSprite` in `w_sprite.c` sets TRA to width/height=32 and x/y offsets 32/-16.
      { name: 'train', label: 'TRN', left: 160, top: 112, width: 32, height: 32 },
      // `InitSprite` in `w_sprite.c` sets SHI to width/height=48 and x/y offsets 32/-16.
      { name: 'ship', label: 'SHP', left: 160, top: 112, width: 48, height: 48 },
      // `InitSprite` in `w_sprite.c` sets AIR to width/height=48 and x/y offsets 24/0.
      { name: 'plane', label: 'AIR', left: 152, top: 128, width: 48, height: 48 },
      // `InitSprite` in `w_sprite.c` sets COP to width/height=32 and x/y offsets 32/-16.
      { name: 'copter', label: 'COP', left: 160, top: 112, width: 32, height: 32 },
      // `InitSprite` in `w_sprite.c` sets GOD to width/height=48 and x/y offsets 24/0.
      { name: 'monster', label: 'MON', left: 152, top: 128, width: 48, height: 48 },
      // `InitSprite` in `w_sprite.c` sets TOR to width/height=48 and x/y offsets 24/0.
      { name: 'tornado', label: 'TOR', left: 152, top: 128, width: 48, height: 48 },
      // `InitSprite` in `w_sprite.c` sets EXP to width/height=48 and x/y offsets 24/0.
      { name: 'explosion', label: 'EXP', left: 152, top: 128, width: 48, height: 48 },
    ]);
  });
});
