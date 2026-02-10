import { describe, expect, it } from 'vitest';

import {
  getMapCanvasLayerZIndex,
  projectRealtimeOverlaySprites,
  selectMapCanvasDrawMode,
  selectMapCanvasTileRenderMode,
} from './map-canvas.tsx';

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
      // `InitSprite` in `w_sprite.c` sets COP to width/height=32 and x/y offsets 32/-16.
      { name: 'copter', label: 'COP', left: 160, top: 112, width: 32, height: 32 },
      // `InitSprite` in `w_sprite.c` sets AIR to width/height=48 and x/y offsets 24/0.
      { name: 'plane', label: 'AIR', left: 152, top: 128, width: 48, height: 48 },
      // `InitSprite` in `w_sprite.c` sets SHI to width/height=48 and x/y offsets 32/-16.
      { name: 'ship', label: 'SHP', left: 160, top: 112, width: 48, height: 48 },
      // `InitSprite` in `w_sprite.c` sets GOD to width/height=48 and x/y offsets 24/0.
      { name: 'monster', label: 'MON', left: 152, top: 128, width: 48, height: 48 },
      // `InitSprite` in `w_sprite.c` sets TOR to width/height=48 and x/y offsets 24/0.
      { name: 'tornado', label: 'TOR', left: 152, top: 128, width: 48, height: 48 },
      // `InitSprite` in `w_sprite.c` sets EXP to width/height=48 and x/y offsets 24/0.
      { name: 'explosion', label: 'EXP', left: 152, top: 128, width: 48, height: 48 },
    ]);
  });

  it('keeps realtime overlay projection deterministic across payload order changes', () => {
    const forward = projectRealtimeOverlaySprites({
      objects: [
        // Bridge realtime ids map to stable in-process sprite identities from
        // `w_sprite.c`; Stage 7 sorts by id for deterministic replay ordering.
        { id: 'rt-3', name: 'TOR', type: 6, x: 128, y: 144, frame: 2 },
        { id: 'rt-1', name: 'TRA', type: 1, x: 96, y: 96, frame: 3 },
        { id: 'rt-2', name: 'AIR', type: 3, x: 160, y: 96, frame: 5 },
      ],
      tileSize: 4,
      mapWidth: 120,
      mapHeight: 100,
    });

    const reverse = projectRealtimeOverlaySprites({
      objects: [
        { id: 'rt-2', name: 'AIR', type: 3, x: 160, y: 96, frame: 5 },
        { id: 'rt-1', name: 'TRA', type: 1, x: 96, y: 96, frame: 3 },
        { id: 'rt-3', name: 'TOR', type: 6, x: 128, y: 144, frame: 2 },
      ],
      tileSize: 4,
      mapWidth: 120,
      mapHeight: 100,
    });

    expect(forward).toEqual(reverse);
    expect(forward.map((sprite) => sprite.key)).toEqual(['id:rt-1', 'id:rt-2', 'id:rt-3']);
  });

  it('keeps legacy realtime overlay projection deterministic across payload order changes', () => {
    const forward = projectRealtimeOverlaySprites({
      objects: [
        // Legacy payload compatibility can omit bridge ids; keep deterministic
        // overlay sort/key behavior while C `DrawObjects` sprite order is ported.
        { name: 'TOR', type: 6, x: 128, y: 144, frame: 2 },
        { name: 'TRA', type: 1, x: 96, y: 96, frame: 3 },
        { name: 'AIR', type: 3, x: 160, y: 96, frame: 5 },
      ],
      tileSize: 4,
      mapWidth: 120,
      mapHeight: 100,
    });

    const reverse = projectRealtimeOverlaySprites({
      objects: [
        { name: 'AIR', type: 3, x: 160, y: 96, frame: 5 },
        { name: 'TRA', type: 1, x: 96, y: 96, frame: 3 },
        { name: 'TOR', type: 6, x: 128, y: 144, frame: 2 },
      ],
      tileSize: 4,
      mapWidth: 120,
      mapHeight: 100,
    });

    expect(forward).toEqual(reverse);
    expect(forward.map((sprite) => sprite.key)).toEqual([
      'legacy:1:TRA',
      'legacy:3:AIR',
      'legacy:6:TOR',
    ]);
  });

  it('keeps legacy type/name keys stable across movement updates', () => {
    const baseline = projectRealtimeOverlaySprites({
      objects: [{ name: 'TRA', type: 1, x: 128, y: 128, frame: 1 }],
      tileSize: 8,
      mapWidth: 120,
      mapHeight: 100,
    });
    const moved = projectRealtimeOverlaySprites({
      objects: [{ name: 'TRA', type: 1, x: 160, y: 128, frame: 2 }],
      tileSize: 8,
      mapWidth: 120,
      mapHeight: 100,
    });

    // `MoveObjects` mutates sprite x/y/frame per tick in `w_sprite.c`; fallback
    // legacy key keeps React reconciliation stable when bridge ids are absent.
    expect(baseline[0]?.key).toBe('legacy:1:TRA');
    expect(moved[0]?.key).toBe('legacy:1:TRA');
    expect(baseline[0]?.left).not.toBe(moved[0]?.left);
  });

  it('keeps id-keyed overlays stable across patch movement updates', () => {
    const baseline = projectRealtimeOverlaySprites({
      objects: [{ id: 'rt-7', name: 'TRA', type: 1, x: 128, y: 128, frame: 1 }],
      tileSize: 8,
      mapWidth: 120,
      mapHeight: 100,
    });
    const moved = projectRealtimeOverlaySprites({
      objects: [{ id: 'rt-7', name: 'TRA', type: 1, x: 160, y: 128, frame: 2 }],
      tileSize: 8,
      mapWidth: 120,
      mapHeight: 100,
    });

    // `MoveObjects` mutates sprite x/y/frame per tick in `w_sprite.c`; bridge id
    // stays stable so overlay reconciliation can follow patch cadence without remounts.
    expect(baseline[0]?.key).toBe('id:rt-7');
    expect(moved[0]?.key).toBe('id:rt-7');
    expect(baseline[0]?.left).not.toBe(moved[0]?.left);
  });
});

describe('map canvas tile render mode selection', () => {
  it('uses diagnostic debug renderer only when explicit debug flag is enabled', () => {
    expect(
      selectMapCanvasTileRenderMode({
        debugTileRendererEnabled: true,
        hasAtlasImage: true,
      }),
    ).toBe('diagnostic-debug');
    expect(
      selectMapCanvasTileRenderMode({
        debugTileRendererEnabled: true,
        hasAtlasImage: false,
      }),
    ).toBe('diagnostic-debug');
  });

  it('uses Micropolis sprite atlas when debug flag is disabled and atlas image exists', () => {
    expect(
      selectMapCanvasTileRenderMode({
        debugTileRendererEnabled: false,
        hasAtlasImage: true,
      }),
    ).toBe('atlas');
  });

  it('uses missing-atlas fallback when debug flag is disabled and atlas image is unavailable', () => {
    expect(
      selectMapCanvasTileRenderMode({
        debugTileRendererEnabled: false,
        hasAtlasImage: false,
      }),
    ).toBe('missing-atlas');
  });
});

describe('map canvas layer ordering', () => {
  it('keeps map, pending tool, and realtime overlays in Micropolis draw order', () => {
    // `DoUpdateEditor` in `w_editor.c` draws map first, then pending tool preview,
    // then realtime objects (`DrawObjects`) on top.
    expect(getMapCanvasLayerZIndex('map')).toBeLessThan(getMapCanvasLayerZIndex('pending-tool'));
    expect(getMapCanvasLayerZIndex('pending-tool')).toBeLessThan(
      getMapCanvasLayerZIndex('realtime-overlay'),
    );
  });
});
