import {
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import type { CanonicalImageIdentityKey } from '../../../../../packages/sim-assets/src/derived-images.ts';
import { getPlayableToolSpec, type PendingToolCommandVisual } from '../runtime/index.ts';
import { coalesceQueuedRuntimeMapState, type RuntimeMapState } from '../runtime/map-state.ts';
import type { RuntimeRealtimeObject } from '../runtime/realtime-state.ts';
import { lookupObjectSpriteFrame } from './object-sprite-atlas.ts';
import {
  DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
  getTileAtlasSourceByCanonicalIdentityKey,
  lookupTileSprite,
  resolveMicropolisTileSheetCanonicalIdentityKey,
} from './tile-sprite-atlas.ts';

const EDITOR_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY =
  resolveMicropolisTileSheetCanonicalIdentityKey({
    viewClass: 'editor',
    color: true,
  }) ?? DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY;
const MAP_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY =
  resolveMicropolisTileSheetCanonicalIdentityKey({
    viewClass: 'map',
    color: true,
  }) ?? DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY;
const MAP_CANVAS_EDITOR_ART_MIN_TILE_SIZE = 8;

const DEFAULT_MAP_CANVAS_VIEWPORT_WIDTH_PX = 640;
const DEFAULT_MAP_CANVAS_VIEWPORT_HEIGHT_PX = 480;
const MICROPOLIS_EDITOR_WORLD_PIXELS_PER_TILE = 16;
const MICROPOLIS_MAP_PAN_SCALE_NUMERATOR = 16;
const MICROPOLIS_MAP_PAN_SCALE_DENOMINATOR = 3;
const MAP_CANVAS_MIN_ZOOM = 0.2;
const MAP_CANVAS_MAX_ZOOM = 4;
const MAP_CANVAS_BUTTON_ZOOM_STEP = 1.25;
const MAP_CANVAS_WHEEL_ZOOM_SENSITIVITY = 0.0015;
const MAP_CANVAS_WHEEL_LINE_DELTA_PX = 16;

/**
 * Pointer-anchor state for one active drag-pan gesture.
 * Mirrors `MapCmdPanStart` in `ref/micropolis/src/sim/w_map.c`, where map drag
 * tracking stores the previous map-space pointer sample (`last_x`, `last_y`).
 */
export interface MapCanvasPanDragState {
  readonly lastX: number;
  readonly lastY: number;
}

/**
 * Chooses the base map tile atlas identity for one runtime tile-size mode.
 * Mirrors `GetViewTiles` atlas identities in `ref/micropolis/src/sim/g_setup.c`:
 * `Editor_Class` (`tiles.xpm`) and `Map_Class` color (`tilessm.xpm`).
 * Parity note: C selects view class per widget; TypeScript selects map-class
 * art for compact square tiles to avoid severe downscale aliasing artifacts
 * from 16x16 editor rails rendered at small runtime tile sizes.
 */
export function selectMapCanvasBaseTileAtlasCanonicalIdentityKey(
  tileSize: number,
): CanonicalImageIdentityKey {
  return tileSize >= MAP_CANVAS_EDITOR_ART_MIN_TILE_SIZE
    ? EDITOR_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY
    : MAP_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY;
}

/**
 * Start one map-drag pan interaction.
 * Mirrors `MapCmdPanStart` pointer tracking setup in
 * `ref/micropolis/src/sim/w_map.c`.
 */
export function startMapCanvasPanDrag(x: number, y: number): MapCanvasPanDragState {
  return {
    lastX: x,
    lastY: y,
  };
}

/**
 * Convert map-view drag delta into Micropolis editor-world pan pixels.
 * Mirrors `MapCmdPanTo` in `ref/micropolis/src/sim/w_map.c` (`dx = dx * 16 / 3`)
 * using truncation-toward-zero integer semantics from C.
 */
export function scaleMapPanDeltaToWorldPixels(deltaMapPixels: number): number {
  return truncateTowardZero(
    (deltaMapPixels * MICROPOLIS_MAP_PAN_SCALE_NUMERATOR) / MICROPOLIS_MAP_PAN_SCALE_DENOMINATOR,
  );
}

/**
 * Convert Micropolis editor-world pan pixels into rendered canvas pixels.
 * Mirrors world-pixel panning in `DoPanBy`/`DoPanTo` from
 * `ref/micropolis/src/sim/w_x.c`, adapted to Authoritative Runtime tile-size scaling.
 */
export function scaleWorldPanDeltaToCanvasPixels(
  worldPixelDelta: number,
  tileSize: number,
): number {
  return truncateTowardZero((worldPixelDelta * tileSize) / MICROPOLIS_EDITOR_WORLD_PIXELS_PER_TILE);
}

/**
 * Resolve one drag-pan step into canvas-space camera deltas.
 * Mirrors `MapCmdPanTo` in `ref/micropolis/src/sim/w_map.c`: compute `dx/dy`
 * from the previous pointer sample, scale by `16/3`, then apply `DoPanBy`.
 * Parity note: Authoritative Runtime converts the resulting world-pixel deltas to canvas
 * pixels so browser camera movement tracks Micropolis pan ratios.
 */
export function continueMapCanvasPanDrag({
  dragState,
  x,
  y,
  tileSize,
}: {
  dragState: MapCanvasPanDragState;
  x: number;
  y: number;
  tileSize: number;
}): {
  nextDragState: MapCanvasPanDragState;
  deltaCanvasX: number;
  deltaCanvasY: number;
} {
  const deltaMapX = x - dragState.lastX;
  const deltaMapY = y - dragState.lastY;
  const deltaWorldX = scaleMapPanDeltaToWorldPixels(deltaMapX);
  const deltaWorldY = scaleMapPanDeltaToWorldPixels(deltaMapY);

  return {
    nextDragState: {
      lastX: x,
      lastY: y,
    },
    deltaCanvasX: scaleWorldPanDeltaToCanvasPixels(deltaWorldX, tileSize),
    deltaCanvasY: scaleWorldPanDeltaToCanvasPixels(deltaWorldY, tileSize),
  };
}

/**
 * Camera layout metrics for one map-canvas zoom level.
 * Mirrors Micropolis `DoAdjustPan` viewport-clip ownership in
 * `ref/micropolis/src/sim/w_x.c`.
 * Parity note: Authoritative Runtime keeps C-style bounded pan ownership but extends it with
 * browser zoom scaling for desktop/touchpad controls.
 */
export interface MapCanvasCameraMetrics {
  mapWidthPx: number;
  mapHeightPx: number;
  scaledMapWidthPx: number;
  scaledMapHeightPx: number;
  viewportWidthPx: number;
  viewportHeightPx: number;
  maxCameraOffsetX: number;
  maxCameraOffsetY: number;
}

/**
 * Runtime viewport bounds applied to map camera clipping.
 * Mirrors Micropolis `DoAdjustPan` clip-window ownership in `ref/micropolis/src/sim/w_x.c`.
 * Difference: browser host layout can resize continuously, so Authoritative Runtime
 * accepts dynamic viewport bounds from a measured DOM container.
 */
export interface MapCanvasViewportBounds {
  viewportMaxWidthPx: number;
  viewportMaxHeightPx: number;
}

/**
 * Compute map viewport and pan bounds for one zoom level.
 * Mirrors `DoAdjustPan`-style viewport clipping in `ref/micropolis/src/sim/w_x.c`.
 * Difference: Authoritative Runtime applies browser scale (`zoom`) before viewport clipping.
 */
export function getMapCanvasCameraMetrics({
  mapWidth,
  mapHeight,
  tileSize,
  zoom,
  viewportMaxWidthPx = DEFAULT_MAP_CANVAS_VIEWPORT_WIDTH_PX,
  viewportMaxHeightPx = DEFAULT_MAP_CANVAS_VIEWPORT_HEIGHT_PX,
}: {
  mapWidth: number;
  mapHeight: number;
  tileSize: number;
  zoom: number;
  viewportMaxWidthPx?: number;
  viewportMaxHeightPx?: number;
}): MapCanvasCameraMetrics {
  const mapWidthPx = mapWidth * tileSize;
  const mapHeightPx = mapHeight * tileSize;
  const scaledMapWidthPx = mapWidthPx * zoom;
  const scaledMapHeightPx = mapHeightPx * zoom;
  const viewportWidthPx = Math.min(scaledMapWidthPx, Math.max(1, viewportMaxWidthPx));
  const viewportHeightPx = Math.min(scaledMapHeightPx, Math.max(1, viewportMaxHeightPx));
  return {
    mapWidthPx,
    mapHeightPx,
    scaledMapWidthPx,
    scaledMapHeightPx,
    viewportWidthPx,
    viewportHeightPx,
    maxCameraOffsetX: Math.max(0, scaledMapWidthPx - viewportWidthPx),
    maxCameraOffsetY: Math.max(0, scaledMapHeightPx - viewportHeightPx),
  };
}

/**
 * Normalize browser wheel deltas into pixel units.
 * Mirrors Micropolis map input using pixel-space pan deltas (`dx`, `dy`) in
 * `MapCmdPanTo` from `ref/micropolis/src/sim/w_map.c`.
 * Difference: browser wheel events may be in line/page units, so Authoritative Runtime
 * explicitly converts those units to pixels before camera updates.
 */
export function normalizeMapCanvasWheelDeltaToPixels({
  deltaX,
  deltaY,
  deltaMode,
  viewportWidthPx,
  viewportHeightPx,
}: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  viewportWidthPx: number;
  viewportHeightPx: number;
}): {
  deltaX: number;
  deltaY: number;
} {
  if (deltaMode === 1) {
    return {
      deltaX: deltaX * MAP_CANVAS_WHEEL_LINE_DELTA_PX,
      deltaY: deltaY * MAP_CANVAS_WHEEL_LINE_DELTA_PX,
    };
  }
  if (deltaMode === 2) {
    return {
      deltaX: deltaX * viewportWidthPx,
      deltaY: deltaY * viewportHeightPx,
    };
  }
  return {
    deltaX,
    deltaY,
  };
}

/**
 * Detect whether one wheel gesture should control zoom.
 * Micropolis C map input (`w_map.c`) has pan-only pointer gestures.
 * Difference: Authoritative Runtime treats `ctrl`/`meta` wheel gestures as browser zoom so
 * laptop touchpad pinch and desktop modifier-wheel zoom are supported.
 */
export function isMapCanvasZoomWheelGesture({
  ctrlKey,
  metaKey,
}: {
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return ctrlKey || metaKey;
}

/**
 * Resolve next camera zoom from one wheel gesture sample.
 * Micropolis C has no map zoom mode in `w_map.c`/`w_x.c`.
 * Difference: Authoritative Runtime adds clamped exponential zoom steps for browser wheel and
 * touchpad pinch input while preserving bounded camera offsets.
 */
export function computeMapCanvasZoomFromWheel({
  currentZoom,
  wheelDeltaYPx,
}: {
  currentZoom: number;
  wheelDeltaYPx: number;
}): number {
  const zoomFactor = Math.exp(-wheelDeltaYPx * MAP_CANVAS_WHEEL_ZOOM_SENSITIVITY);
  return clampMapCanvasZoom(currentZoom * zoomFactor);
}

/**
 * Re-anchor camera offset when zoom level changes.
 * Micropolis `DoPanTo` in `ref/micropolis/src/sim/w_x.c` keeps pan in bounds.
 * Difference: Authoritative Runtime keeps the same map point under the wheel/pinch anchor
 * during browser zoom, then applies C-style bounds clamping.
 */
export function zoomMapCanvasCameraOffsetAtAnchor({
  currentOffset,
  anchor,
  currentZoom,
  nextZoom,
}: {
  currentOffset: Readonly<{ x: number; y: number }>;
  anchor: Readonly<{ x: number; y: number }>;
  currentZoom: number;
  nextZoom: number;
}): {
  x: number;
  y: number;
} {
  if (currentZoom === nextZoom) {
    return {
      x: currentOffset.x,
      y: currentOffset.y,
    };
  }

  const zoomRatio = nextZoom / currentZoom;
  return {
    x: (currentOffset.x + anchor.x) * zoomRatio - anchor.x,
    y: (currentOffset.y + anchor.y) * zoomRatio - anchor.y,
  };
}

/**
 * Canvas renderer for authoritative Authoritative Runtime map snapshots and tile patches.
 * Mirrors full-map redraw vs incremental redraw ownership from
 * `ref/micropolis/src/sim/w_map.c` and tile-word lookup intent from
 * `ref/micropolis/src/sim/g_bigmap.c`.
 * Parity note: Sprite Atlas uses Micropolis-derived tile sprites from canonical
 * `tiles.xpm` identity and treats missing atlas images as explicit fallback.
 * Difference: browser-only pan/zoom controls can render either in-map (default)
 * or in an external UI container supplied by the route.
 */
export function MapCanvas({
  mapState,
  pendingTools = [],
  realtimeObjects = [],
  onTileClick,
  tileSize = 4,
  cameraControlsContainer,
}: {
  mapState: RuntimeMapState;
  pendingTools?: readonly PendingToolCommandVisual[];
  realtimeObjects?: readonly RuntimeRealtimeObject[];
  onTileClick?: (x: number, y: number) => void;
  tileSize?: number;
  cameraControlsContainer?: HTMLElement | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapCanvasRootRef = useRef<HTMLDivElement>(null);
  const tileAtlasImagesByCanonicalIdentityKeyRef = useRef<
    ReadonlyMap<CanonicalImageIdentityKey, HTMLImageElement>
  >(new Map());
  const queuedMapFrameRef = useRef<MapCanvasRenderFrame | null>(null);
  const pendingAnimationFrameRef = useRef<number | null>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const panDragStateRef = useRef<MapCanvasPanDragState | null>(null);
  const lastRenderedEpochRef = useRef(0);
  const [tileAtlasRenderVersion, setTileAtlasRenderVersion] = useState(0);
  const [cameraZoom, setCameraZoom] = useState(1);
  const [cameraOffsetPx, setCameraOffsetPx] = useState<{
    x: number;
    y: number;
  }>({
    x: 0,
    y: 0,
  });
  const [viewportBounds, setViewportBounds] = useState<MapCanvasViewportBounds>({
    viewportMaxWidthPx: DEFAULT_MAP_CANVAS_VIEWPORT_WIDTH_PX,
    viewportMaxHeightPx: DEFAULT_MAP_CANVAS_VIEWPORT_HEIGHT_PX,
  });
  const baseTileAtlasCanonicalIdentityKey = useMemo(
    () => selectMapCanvasBaseTileAtlasCanonicalIdentityKey(tileSize),
    [tileSize],
  );

  useEffect(() => {
    const atlas = getTileAtlasSourceByCanonicalIdentityKey(baseTileAtlasCanonicalIdentityKey);
    if (atlas === undefined) {
      tileAtlasImagesByCanonicalIdentityKeyRef.current = new Map();
      lastRenderedEpochRef.current = 0;
      return;
    }

    const image = new Image();
    let cancelled = false;

    image.onload = () => {
      if (cancelled) {
        return;
      }
      tileAtlasImagesByCanonicalIdentityKeyRef.current = new Map([
        [atlas.canonicalIdentityKey, image],
      ]);
      // Force one full redraw when atlas identity changes.
      lastRenderedEpochRef.current = 0;
      setTileAtlasRenderVersion((version) => version + 1);
    };

    image.onerror = () => {
      if (cancelled) {
        return;
      }
      tileAtlasImagesByCanonicalIdentityKeyRef.current = new Map();
      lastRenderedEpochRef.current = 0;
      setTileAtlasRenderVersion((version) => version + 1);
    };

    image.src = atlas.spriteSheetUrl;
    return () => {
      cancelled = true;
    };
  }, [baseTileAtlasCanonicalIdentityKey]);

  useEffect(() => {
    if (!mapState.hasSnapshot) {
      queuedMapFrameRef.current = null;
      if (pendingAnimationFrameRef.current !== null) {
        cancelAnimationFrame(pendingAnimationFrameRef.current);
        pendingAnimationFrameRef.current = null;
      }
      lastRenderedEpochRef.current = 0;
      return;
    }

    const nextFrame: MapCanvasRenderFrame = {
      mapState,
      tileSize,
      tileRenderer: {
        baseTileAtlasCanonicalIdentityKey,
        tileAtlasImagesByCanonicalIdentityKey: tileAtlasImagesByCanonicalIdentityKeyRef.current,
      },
    };
    const queuedFrame = queuedMapFrameRef.current;
    queuedMapFrameRef.current =
      queuedFrame === null
        ? nextFrame
        : {
            ...nextFrame,
            mapState: coalesceQueuedRuntimeMapState(queuedFrame.mapState, nextFrame.mapState),
          };

    if (pendingAnimationFrameRef.current !== null) {
      return;
    }

    pendingAnimationFrameRef.current = requestAnimationFrame(() => {
      pendingAnimationFrameRef.current = null;
      const frame = consumeQueuedMapCanvasFrame(queuedMapFrameRef);
      if (frame === null) {
        return;
      }
      lastRenderedEpochRef.current = drawMapCanvasFrame({
        canvas: canvasRef.current,
        frame,
        lastRenderedEpoch: lastRenderedEpochRef.current,
      });
    });
  }, [baseTileAtlasCanonicalIdentityKey, mapState, tileAtlasRenderVersion, tileSize]);

  useEffect(() => {
    return () => {
      if (pendingAnimationFrameRef.current !== null) {
        cancelAnimationFrame(pendingAnimationFrameRef.current);
        pendingAnimationFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const rootElement = mapCanvasRootRef.current;
    if (rootElement === null) {
      return;
    }

    const updateViewportBounds = (): void => {
      const rect = rootElement.getBoundingClientRect();
      const nextBounds: MapCanvasViewportBounds = {
        viewportMaxWidthPx: Math.max(1, Math.floor(rect.width)),
        viewportMaxHeightPx: Math.max(1, Math.floor(rect.height)),
      };
      setViewportBounds((currentBounds) => {
        if (
          currentBounds.viewportMaxWidthPx === nextBounds.viewportMaxWidthPx &&
          currentBounds.viewportMaxHeightPx === nextBounds.viewportMaxHeightPx
        ) {
          return currentBounds;
        }
        return nextBounds;
      });
    };

    updateViewportBounds();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportBounds);
      return () => {
        window.removeEventListener('resize', updateViewportBounds);
      };
    }

    const observer = new ResizeObserver(() => {
      updateViewportBounds();
    });
    observer.observe(rootElement);
    return () => {
      observer.disconnect();
    };
  }, []);

  const cameraMetrics = getMapCanvasCameraMetrics({
    mapWidth: mapState.width,
    mapHeight: mapState.height,
    tileSize,
    zoom: cameraZoom,
    viewportMaxWidthPx: viewportBounds.viewportMaxWidthPx,
    viewportMaxHeightPx: viewportBounds.viewportMaxHeightPx,
  });
  const widthPx = cameraMetrics.mapWidthPx;
  const heightPx = cameraMetrics.mapHeightPx;
  const viewportWidthPx = cameraMetrics.viewportWidthPx;
  const viewportHeightPx = cameraMetrics.viewportHeightPx;
  const maxCameraOffsetX = cameraMetrics.maxCameraOffsetX;
  const maxCameraOffsetY = cameraMetrics.maxCameraOffsetY;
  const clampedCameraOffsetPx = clampMapCanvasCameraOffset(
    cameraOffsetPx,
    maxCameraOffsetX,
    maxCameraOffsetY,
  );
  const realtimeOverlaySprites = useMemo(
    () =>
      projectRealtimeOverlaySprites({
        objects: realtimeObjects,
        tileSize,
        mapWidth: mapState.width,
        mapHeight: mapState.height,
      }),
    [mapState.height, mapState.width, realtimeObjects, tileSize],
  );

  const applyCameraPanBy = useCallback(
    (deltaX: number, deltaY: number): void => {
      if (deltaX === 0 && deltaY === 0) {
        return;
      }

      setCameraOffsetPx((currentOffset) => {
        const clampedCurrentOffset = clampMapCanvasCameraOffset(
          currentOffset,
          maxCameraOffsetX,
          maxCameraOffsetY,
        );

        return clampMapCanvasCameraOffset(
          {
            x: clampedCurrentOffset.x + deltaX,
            y: clampedCurrentOffset.y + deltaY,
          },
          maxCameraOffsetX,
          maxCameraOffsetY,
        );
      });
    },
    [maxCameraOffsetX, maxCameraOffsetY],
  );

  /**
   * Apply one anchored browser zoom update and keep camera offsets bounded.
   * Mirrors C pan-bound ownership in `DoPanTo` from `ref/micropolis/src/sim/w_x.c`.
   * Difference: Authoritative Runtime re-anchors offset at a wheel/pinch point during zoom.
   */
  const applyCameraZoomAt = useCallback(
    (nextZoom: number, anchor: { x: number; y: number }): void => {
      setCameraZoom((currentZoom) => {
        const clampedNextZoom = clampMapCanvasZoom(nextZoom);
        if (clampedNextZoom === currentZoom) {
          return currentZoom;
        }

        const currentMetrics = getMapCanvasCameraMetrics({
          mapWidth: mapState.width,
          mapHeight: mapState.height,
          tileSize,
          zoom: currentZoom,
          viewportMaxWidthPx: viewportBounds.viewportMaxWidthPx,
          viewportMaxHeightPx: viewportBounds.viewportMaxHeightPx,
        });
        const nextMetrics = getMapCanvasCameraMetrics({
          mapWidth: mapState.width,
          mapHeight: mapState.height,
          tileSize,
          zoom: clampedNextZoom,
          viewportMaxWidthPx: viewportBounds.viewportMaxWidthPx,
          viewportMaxHeightPx: viewportBounds.viewportMaxHeightPx,
        });

        setCameraOffsetPx((currentOffset) => {
          const clampedCurrentOffset = clampMapCanvasCameraOffset(
            currentOffset,
            currentMetrics.maxCameraOffsetX,
            currentMetrics.maxCameraOffsetY,
          );
          const zoomedOffset = zoomMapCanvasCameraOffsetAtAnchor({
            currentOffset: clampedCurrentOffset,
            anchor,
            currentZoom,
            nextZoom: clampedNextZoom,
          });
          return clampMapCanvasCameraOffset(
            zoomedOffset,
            nextMetrics.maxCameraOffsetX,
            nextMetrics.maxCameraOffsetY,
          );
        });

        return clampedNextZoom;
      });
    },
    [
      mapState.height,
      mapState.width,
      tileSize,
      viewportBounds.viewportMaxHeightPx,
      viewportBounds.viewportMaxWidthPx,
    ],
  );

  /**
   * Apply one button-triggered zoom step around the viewport center.
   * Difference from C: Micropolis has no map zoom controls in `w_map.c`.
   */
  const applyCameraZoomStep = (zoomFactor: number): void => {
    applyCameraZoomAt(clampMapCanvasZoom(cameraZoom * zoomFactor), {
      x: viewportWidthPx / 2,
      y: viewportHeightPx / 2,
    });
  };

  useEffect(() => {
    const mapViewport = mapViewportRef.current;
    if (mapViewport === null) {
      return;
    }

    const handleWheel = (event: WheelEvent): void => {
      const delta = normalizeMapCanvasWheelDeltaToPixels({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        viewportWidthPx,
        viewportHeightPx,
      });
      if (delta.deltaX === 0 && delta.deltaY === 0) {
        return;
      }

      const zoomGesture = isMapCanvasZoomWheelGesture({
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      });
      if (zoomGesture) {
        event.preventDefault();
        const anchor = getElementRelativeClientPosition({
          element: mapViewport,
          clientX: event.clientX,
          clientY: event.clientY,
        });
        applyCameraZoomAt(
          computeMapCanvasZoomFromWheel({
            currentZoom: cameraZoom,
            wheelDeltaYPx: delta.deltaY,
          }),
          anchor,
        );
        return;
      }

      if (maxCameraOffsetX <= 0 && maxCameraOffsetY <= 0) {
        return;
      }

      event.preventDefault();
      applyCameraPanBy(delta.deltaX, delta.deltaY);
    };

    mapViewport.addEventListener('wheel', handleWheel, {
      passive: false,
    });
    return () => {
      mapViewport.removeEventListener('wheel', handleWheel);
    };
  }, [
    applyCameraPanBy,
    applyCameraZoomAt,
    cameraZoom,
    maxCameraOffsetX,
    maxCameraOffsetY,
    viewportHeightPx,
    viewportWidthPx,
  ]);

  const hasPannableBounds = maxCameraOffsetX > 0 || maxCameraOffsetY > 0;
  const cameraControlsContent = (
    <>
      <div style={{ display: 'flex', width: '100%', justifyContent: 'center' }}>
        <button
          onClick={() => {
            applyCameraZoomStep(1 / MAP_CANVAS_BUTTON_ZOOM_STEP);
          }}
          type="button"
        >
          -
        </button>
        <button
          onClick={() => {
            applyCameraZoomAt(1, {
              x: viewportWidthPx / 2,
              y: viewportHeightPx / 2,
            });
          }}
          type="button"
        >
          100%
        </button>
        <button
          onClick={() => {
            applyCameraZoomStep(MAP_CANVAS_BUTTON_ZOOM_STEP);
          }}
          type="button"
        >
          +
        </button>
      </div>
    </>
  );

  if (!mapState.hasSnapshot) {
    return (
      <div
        ref={mapCanvasRootRef}
        style={{
          alignItems: 'center',
          background: '#0b1020',
          color: '#e2e8f0',
          display: 'flex',
          fontFamily: 'monospace',
          fontSize: 12,
          height: '100%',
          justifyContent: 'center',
          width: '100%',
        }}
      >
        No map snapshot received yet.
      </div>
    );
  }

  return (
    <div
      ref={mapCanvasRootRef}
      style={{
        background: '#0b1020',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      {cameraControlsContainer === undefined ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>{cameraControlsContent}</div>
      ) : cameraControlsContainer === null ? null : (
        createPortal(
          <div style={{ display: 'flex', flexDirection: 'column' }}>{cameraControlsContent}</div>,
          cameraControlsContainer,
        )
      )}
      <div
        ref={mapViewportRef}
        onPointerCancel={(event) => {
          panDragStateRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerDown={(event) => {
          if (!hasPannableBounds || event.button !== 1) {
            return;
          }

          const point = getElementRelativePointerPosition(event);
          panDragStateRef.current = startMapCanvasPanDrag(point.x, point.y);
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const dragState = panDragStateRef.current;
          if (dragState === null) {
            return;
          }

          const point = getElementRelativePointerPosition(event);
          const dragStep = continueMapCanvasPanDrag({
            dragState,
            x: point.x,
            y: point.y,
            tileSize: tileSize * cameraZoom,
          });
          panDragStateRef.current = dragStep.nextDragState;
          applyCameraPanBy(dragStep.deltaCanvasX, dragStep.deltaCanvasY);
        }}
        onPointerUp={(event) => {
          panDragStateRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        style={{
          border: '1px solid rgba(15, 23, 42, 0.9)',
          left: '50%',
          height: viewportHeightPx,
          overflow: 'hidden',
          position: 'relative',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: viewportWidthPx,
        }}
      >
        <div
          style={{
            height: heightPx,
            left: -clampedCameraOffsetPx.x,
            position: 'absolute',
            top: -clampedCameraOffsetPx.y,
            transform: `scale(${cameraZoom})`,
            transformOrigin: 'top left',
            width: widthPx,
          }}
        >
          <canvas
            ref={canvasRef}
            onClick={(event) => {
              if (onTileClick === undefined) {
                return;
              }

              const canvas = canvasRef.current;
              if (canvas === null) {
                return;
              }

              const tile = getClickedTilePosition(event, canvas, tileSize);
              if (tile === null || !isTileInBounds(tile.x, tile.y, mapState)) {
                return;
              }

              onTileClick(tile.x, tile.y);
            }}
            style={{
              cursor: onTileClick === undefined ? 'default' : 'crosshair',
              display: 'block',
              imageRendering: 'pixelated',
              left: 0,
              position: 'absolute',
              top: 0,
              zIndex: getMapCanvasLayerZIndex('map'),
            }}
          />
          {pendingTools.map((pending) => {
            const spec = getPlayableToolSpec(pending.command.tool);
            const left = (pending.command.x - spec.offset) * tileSize;
            const top = (pending.command.y - spec.offset) * tileSize;
            const side = spec.size * tileSize;

            return (
              <div
                key={pending.commandId}
                style={{
                  background: `${spec.pendingColor}4d`,
                  border: `1px dashed ${spec.pendingColor}`,
                  height: side,
                  left,
                  pointerEvents: 'none',
                  position: 'absolute',
                  top,
                  width: side,
                  zIndex: getMapCanvasLayerZIndex('pending-tool'),
                }}
              />
            );
          })}
          {realtimeOverlaySprites.map((sprite) =>
            sprite.spriteFrameUrl !== undefined ? (
              <img
                alt=""
                aria-hidden="true"
                draggable={false}
                key={sprite.key}
                src={sprite.spriteFrameUrl}
                style={{
                  height: sprite.height,
                  imageRendering: 'pixelated',
                  left: sprite.left,
                  pointerEvents: 'none',
                  position: 'absolute',
                  top: sprite.top,
                  width: sprite.width,
                  zIndex: getMapCanvasLayerZIndex('realtime-overlay'),
                }}
                title={`${sprite.name} frame ${sprite.frame}`}
              />
            ) : (
              <div
                key={sprite.key}
                style={{
                  alignItems: 'center',
                  background: `${sprite.color}59`,
                  border: `1px solid ${sprite.color}`,
                  borderRadius: 3,
                  boxSizing: 'border-box',
                  color: '#0f172a',
                  display: 'flex',
                  fontFamily: 'monospace',
                  fontSize: Math.max(7, Math.min(10, sprite.height * 0.45)),
                  fontWeight: 700,
                  height: sprite.height,
                  justifyContent: 'center',
                  left: sprite.left,
                  lineHeight: 1,
                  pointerEvents: 'none',
                  position: 'absolute',
                  top: sprite.top,
                  width: sprite.width,
                  zIndex: getMapCanvasLayerZIndex('realtime-overlay'),
                }}
                title={`${sprite.name} frame ${sprite.frame}`}
              >
                {sprite.label}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

type MapCanvasDrawProc = (
  context: CanvasRenderingContext2D,
  mapState: RuntimeMapState,
  tileSize: number,
  tileRenderer: MapCanvasTileRenderer,
) => void;

type MapCanvasLayer = 'map' | 'pending-tool' | 'realtime-overlay';

interface MapCanvasTileRenderer {
  baseTileAtlasCanonicalIdentityKey: CanonicalImageIdentityKey;
  tileAtlasImagesByCanonicalIdentityKey: ReadonlyMap<CanonicalImageIdentityKey, HTMLImageElement>;
}

/**
 * Queued authoritative map frame consumed by one browser paint.
 * Mirrors Micropolis map-view ownership where one `DoUpdateMap` pass paints
 * from the latest invalidated map state in `ref/micropolis/src/sim/w_map.c`.
 * Parity note: this payload exists only to coalesce browser paints and does
 * not change authority ordering or map mutation semantics.
 */
interface MapCanvasRenderFrame {
  mapState: RuntimeMapState;
  tileSize: number;
  tileRenderer: MapCanvasTileRenderer;
}

/**
 * Consumes one queued browser map frame and clears the queue slot.
 * Mirrors one `DoUpdateMap` consumption pass in `ref/micropolis/src/sim/w_map.c`,
 * where one invalidated view state is consumed for one paint update.
 * Parity note: queue entries are single-use in Authoritative Runtime; clearing after dequeue
 * prevents stale dirty coverage from being coalesced into later epochs.
 */
export function consumeQueuedMapCanvasFrame<Frame>(queuedFrameRef: {
  current: Frame | null;
}): Frame | null {
  const frame = queuedFrameRef.current;
  queuedFrameRef.current = null;
  return frame;
}

/**
 * Draws one queued map frame using the latest authoritative map state.
 * Mirrors C map-update cadence where `sim_update_maps` may process many sim
 * ticks before a single on-screen `DoUpdateMap` paint (`ref/micropolis/src/sim/sim.c`,
 * `ref/micropolis/src/sim/w_map.c`).
 * Parity note: browser coalescing targets one paint per animation frame while
 * preserving snapshot-vs-patch draw-mode selection from map payload metadata.
 */
function drawMapCanvasFrame({
  canvas,
  frame,
  lastRenderedEpoch,
}: {
  canvas: HTMLCanvasElement | null;
  frame: MapCanvasRenderFrame;
  lastRenderedEpoch: number;
}): number {
  if (canvas === null || !frame.mapState.hasSnapshot) {
    return 0;
  }

  const context = canvas.getContext('2d');
  if (context === null) {
    return lastRenderedEpoch;
  }

  const widthPx = frame.mapState.width * frame.tileSize;
  const heightPx = frame.mapState.height * frame.tileSize;
  let resized = false;
  if (canvas.width !== widthPx) {
    canvas.width = widthPx;
    resized = true;
  }
  if (canvas.height !== heightPx) {
    canvas.height = heightPx;
    resized = true;
  }
  // Canvas width/height writes reset 2D context state, so keep pixel-art sampling
  // disabled after any backing-store resize before tile blits.
  context.imageSmoothingEnabled = false;

  const drawMode = selectMapCanvasDrawMode({
    mapDrawMode: frame.mapState.drawMode,
    renderEpoch: frame.mapState.renderEpoch,
    lastRenderedEpoch,
    resized,
  });
  MAP_CANVAS_DRAW_PROCS[drawMode](context, frame.mapState, frame.tileSize, frame.tileRenderer);
  return frame.mapState.renderEpoch;
}

type MapCanvasTileRenderMode = 'atlas' | 'missing-atlas';
const MAP_CANVAS_MISSING_TILE_ATLAS_COLOR = '#111827';

/**
 * Returns deterministic DOM stacking order for Authoritative Runtime map layers.
 * Mirrors `DoUpdateEditor` draw order in `ref/micropolis/src/sim/w_editor.c`:
 * `MemDrawBeegMapRect` base map, then `DrawPending`, then `DrawObjects`.
 * Parity note: browser rendering uses CSS z-index instead of a single X11 pixmap.
 */
export function getMapCanvasLayerZIndex(layer: MapCanvasLayer): number {
  switch (layer) {
    case 'map':
      return 0;
    case 'pending-tool':
      return 1;
    case 'realtime-overlay':
      return 2;
    default:
      return assertNever(layer);
  }
}

/**
 * Selects canvas redraw mode from authoritative map draw metadata.
 * Mirrors `DoUpdateMap` invalidation ownership in `ref/micropolis/src/sim/w_map.c`,
 * where invalid/backing-store resets force full `MemDrawMap` redraw before
 * incremental updates continue.
 * Parity note: browser mode detects invalidation via resized canvas backing
 * store and render-epoch regression; skipped patch epochs are coalesced
 * upstream so dirty redraw remains sufficient without forced full redraw.
 */
export function selectMapCanvasDrawMode({
  mapDrawMode,
  renderEpoch,
  lastRenderedEpoch,
  resized,
}: {
  mapDrawMode: RuntimeMapState['drawMode'];
  renderEpoch: number;
  lastRenderedEpoch: number;
  resized: boolean;
}): RuntimeMapState['drawMode'] {
  if (mapDrawMode === 'snapshot' || resized || lastRenderedEpoch === 0) {
    return 'snapshot';
  }

  if (renderEpoch < lastRenderedEpoch) {
    return 'snapshot';
  }

  return mapDrawMode;
}

/**
 * Authoritative Runtime map draw-proc table keyed by runtime map draw mode.
 * Mirrors `mapProcs[]` + `MemDrawMap` dispatch in `ref/micropolis/src/sim/g_map.c`.
 * Parity note: Authoritative Runtime currently carries only transport-level redraw modes
 * (`none`/`snapshot`/`patch`) rather than C thematic map overlays (`ALMAP`..`DYMAP`).
 */
const MAP_CANVAS_DRAW_PROCS: Record<RuntimeMapState['drawMode'], MapCanvasDrawProc> = {
  none: () => {},
  snapshot: drawAllTiles,
  patch: drawPatchTiles,
};

interface MapCanvasRealtimeSpriteSpec {
  displayName: string;
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  label: string;
  color: string;
}

/**
 * One projected realtime overlay sprite for browser map rendering.
 * Mirrors `DrawSprite` positioning in `ref/micropolis/src/sim/w_sprite.c`
 * (`x + x_offset`, `y + y_offset`, `width`, `height`) using Realtime Overlay payloads.
 * Parity note: object-frame artwork uses Micropolis-derived `obj*-*.xpm` image
 * identity via exported PNG overlays, with deterministic label fallback when a
 * frame image is unavailable.
 */
export interface MapCanvasRealtimeOverlaySprite {
  key: string;
  name: string;
  frame: number;
  label: string;
  color: string;
  spriteFrameUrl?: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

const MAP_CANVAS_REALTIME_SPRITE_SPECS: Record<number, MapCanvasRealtimeSpriteSpec> = {
  // 1:1 with `InitSprite` dimensions and offsets in `ref/micropolis/src/sim/w_sprite.c`.
  1: {
    displayName: 'train',
    width: 32,
    height: 32,
    xOffset: 32,
    yOffset: -16,
    label: 'TRN',
    color: '#22c55e',
  },
  2: {
    displayName: 'copter',
    width: 32,
    height: 32,
    xOffset: 32,
    yOffset: -16,
    label: 'COP',
    color: '#0ea5e9',
  },
  3: {
    displayName: 'plane',
    width: 48,
    height: 48,
    xOffset: 24,
    yOffset: 0,
    label: 'AIR',
    color: '#3b82f6',
  },
  4: {
    displayName: 'ship',
    width: 48,
    height: 48,
    xOffset: 32,
    yOffset: -16,
    label: 'SHP',
    color: '#06b6d4',
  },
  5: {
    displayName: 'monster',
    width: 48,
    height: 48,
    xOffset: 24,
    yOffset: 0,
    label: 'MON',
    color: '#f97316',
  },
  6: {
    displayName: 'tornado',
    width: 48,
    height: 48,
    xOffset: 24,
    yOffset: 0,
    label: 'TOR',
    color: '#0f766e',
  },
  7: {
    displayName: 'explosion',
    width: 48,
    height: 48,
    xOffset: 24,
    yOffset: 0,
    label: 'EXP',
    color: '#ef4444',
  },
  8: {
    displayName: 'bus',
    width: 32,
    height: 32,
    xOffset: 30,
    yOffset: -18,
    label: 'BUS',
    color: '#f59e0b',
  },
};

const MAP_CANVAS_FALLBACK_REALTIME_SPRITE_SPEC: MapCanvasRealtimeSpriteSpec = {
  displayName: 'object',
  width: 32,
  height: 32,
  xOffset: 0,
  yOffset: 0,
  label: 'OBJ',
  color: '#64748b',
};

/**
 * Projects authoritative realtime objects into drawable overlay quads.
 * Mirrors `DrawSprite` placement in `ref/micropolis/src/sim/w_sprite.c`, where
 * object coordinates are 1/16-tile world pixels with sprite-type offsets.
 * Parity note: browser projection clips off-screen sprites and skips `frame=0`
 * objects the same way C draw code treats inactive sprites.
 * Difference: Realtime Overlay sorts projected overlays by deterministic id/field order
 * and uses stable id-first keys so React overlay updates remain replay-stable
 * while base-map redraw cadence continues to follow map patch draw mode only.
 */
export function projectRealtimeOverlaySprites({
  objects,
  tileSize,
  mapWidth,
  mapHeight,
}: {
  objects: readonly RuntimeRealtimeObject[];
  tileSize: number;
  mapWidth: number;
  mapHeight: number;
}): MapCanvasRealtimeOverlaySprite[] {
  const pixelsPerWorldUnit = tileSize / 16;
  const viewportWidth = mapWidth * tileSize;
  const viewportHeight = mapHeight * tileSize;
  const overlays: MapCanvasRealtimeOverlaySprite[] = [];
  const deterministicObjects = createDeterministicRealtimeOverlayOrder(objects);
  const overlayKeyCounts = new Map<string, number>();

  for (const entry of deterministicObjects) {
    const { object } = entry;
    if (object.frame <= 0) {
      continue;
    }

    const spec = getRealtimeSpriteSpec(object.type);
    const spriteFrame = lookupObjectSpriteFrame({
      spriteType: object.type,
      runtimeFrame: object.frame,
    });
    const left = (object.x + spec.xOffset) * pixelsPerWorldUnit;
    const top = (object.y + spec.yOffset) * pixelsPerWorldUnit;
    const width = spec.width * pixelsPerWorldUnit;
    const height = spec.height * pixelsPerWorldUnit;

    if (left + width <= 0 || top + height <= 0 || left >= viewportWidth || top >= viewportHeight) {
      continue;
    }

    overlays.push({
      key: buildRealtimeOverlayKey(object, overlayKeyCounts),
      name: spec.displayName,
      frame: object.frame,
      label: spec.label,
      color: spec.color,
      spriteFrameUrl: spriteFrame?.spriteFrameUrl,
      left,
      top,
      width,
      height,
    });
  }

  return overlays;
}

function getRealtimeSpriteSpec(type: number): MapCanvasRealtimeSpriteSpec {
  return MAP_CANVAS_REALTIME_SPRITE_SPECS[type] ?? MAP_CANVAS_FALLBACK_REALTIME_SPRITE_SPEC;
}

interface RealtimeOverlayObjectReference {
  object: RuntimeRealtimeObject;
  sourceIndex: number;
}

function createDeterministicRealtimeOverlayOrder(
  objects: readonly RuntimeRealtimeObject[],
): RealtimeOverlayObjectReference[] {
  const references: RealtimeOverlayObjectReference[] = [];
  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index];
    if (object !== undefined) {
      references.push({
        object,
        sourceIndex: index,
      });
    }
  }

  references.sort(compareRealtimeOverlayObjectReferences);
  return references;
}

function compareRealtimeOverlayObjectReferences(
  left: RealtimeOverlayObjectReference,
  right: RealtimeOverlayObjectReference,
): number {
  const leftId = left.object.id;
  const rightId = right.object.id;
  if (leftId !== undefined && rightId !== undefined) {
    const idCompare = leftId.localeCompare(rightId);
    if (idCompare !== 0) {
      return idCompare;
    }
  } else if (leftId === undefined && rightId !== undefined) {
    return 1;
  } else if (leftId !== undefined && rightId === undefined) {
    return -1;
  }

  if (left.object.type !== right.object.type) {
    return left.object.type - right.object.type;
  }

  const nameCompare = left.object.name.localeCompare(right.object.name);
  if (nameCompare !== 0) {
    return nameCompare;
  }

  if (left.object.x !== right.object.x) {
    return left.object.x - right.object.x;
  }
  if (left.object.y !== right.object.y) {
    return left.object.y - right.object.y;
  }
  if (left.object.frame !== right.object.frame) {
    return left.object.frame - right.object.frame;
  }

  return left.sourceIndex - right.sourceIndex;
}

function buildRealtimeOverlayKey(
  object: RuntimeRealtimeObject,
  seenKeyBases: Map<string, number>,
): string {
  const keyBase =
    object.id !== undefined ? `id:${object.id}` : `legacy:${object.type}:${object.name}`;
  const seenCount = seenKeyBases.get(keyBase) ?? 0;
  seenKeyBases.set(keyBase, seenCount + 1);
  return seenCount === 0 ? keyBase : `${keyBase}:${seenCount}`;
}

function drawAllTiles(
  context: CanvasRenderingContext2D,
  mapState: RuntimeMapState,
  tileSize: number,
  tileRenderer: MapCanvasTileRenderer,
): void {
  const { width, height, tiles } = mapState;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      drawMapCanvasTile(context, tiles[index] ?? 0, x, y, tileSize, tileRenderer);
    }
  }
}

function drawPatchTiles(
  context: CanvasRenderingContext2D,
  mapState: RuntimeMapState,
  tileSize: number,
  tileRenderer: MapCanvasTileRenderer,
): void {
  forEachMapCanvasPatchTileIndex(mapState, (tileIndex) => {
    const width = mapState.width;
    const x = tileIndex % width;
    const y = Math.floor(tileIndex / width);
    drawMapCanvasTile(context, mapState.tiles[tileIndex] ?? 0, x, y, tileSize, tileRenderer);
  });
}

/**
 * Iterates tile indexes covered by one patch redraw pass.
 * Mirrors dirty-region traversal ownership in `DoUpdateMap` from
 * `ref/micropolis/src/sim/w_map.c`, where invalid rects are clipped to map
 * bounds before tile redraw iteration proceeds.
 * Parity note: Authoritative Runtime unions authority-provided dirty rects and dirty indexes
 * before iteration so long-session browser redraw remains artifact-free even if
 * payload sources diverge during transport/coalescing; C view code owns one
 * invalidation source per cycle.
 */
export function forEachMapCanvasPatchTileIndex(
  mapState: Readonly<Pick<RuntimeMapState, 'width' | 'height' | 'dirtyRects' | 'dirtyTileIndexes'>>,
  visit: (tileIndex: number) => void,
): void {
  const tileCount = mapState.width * mapState.height;
  if (tileCount <= 0) {
    return;
  }

  const seen = new Uint8Array(tileCount);
  for (const rect of mapState.dirtyRects) {
    const startX = Math.max(0, rect.x);
    const startY = Math.max(0, rect.y);
    const endX = Math.min(mapState.width, rect.x + rect.width);
    const endY = Math.min(mapState.height, rect.y + rect.height);
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const index = y * mapState.width + x;
        if (seen[index] !== 0) {
          continue;
        }
        seen[index] = 1;
        visit(index);
      }
    }
  }

  for (const tileIndex of mapState.dirtyTileIndexes) {
    if (tileIndex >= tileCount || seen[tileIndex] !== 0) {
      continue;
    }
    seen[tileIndex] = 1;
    visit(tileIndex);
  }
}

function drawMapCanvasTile(
  context: CanvasRenderingContext2D,
  tileWord: number,
  x: number,
  y: number,
  tileSize: number,
  tileRenderer: MapCanvasTileRenderer,
): void {
  const sprite = lookupTileSprite(tileWord, {
    atlasCanonicalIdentityKey: tileRenderer.baseTileAtlasCanonicalIdentityKey,
  });
  const targetX = x * tileSize;
  const targetY = y * tileSize;
  const atlasImage = tileRenderer.tileAtlasImagesByCanonicalIdentityKey.get(
    sprite.atlasCanonicalIdentityKey,
  );
  const tileRenderMode = selectMapCanvasTileRenderMode({
    hasAtlasImage: atlasImage !== undefined,
  });

  if (tileRenderMode === 'atlas') {
    if (atlasImage === undefined) {
      throw new Error('Expected Sprite Atlas tile atlas image for atlas render mode');
    }
    context.drawImage(
      atlasImage,
      sprite.sourceX,
      sprite.sourceY,
      sprite.sourceWidth,
      sprite.sourceHeight,
      targetX,
      targetY,
      tileSize,
      tileSize,
    );
    return;
  }

  context.fillStyle = MAP_CANVAS_MISSING_TILE_ATLAS_COLOR;
  context.fillRect(targetX, targetY, tileSize, tileSize);
}

/**
 * Selects Sprite Atlas tile render mode for one map tile draw.
 * Micropolis C draw flow assumes `GetViewTiles` art resources are available
 * before `MemDrawBeegMapRect` draws tiles (`ref/micropolis/src/sim/g_setup.c`,
 * `ref/micropolis/src/sim/g_bigmap.c`).
 * Parity note: TypeScript keeps missing-atlas fallback explicit when browser
 * atlas images are unavailable; C expects assets to be loaded before draw.
 */
export function selectMapCanvasTileRenderMode({
  hasAtlasImage,
}: {
  hasAtlasImage: boolean;
}): MapCanvasTileRenderMode {
  return hasAtlasImage ? 'atlas' : 'missing-atlas';
}

/**
 * Clamp camera offsets to the current map bounds.
 * Mirrors `DoAdjustPan` bounds-clamping in `ref/micropolis/src/sim/w_x.c`,
 * adapted from world pixels to browser canvas pixels.
 */
function clampMapCanvasCameraOffset(
  offset: Readonly<{ x: number; y: number }>,
  maxX: number,
  maxY: number,
): { x: number; y: number } {
  return {
    x: clampMapCanvasCoordinate(offset.x, maxX),
    y: clampMapCanvasCoordinate(offset.y, maxY),
  };
}

function clampMapCanvasCoordinate(value: number, maxValue: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= maxValue) {
    return maxValue;
  }
  return value;
}

/**
 * Clamp Authoritative Runtime browser zoom to supported bounds.
 * Micropolis C editor map flow in `w_map.c`/`w_x.c` is pan-only.
 * Difference: Authoritative Runtime adds bounded zoom while preserving C-style pan clamps.
 */
function clampMapCanvasZoom(zoom: number): number {
  if (zoom <= MAP_CANVAS_MIN_ZOOM) {
    return MAP_CANVAS_MIN_ZOOM;
  }
  if (zoom >= MAP_CANVAS_MAX_ZOOM) {
    return MAP_CANVAS_MAX_ZOOM;
  }
  return zoom;
}

/**
 * Converts client pixel coordinates into element-local coordinates.
 * Mirrors map-input pointer-coordinate normalization in `MapCmdPanStart` from
 * `ref/micropolis/src/sim/w_map.c`, adapted to browser DOM bounds.
 */
function getElementRelativeClientPosition({
  element,
  clientX,
  clientY,
}: {
  element: HTMLDivElement;
  clientX: number;
  clientY: number;
}): {
  x: number;
  y: number;
} {
  const bounds = element.getBoundingClientRect();
  return {
    x: clientX - bounds.left,
    y: clientY - bounds.top,
  };
}

/**
 * Pointer-event variant of element-relative coordinate conversion.
 * Mirrors map pan pointer-to-local conversion in `MapCmdPanStart` from
 * `ref/micropolis/src/sim/w_map.c`, adapted to browser pointer events.
 */
function getElementRelativePointerPosition(event: PointerEvent<HTMLDivElement>): {
  x: number;
  y: number;
} {
  return getElementRelativeClientPosition({
    element: event.currentTarget,
    clientX: event.clientX,
    clientY: event.clientY,
  });
}

/**
 * Converts a canvas click position into map tile coordinates.
 * Mirrors Micropolis tool targeting by map tile in `do_tool` from
 * `ref/micropolis/src/sim/w_tool.c`, adapted for HTML canvas coordinates.
 */
function getClickedTilePosition(
  event: MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
  tileSize: number,
): { x: number; y: number } | null {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) {
    return null;
  }

  const canvasX = ((event.clientX - bounds.left) * canvas.width) / bounds.width;
  const canvasY = ((event.clientY - bounds.top) * canvas.height) / bounds.height;

  return {
    x: Math.floor(canvasX / tileSize),
    y: Math.floor(canvasY / tileSize),
  };
}

/**
 * Bounds-check helper for tile click placement.
 * Mirrors the tool bounds checks used by `road_tool`/`rail_tool`/`wire_tool`
 * and related tool entry points in `ref/micropolis/src/sim/w_tool.c`.
 */
function isTileInBounds(x: number, y: number, mapState: RuntimeMapState): boolean {
  return x >= 0 && y >= 0 && x < mapState.width && y < mapState.height;
}

function truncateTowardZero(value: number): number {
  return Math.trunc(value);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected map canvas layer "${String(value)}"`);
}
