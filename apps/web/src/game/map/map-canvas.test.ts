import { describe, expect, it } from 'vitest';

import { Tile, TileFlag } from '../../../../../packages/sim-core/src/core/constants.ts';
import {
  computeMapCanvasZoomFromWheel,
  consumeQueuedMapCanvasFrame,
  continueMapCanvasPanDrag,
  forEachMapCanvasPatchTileIndex,
  getMapCanvasCameraMetrics,
  getMapCanvasLayerZIndex,
  isMapCanvasUnpoweredZoneBlinkPhase,
  isMapCanvasZoomWheelGesture,
  normalizeMapCanvasWheelDeltaToPixels,
  projectMapCanvasToolFootprintRect,
  projectRealtimeOverlaySprites,
  scaleMapPanDeltaToWorldPixels,
  scaleWorldPanDeltaToCanvasPixels,
  selectMapCanvasBaseTileAtlasCanonicalIdentityKey,
  selectMapCanvasDrawMode,
  selectMapCanvasTileRenderMode,
  startMapCanvasPanDrag,
  traceMapCanvasSingleTileToolDragPath,
  zoomMapCanvasCameraOffsetAtAnchor,
} from './map-canvas.tsx';
import {
  DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
  lookupTileSprite,
} from './tile-sprite-atlas.ts';

const MAP_CLASS_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY = 'ref/micropolis/images/tilessm.xpm';

function toRuntimeTileIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

function toTileVisualToken(tileWord: number): string {
  // `MemDrawBeegMapRect` in `g_bigmap.c` resolves one sprite row from
  // `(tile & LOMASK)` (+ `TILE_COUNT` wrapping), which is ported by lookupTileSprite.
  const sprite = lookupTileSprite(tileWord, {
    atlasCanonicalIdentityKey: DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
  });
  return `${sprite.atlasCanonicalIdentityKey}:${sprite.tileId}:${sprite.sourceX}:${sprite.sourceY}:${sprite.sourceWidth}:${sprite.sourceHeight}`;
}

function applyPatchTileVisualTokens({
  beforeTiles,
  afterTiles,
  width,
  height,
  dirtyRects,
  dirtyTileIndexes,
}: {
  beforeTiles: Uint16Array;
  afterTiles: Uint16Array;
  width: number;
  height: number;
  dirtyRects: readonly Readonly<{ x: number; y: number; width: number; height: number }>[];
  dirtyTileIndexes: Uint32Array;
}): string[] {
  const patchVisuals = Array.from(beforeTiles, (tileWord) => toTileVisualToken(tileWord));
  forEachMapCanvasPatchTileIndex(
    {
      width,
      height,
      dirtyRects,
      dirtyTileIndexes,
    },
    (tileIndex) => {
      patchVisuals[tileIndex] = toTileVisualToken(afterTiles[tileIndex] ?? 0);
    },
  );
  return patchVisuals;
}

describe('map canvas draw-mode selection', () => {
  it('uses map-class tiles for compact runtime tile sizes', () => {
    // `GetViewTiles` in `g_setup.c` selects `tilessm.xpm` for `Map_Class` color mode.
    expect(selectMapCanvasBaseTileAtlasCanonicalIdentityKey(6)).toBe(
      MAP_CLASS_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
    );
    expect(selectMapCanvasBaseTileAtlasCanonicalIdentityKey(7)).toBe(
      MAP_CLASS_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
    );
  });

  it('uses editor-class tiles once runtime tile size reaches editor readability', () => {
    // `GetViewTiles` in `g_setup.c` selects `tiles.xpm` for `Editor_Class` color mode.
    expect(selectMapCanvasBaseTileAtlasCanonicalIdentityKey(8)).toBe(
      DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
    );
    expect(selectMapCanvasBaseTileAtlasCanonicalIdentityKey(16)).toBe(
      DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
    );
  });

  it('consumes queued frames as single-use entries to avoid stale redraw coalescing', () => {
    const queuedFrameRef: { current: { epoch: number } | null } = {
      current: { epoch: 7 },
    };

    const first = consumeQueuedMapCanvasFrame(queuedFrameRef);
    const second = consumeQueuedMapCanvasFrame(queuedFrameRef);

    expect(first).toEqual({ epoch: 7 });
    expect(second).toBeNull();
  });

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

  it('forces full redraw when Micropolis blink phase toggles', () => {
    expect(
      selectMapCanvasDrawMode({
        mapDrawMode: 'patch',
        renderEpoch: 2,
        lastRenderedEpoch: 2,
        resized: false,
        blinkPhaseChanged: true,
      }),
    ).toBe('snapshot');
  });

  it('keeps patch redraw when runtime skipped intermediate map epochs', () => {
    // Dirty-Rect Coalescing coalesces queued map dirty coverage across skipped epochs, so
    // patch repaint remains sufficient without forcing full-canvas redraw.
    expect(
      selectMapCanvasDrawMode({
        mapDrawMode: 'patch',
        renderEpoch: 9,
        lastRenderedEpoch: 6,
        resized: false,
      }),
    ).toBe('patch');
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

  it('matches C half-second flagBlink phase for unpowered-zone lightning blinking', () => {
    // `sim_update` in `sim.c` sets:
    // `flagBlink = (now_time.tv_usec < 500000) ? 1 : -1`
    // and `g_bigmap.c` blinks when `flagBlink <= 0`.
    expect(isMapCanvasUnpoweredZoneBlinkPhase(0)).toBe(false);
    expect(isMapCanvasUnpoweredZoneBlinkPhase(499)).toBe(false);
    expect(isMapCanvasUnpoweredZoneBlinkPhase(500)).toBe(true);
    expect(isMapCanvasUnpoweredZoneBlinkPhase(999)).toBe(true);
    expect(isMapCanvasUnpoweredZoneBlinkPhase(1000)).toBe(false);
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
    // `DrawObjects` in `w_sprite.c` uses `(frame - 1)`, so TRA frame `2` draws `obj1-1`.
    expect(projected.spriteFrameUrl).toContain('obj1-1');
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
        spriteFrameUrlToken: overlay.spriteFrameUrl?.match(/obj\d+-\d+/)?.[0],
        left: overlay.left,
        top: overlay.top,
        width: overlay.width,
        height: overlay.height,
      })),
    ).toEqual([
      // `InitSprite` in `w_sprite.c` sets TRA to width/height=32 and x/y offsets 32/-16.
      {
        name: 'train',
        label: 'TRN',
        spriteFrameUrlToken: 'obj1-0',
        left: 160,
        top: 112,
        width: 32,
        height: 32,
      },
      // `InitSprite` in `w_sprite.c` sets COP to width/height=32 and x/y offsets 32/-16.
      {
        name: 'copter',
        label: 'COP',
        spriteFrameUrlToken: 'obj2-0',
        left: 160,
        top: 112,
        width: 32,
        height: 32,
      },
      // `InitSprite` in `w_sprite.c` sets AIR to width/height=48 and x/y offsets 24/0.
      {
        name: 'plane',
        label: 'AIR',
        spriteFrameUrlToken: 'obj3-0',
        left: 152,
        top: 128,
        width: 48,
        height: 48,
      },
      // `InitSprite` in `w_sprite.c` sets SHI to width/height=48 and x/y offsets 32/-16.
      {
        name: 'ship',
        label: 'SHP',
        spriteFrameUrlToken: 'obj4-0',
        left: 160,
        top: 112,
        width: 48,
        height: 48,
      },
      // `InitSprite` in `w_sprite.c` sets GOD to width/height=48 and x/y offsets 24/0.
      {
        name: 'monster',
        label: 'MON',
        spriteFrameUrlToken: 'obj5-0',
        left: 152,
        top: 128,
        width: 48,
        height: 48,
      },
      // `InitSprite` in `w_sprite.c` sets TOR to width/height=48 and x/y offsets 24/0.
      {
        name: 'tornado',
        label: 'TOR',
        spriteFrameUrlToken: 'obj6-0',
        left: 152,
        top: 128,
        width: 48,
        height: 48,
      },
      // `InitSprite` in `w_sprite.c` sets EXP to width/height=48 and x/y offsets 24/0.
      {
        name: 'explosion',
        label: 'EXP',
        spriteFrameUrlToken: 'obj7-0',
        left: 152,
        top: 128,
        width: 48,
        height: 48,
      },
    ]);
  });

  it('keeps realtime overlay projection deterministic across payload order changes', () => {
    const forward = projectRealtimeOverlaySprites({
      objects: [
        // Bridge realtime ids map to stable in-process sprite identities from
        // `w_sprite.c`; Realtime Overlay sorts by id for deterministic replay ordering.
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

describe('map canvas pan parity', () => {
  it('matches MapCmdPanTo 16/3 map-to-world pan scaling with truncation toward zero', () => {
    // `MapCmdPanTo` in `w_map.c` applies `dx = dx * 16 / 3` using C integer math.
    expect(scaleMapPanDeltaToWorldPixels(3)).toBe(16);
    expect(scaleMapPanDeltaToWorldPixels(2)).toBe(10);
    expect(scaleMapPanDeltaToWorldPixels(-3)).toBe(-16);
    expect(scaleMapPanDeltaToWorldPixels(-2)).toBe(-10);
  });

  it('converts Micropolis world-pixel pan deltas into Authoritative Runtime canvas pixels', () => {
    // Micropolis editor panning uses 16 world pixels per tile (`w_x.c`); with
    // Authoritative Runtime `tileSize=6`, one full Micropolis tile pan becomes 6 canvas pixels.
    expect(scaleWorldPanDeltaToCanvasPixels(16, 6)).toBe(6);
    expect(scaleWorldPanDeltaToCanvasPixels(10, 6)).toBe(3);
    expect(scaleWorldPanDeltaToCanvasPixels(-16, 6)).toBe(-6);
  });

  it('keeps drag pan deltas aligned with MapCmdPanStart and MapCmdPanTo sampling', () => {
    const dragStart = startMapCanvasPanDrag(40, 50);
    const dragStep = continueMapCanvasPanDrag({
      dragState: dragStart,
      x: 43,
      y: 47,
      tileSize: 6,
    });

    // C path: `dx=3 -> 3*16/3=16`, `dy=-3 -> -3*16/3=-16` in `w_map.c`.
    expect(dragStep.deltaCanvasX).toBe(6);
    expect(dragStep.deltaCanvasY).toBe(-6);
    expect(dragStep.nextDragState).toEqual({
      lastX: 43,
      lastY: 47,
    });
  });

  it('returns zero deltas when pointer sample does not move', () => {
    const dragStep = continueMapCanvasPanDrag({
      dragState: startMapCanvasPanDrag(12, 20),
      x: 12,
      y: 20,
      tileSize: 6,
    });

    expect(dragStep.deltaCanvasX).toBe(0);
    expect(dragStep.deltaCanvasY).toBe(0);
  });
});

describe('map canvas tool drag parity', () => {
  it('fills intermediate cardinal tiles for single-tile drag strokes', () => {
    expect(
      traceMapCanvasSingleTileToolDragPath({
        fromX: 10,
        fromY: 10,
        toX: 13,
        toY: 10,
      }),
    ).toEqual([
      { x: 11, y: 10 },
      { x: 12, y: 10 },
      { x: 13, y: 10 },
    ]);
  });

  it('adds the corner-fill tile on diagonal movement like classic ToolDrag', () => {
    // Magic-number source: `step = .3 / max(adx, ady)` and corner-fill branch
    // in `ToolDrag` (`dist == 1`) from `ref/micropolis/src/sim/w_tool.c`.
    expect(
      traceMapCanvasSingleTileToolDragPath({
        fromX: 10,
        fromY: 10,
        toX: 11,
        toY: 11,
      }),
    ).toEqual([
      { x: 10, y: 11 },
      { x: 11, y: 11 },
    ]);
  });

  it('preserves C truncation-toward-zero semantics for negative deltas', () => {
    expect(
      traceMapCanvasSingleTileToolDragPath({
        fromX: 11,
        fromY: 11,
        toX: 10,
        toY: 10,
      }),
    ).toEqual([
      { x: 11, y: 10 },
      { x: 10, y: 10 },
    ]);
  });

  it('returns no samples when drag does not cross into another tile', () => {
    expect(
      traceMapCanvasSingleTileToolDragPath({
        fromX: 8,
        fromY: 5,
        toX: 8,
        toY: 5,
      }),
    ).toEqual([]);
  });
});

describe('map canvas camera metrics', () => {
  it('applies zoom scaling before viewport clipping and pan-bounds resolution', () => {
    const metrics = getMapCanvasCameraMetrics({
      mapWidth: 120,
      mapHeight: 100,
      tileSize: 6,
      zoom: 2,
    });

    expect(metrics.mapWidthPx).toBe(720);
    expect(metrics.mapHeightPx).toBe(600);
    expect(metrics.scaledMapWidthPx).toBe(1440);
    expect(metrics.scaledMapHeightPx).toBe(1200);
    expect(metrics.viewportWidthPx).toBe(640);
    expect(metrics.viewportHeightPx).toBe(480);
    expect(metrics.maxCameraOffsetX).toBe(800);
    expect(metrics.maxCameraOffsetY).toBe(720);
  });

  it('keeps pan bounds at zero when scaled map already fits viewport', () => {
    const metrics = getMapCanvasCameraMetrics({
      mapWidth: 40,
      mapHeight: 30,
      tileSize: 4,
      zoom: 0.5,
    });

    expect(metrics.maxCameraOffsetX).toBe(0);
    expect(metrics.maxCameraOffsetY).toBe(0);
  });

  it('clips viewport using runtime container bounds when provided', () => {
    const metrics = getMapCanvasCameraMetrics({
      mapWidth: 120,
      mapHeight: 100,
      tileSize: 16,
      zoom: 1,
      viewportMaxWidthPx: 1024,
      viewportMaxHeightPx: 720,
    });

    expect(metrics.viewportWidthPx).toBe(1024);
    expect(metrics.viewportHeightPx).toBe(720);
    expect(metrics.maxCameraOffsetX).toBe(896);
    expect(metrics.maxCameraOffsetY).toBe(880);
  });
});

describe('map canvas wheel and zoom controls', () => {
  it('normalizes wheel deltas from line/page modes into pixel units', () => {
    expect(
      normalizeMapCanvasWheelDeltaToPixels({
        deltaX: 2,
        deltaY: -3,
        deltaMode: 0,
        viewportWidthPx: 640,
        viewportHeightPx: 480,
      }),
    ).toEqual({
      deltaX: 2,
      deltaY: -3,
    });
    expect(
      normalizeMapCanvasWheelDeltaToPixels({
        deltaX: 2,
        deltaY: -3,
        deltaMode: 1,
        viewportWidthPx: 640,
        viewportHeightPx: 480,
      }),
    ).toEqual({
      deltaX: 32,
      deltaY: -48,
    });
    expect(
      normalizeMapCanvasWheelDeltaToPixels({
        deltaX: 1,
        deltaY: -1,
        deltaMode: 2,
        viewportWidthPx: 640,
        viewportHeightPx: 480,
      }),
    ).toEqual({
      deltaX: 640,
      deltaY: -480,
    });
  });

  it('uses ctrl/meta wheel gestures as zoom input', () => {
    expect(
      isMapCanvasZoomWheelGesture({
        ctrlKey: true,
        metaKey: false,
      }),
    ).toBe(true);
    expect(
      isMapCanvasZoomWheelGesture({
        ctrlKey: false,
        metaKey: true,
      }),
    ).toBe(true);
    expect(
      isMapCanvasZoomWheelGesture({
        ctrlKey: false,
        metaKey: false,
      }),
    ).toBe(false);
  });

  it('grows and shrinks zoom from wheel delta while clamping supported bounds', () => {
    const zoomedIn = computeMapCanvasZoomFromWheel({
      currentZoom: 1,
      wheelDeltaYPx: -120,
    });
    const zoomedOut = computeMapCanvasZoomFromWheel({
      currentZoom: 1,
      wheelDeltaYPx: 120,
    });
    expect(zoomedIn).toBeGreaterThan(1);
    expect(zoomedOut).toBeLessThan(1);

    expect(
      computeMapCanvasZoomFromWheel({
        currentZoom: 3.9,
        wheelDeltaYPx: -1000,
      }),
    ).toBe(4);
    expect(
      computeMapCanvasZoomFromWheel({
        currentZoom: 0.3,
        wheelDeltaYPx: 1000,
      }),
    ).toBe(0.2);
  });

  it('keeps the same map point under the zoom anchor during zoom transitions', () => {
    // Browser-only zoom divergence: C map controls in `w_map.c` are pan-only.
    expect(
      zoomMapCanvasCameraOffsetAtAnchor({
        currentOffset: { x: 100, y: 50 },
        anchor: { x: 200, y: 100 },
        currentZoom: 1,
        nextZoom: 2,
      }),
    ).toEqual({
      x: 400,
      y: 200,
    });
    expect(
      zoomMapCanvasCameraOffsetAtAnchor({
        currentOffset: { x: 123, y: 456 },
        anchor: { x: 320, y: 240 },
        currentZoom: 1.5,
        nextZoom: 1.5,
      }),
    ).toEqual({
      x: 123,
      y: 456,
    });
  });
});

describe('map canvas snapshot/patch visual parity', () => {
  it('keeps final tile visuals identical between snapshot redraw and dirty-rect patch redraw', () => {
    const width = 4;
    const height = 3;
    const beforeTiles = Uint16Array.from([
      Tile.DIRT,
      Tile.RIVER,
      Tile.ROADBASE,
      Tile.POWERBASE,
      Tile.RAILBASE,
      Tile.RESBASE,
      Tile.COMBASE,
      Tile.INDBASE,
      Tile.TREEBASE,
      Tile.FIREBASE,
      Tile.HBRDG0,
      Tile.VBRDG3,
    ]);
    const afterTiles = beforeTiles.slice();
    afterTiles[toRuntimeTileIndex(0, 0, width)] = Tile.ROADBASE + 1;
    afterTiles[toRuntimeTileIndex(2, 1, width)] = Tile.FIREBASE + 2 + TileFlag.ANIMBIT;
    afterTiles[toRuntimeTileIndex(3, 2, width)] = Tile.LIGHTNINGBOLT + TileFlag.ZONEBIT;

    const dirtyRects = [
      { x: -1, y: -1, width: 2, height: 2 },
      { x: 2, y: 1, width: 2, height: 2 },
    ] as const;
    const snapshotVisuals = Array.from(afterTiles, (tileWord) => toTileVisualToken(tileWord));
    const patchVisuals = applyPatchTileVisualTokens({
      beforeTiles,
      afterTiles,
      width,
      height,
      dirtyRects,
      dirtyTileIndexes: new Uint32Array(0),
    });

    expect(patchVisuals).toEqual(snapshotVisuals);
  });

  it('keeps final tile visuals identical between snapshot redraw and dirty-index patch redraw', () => {
    const width = 3;
    const height = 2;
    const beforeTiles = Uint16Array.from([
      Tile.DIRT,
      Tile.ROADBASE,
      Tile.POWERBASE,
      Tile.RAILBASE,
      Tile.RESBASE,
      Tile.COMBASE,
    ]);
    const afterTiles = beforeTiles.slice();
    afterTiles[1] = Tile.ROADBASE + 7 + TileFlag.BULLBIT;
    afterTiles[4] = Tile.RESBASE + 3;

    const snapshotVisuals = Array.from(afterTiles, (tileWord) => toTileVisualToken(tileWord));
    const patchVisuals = applyPatchTileVisualTokens({
      beforeTiles,
      afterTiles,
      width,
      height,
      dirtyRects: [],
      dirtyTileIndexes: Uint32Array.from([1, 4]),
    });

    expect(patchVisuals).toEqual(snapshotVisuals);
  });
});

describe('map canvas patch index iteration', () => {
  it('unions dirty rect and dirty index coverage without duplicate tile visits', () => {
    const visited: number[] = [];
    forEachMapCanvasPatchTileIndex(
      {
        // Runtime patch redraw uses row-major indexing (`y * width + x`) from
        // `apps/web/src/game/runtime/map-state.ts` snapshot/patch projection.
        width: 4,
        height: 3,
        // Rects intentionally overlap at index 6 to assert de-dup behavior.
        dirtyRects: [
          { x: 1, y: 0, width: 2, height: 2 },
          { x: 2, y: 1, width: 2, height: 2 },
        ],
        // Includes one out-of-bounds slot (`99`) and two already-covered tiles.
        dirtyTileIndexes: Uint32Array.from([0, 5, 11, 99]),
      },
      (tileIndex) => {
        visited.push(tileIndex);
      },
    );

    expect(visited).toEqual([1, 2, 5, 6, 7, 10, 11, 0]);
    expect(new Set(visited).size).toBe(visited.length);
  });
});

describe('map canvas tile render mode selection', () => {
  it('uses Micropolis sprite atlas when atlas image exists', () => {
    expect(
      selectMapCanvasTileRenderMode({
        hasAtlasImage: true,
      }),
    ).toBe('atlas');
  });

  it('uses missing-atlas fallback when atlas image is unavailable', () => {
    expect(
      selectMapCanvasTileRenderMode({
        hasAtlasImage: false,
      }),
    ).toBe('missing-atlas');
  });
});

describe('map canvas tool footprint projection', () => {
  it('matches Micropolis toolSize/toolOffset anchoring for tool cursor footprints', () => {
    // Magic-number source: `toolSize[]` and `toolOffset[]` in
    // `ref/micropolis/src/sim/w_tool.c`, applied in `DrawCursor` default branch
    // (`x = (x & ~15) - (offset << 4)`, `size <<= 4`) in `w_editor.c`.
    expect(
      projectMapCanvasToolFootprintRect({
        tileX: 30,
        tileY: 22,
        size: 3,
        offset: 1,
        tileSize: 4,
      }),
    ).toEqual({
      left: 116,
      top: 84,
      side: 12,
    });
  });
});

describe('map canvas layer ordering', () => {
  it('keeps map, pending tool, realtime overlays, and tool cursor in Micropolis draw order', () => {
    // `DoUpdateEditor` in `w_editor.c` draws map first, then pending tool preview,
    // then realtime objects (`DrawObjects`), then tool cursor (`DrawCursor`) on top.
    expect(getMapCanvasLayerZIndex('map')).toBeLessThan(getMapCanvasLayerZIndex('pending-tool'));
    expect(getMapCanvasLayerZIndex('pending-tool')).toBeLessThan(
      getMapCanvasLayerZIndex('realtime-overlay'),
    );
    expect(getMapCanvasLayerZIndex('realtime-overlay')).toBeLessThan(
      getMapCanvasLayerZIndex('tool-cursor'),
    );
  });
});
