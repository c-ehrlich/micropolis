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
});
