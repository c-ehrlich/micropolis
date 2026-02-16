import {
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { CanonicalImageIdentityKey } from '../../../../../packages/sim-assets/src/derived-images.ts';
import {
  getPlayableToolSpec,
  type PendingToolCommandVisual,
  type PlayableToolName,
} from '../../game/runtime/index.ts';
import {
  coalesceQueuedRuntimeMapState,
  type RuntimeMapState,
} from '../../game/runtime/map-state.ts';
import type { RuntimeRealtimeObject } from '../../game/runtime/realtime-state.ts';
import {
  clampMapCanvasCameraOffset,
  clampMapCanvasZoom,
  computeMapCanvasZoomFromWheel,
  continueMapCanvasPanDrag,
  DEFAULT_MAP_CANVAS_VIEWPORT_HEIGHT_PX,
  DEFAULT_MAP_CANVAS_VIEWPORT_WIDTH_PX,
  getMapCanvasCameraMetrics,
  isMapCanvasZoomWheelGesture,
  type MapCanvasPanDragState,
  type MapCanvasViewportBounds,
  normalizeMapCanvasWheelDeltaToPixels,
  projectMapCanvasToolFootprintRect,
  selectMapCanvasBaseTileAtlasCanonicalIdentityKey,
  startMapCanvasPanDrag,
  traceMapCanvasSingleTileToolDragPath,
  zoomMapCanvasCameraOffsetAtAnchor,
} from './map-canvas.camera.ts';
import {
  consumeQueuedMapCanvasFrame,
  drawMapCanvasFrame,
  getMapCanvasLayerZIndex,
  type MapCanvasRenderFrame,
} from './map-canvas.draw.ts';
import { projectRealtimeOverlaySprites } from './map-canvas.overlay.ts';
import {
  getTileAtlasSourceByCanonicalIdentityKey,
  type RuntimeTilesetName,
} from './tile-sprite-atlas.ts';

/**
 * Active left-button drag state for repeated single-tile tool placement.
 * Mirrors `ToolDown` + `ToolDrag` tracking of `last_x/last_y` in
 * `ref/micropolis/src/sim/w_tool.c`, adapted to browser pointer ids.
 */
interface MapCanvasToolPlacementDragState {
  pointerId: number;
  lastTile: {
    x: number;
    y: number;
  };
}

/**
 * Optional cursor-footprint preview descriptor supplied by embedding editors.
 * Not from Micropolis C: browser-only override that lets non-tool brushes
 * (for example scenario base-tile painting) reuse the same hover preview path.
 */
export interface MapCanvasHoverPreviewSpec {
  readonly size: number;
  readonly offset: number;
  readonly pendingColor: string;
}

/**
 * Per-tile overlay styling used by editor visualization layers.
 * Not from Micropolis C: browser-only annotation styling drawn above map tiles.
 */
export interface MapCanvasTileOverlayStyle {
  readonly fillColor?: string;
  readonly label?: string;
  readonly labelColor?: string;
  readonly strokeColor?: string;
}

/**
 * Tile-overlay resolver used for optional editor visualization layers.
 * Not from Micropolis C: browser-only callback for conditional per-tile annotations.
 */
export type MapCanvasTileOverlayResolver = (
  tileWord: number,
  tileX: number,
  tileY: number,
) => MapCanvasTileOverlayStyle | null;

/**
 * Canvas renderer for authoritative Authoritative Runtime map snapshots and tile patches.
 * Mirrors full-map redraw vs incremental redraw ownership from
 * `ref/micropolis/src/sim/w_map.c` and tile-word lookup intent from
 * `ref/micropolis/src/sim/g_bigmap.c`.
 * Parity note: Sprite Atlas uses Micropolis-derived tile sprites from canonical
 * `tiles.xpm` identity and treats missing atlas images as explicit fallback.
 * Difference: browser-only pan/zoom controls can render either in-map (default)
 * or in an external UI container supplied by the route. Runtime tileset
 * selection is TypeScript-only and leaves authoritative tile ids unchanged.
 */
export function MapCanvas({
  mapState,
  pendingTools = [],
  realtimeObjects = [],
  hoverTool,
  hoverPreview,
  tileOverlayResolver,
  showHoverToolPreview = true,
  onTileClick,
  dragPlacementEnabled = false,
  tileSize = 4,
  tilesetName = 'classic',
}: {
  mapState: RuntimeMapState;
  pendingTools?: readonly PendingToolCommandVisual[];
  realtimeObjects?: readonly RuntimeRealtimeObject[];
  hoverTool?: PlayableToolName;
  hoverPreview?: MapCanvasHoverPreviewSpec;
  tileOverlayResolver?: MapCanvasTileOverlayResolver;
  showHoverToolPreview?: boolean;
  onTileClick?: (x: number, y: number) => void;
  dragPlacementEnabled?: boolean;
  tileSize?: number;
  tilesetName?: RuntimeTilesetName;
  cameraControlsContainer?: HTMLElement | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tileOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const mapCanvasRootRef = useRef<HTMLDivElement>(null);
  const tileAtlasImagesByCanonicalIdentityKeyRef = useRef<
    ReadonlyMap<CanonicalImageIdentityKey, HTMLImageElement>
  >(new Map());
  const queuedMapFrameRef = useRef<MapCanvasRenderFrame | null>(null);
  const pendingAnimationFrameRef = useRef<number | null>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const panDragStateRef = useRef<MapCanvasPanDragState | null>(null);
  const toolPlacementDragStateRef = useRef<MapCanvasToolPlacementDragState | null>(null);
  const lastRenderedBlinkUnpoweredZoneCenterRef = useRef<boolean | null>(null);
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
  const [hoveredToolTile, setHoveredToolTile] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const baseTileAtlasCanonicalIdentityKey = useMemo(
    () => selectMapCanvasBaseTileAtlasCanonicalIdentityKey(tileSize, tilesetName),
    [tileSize, tilesetName],
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
      lastRenderedBlinkUnpoweredZoneCenterRef.current = null;
      return;
    }

    const nextFrame: MapCanvasRenderFrame = {
      mapState,
      tileSize,
      tileRenderer: {
        baseTileAtlasCanonicalIdentityKey,
        blinkUnpoweredZoneCenter: mapState.blinkUnpoweredZoneCenter,
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
        lastRenderedBlinkUnpoweredZoneCenter: lastRenderedBlinkUnpoweredZoneCenterRef.current,
      });
      lastRenderedBlinkUnpoweredZoneCenterRef.current = frame.tileRenderer.blinkUnpoweredZoneCenter;
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
  const hoverPreviewSpec = useMemo(() => {
    if (hoverPreview !== undefined) {
      return hoverPreview;
    }
    if (hoverTool === undefined) {
      return null;
    }
    return getPlayableToolSpec(hoverTool);
  }, [hoverPreview, hoverTool]);
  const isToolCursorPreviewEnabled =
    showHoverToolPreview && hoverPreviewSpec !== null && onTileClick !== undefined;
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
        tilesetName,
      }),
    [mapState.height, mapState.width, realtimeObjects, tileSize, tilesetName],
  );
  const hoveredToolFootprint = useMemo(() => {
    if (
      !isToolCursorPreviewEnabled ||
      hoveredToolTile === null ||
      hoverPreviewSpec === null ||
      !isTileInBounds(hoveredToolTile.x, hoveredToolTile.y, mapState)
    ) {
      return null;
    }

    return projectMapCanvasToolFootprintRect({
      tileX: hoveredToolTile.x,
      tileY: hoveredToolTile.y,
      size: hoverPreviewSpec.size,
      offset: hoverPreviewSpec.offset,
      tileSize,
    });
  }, [hoverPreviewSpec, hoveredToolTile, isToolCursorPreviewEnabled, mapState, tileSize]);

  useEffect(() => {
    const overlayCanvas = tileOverlayCanvasRef.current;
    if (overlayCanvas === null || !mapState.hasSnapshot) {
      return;
    }

    const width = mapState.width * tileSize;
    const height = mapState.height * tileSize;
    if (overlayCanvas.width !== width) {
      overlayCanvas.width = width;
    }
    if (overlayCanvas.height !== height) {
      overlayCanvas.height = height;
    }

    const context = overlayCanvas.getContext('2d');
    if (context === null) {
      return;
    }

    drawMapCanvasTileOverlayLayer({
      context,
      mapState,
      tileSize,
      tileOverlayResolver,
    });
  }, [mapState, tileOverlayResolver, tileSize]);

  const applyToolPlacementDragSample = useCallback(
    (tile: { x: number; y: number }): void => {
      if (onTileClick === undefined) {
        return;
      }
      const dragState = toolPlacementDragStateRef.current;
      if (dragState === null) {
        return;
      }
      if (tile.x === dragState.lastTile.x && tile.y === dragState.lastTile.y) {
        return;
      }

      const dragPath = traceMapCanvasSingleTileToolDragPath({
        fromX: dragState.lastTile.x,
        fromY: dragState.lastTile.y,
        toX: tile.x,
        toY: tile.y,
      });
      for (const point of dragPath) {
        if (!isTileInBounds(point.x, point.y, mapState)) {
          continue;
        }
        onTileClick(point.x, point.y);
      }
      dragState.lastTile = tile;
    },
    [mapState, onTileClick],
  );

  const updateHoveredToolTileFromPointer = useCallback(
    (event: PointerEvent<HTMLCanvasElement>): void => {
      if (!isToolCursorPreviewEnabled) {
        return;
      }

      const canvas = canvasRef.current;
      if (canvas === null) {
        return;
      }

      const tile = getPointerTilePosition(event, canvas, tileSize);
      if (tile === null || !isTileInBounds(tile.x, tile.y, mapState)) {
        setHoveredToolTile(null);
        return;
      }

      setHoveredToolTile((currentTile) => {
        if (currentTile !== null && currentTile.x === tile.x && currentTile.y === tile.y) {
          return currentTile;
        }
        return tile;
      });
    },
    [isToolCursorPreviewEnabled, mapState, tileSize],
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

  if (!mapState.hasSnapshot) {
    return (
      <div
        ref={mapCanvasRootRef}
        className="flex h-full w-full items-center justify-center bg-[#0b1020] font-mono text-xs text-slate-200"
      >
        No map snapshot received yet.
      </div>
    );
  }

  return (
    <div ref={mapCanvasRootRef} className="relative h-full w-full overflow-hidden bg-[#0b1020]">
      <div
        ref={mapViewportRef}
        onPointerCancel={(event) => {
          panDragStateRef.current = null;
          toolPlacementDragStateRef.current = null;
          setHoveredToolTile(null);
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
          setHoveredToolTile(null);
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
        className="relative left-1/2 top-1/2 overflow-hidden border border-slate-950/90 -translate-x-1/2 -translate-y-1/2"
        style={{
          height: viewportHeightPx,
          width: viewportWidthPx,
        }}
      >
        <div
          className="absolute origin-top-left"
          style={{
            height: heightPx,
            left: -clampedCameraOffsetPx.x,
            top: -clampedCameraOffsetPx.y,
            transform: `scale(${cameraZoom})`,
            width: widthPx,
          }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={(event) => {
              if (!dragPlacementEnabled || onTileClick === undefined || event.button !== 0) {
                return;
              }

              const canvas = canvasRef.current;
              if (canvas === null) {
                return;
              }

              const tile = getPointerTilePosition(event, canvas, tileSize);
              if (tile === null || !isTileInBounds(tile.x, tile.y, mapState)) {
                return;
              }

              toolPlacementDragStateRef.current = {
                pointerId: event.pointerId,
                lastTile: tile,
              };
              onTileClick(tile.x, tile.y);
              event.currentTarget.setPointerCapture(event.pointerId);
              event.preventDefault();
            }}
            onPointerEnter={(event) => {
              updateHoveredToolTileFromPointer(event);
            }}
            onPointerMove={(event) => {
              updateHoveredToolTileFromPointer(event);

              const dragState = toolPlacementDragStateRef.current;
              if (
                !dragPlacementEnabled ||
                dragState === null ||
                dragState.pointerId !== event.pointerId
              ) {
                return;
              }

              const canvas = canvasRef.current;
              if (canvas === null) {
                return;
              }

              const tile = getPointerTilePosition(event, canvas, tileSize);
              if (tile === null || !isTileInBounds(tile.x, tile.y, mapState)) {
                return;
              }
              applyToolPlacementDragSample(tile);
            }}
            onPointerCancel={(event) => {
              if (
                toolPlacementDragStateRef.current !== null &&
                toolPlacementDragStateRef.current.pointerId === event.pointerId
              ) {
                toolPlacementDragStateRef.current = null;
              }
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerUp={(event) => {
              const dragState = toolPlacementDragStateRef.current;
              if (
                !dragPlacementEnabled ||
                dragState === null ||
                dragState.pointerId !== event.pointerId
              ) {
                return;
              }

              const canvas = canvasRef.current;
              if (canvas !== null) {
                const tile = getPointerTilePosition(event, canvas, tileSize);
                if (tile !== null && isTileInBounds(tile.x, tile.y, mapState)) {
                  applyToolPlacementDragSample(tile);
                }
              }

              toolPlacementDragStateRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              event.preventDefault();
            }}
            onPointerLeave={() => {
              setHoveredToolTile(null);
            }}
            onClick={(event) => {
              if (onTileClick === undefined) {
                return;
              }
              if (dragPlacementEnabled) {
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
            className={`absolute left-0 top-0 block [image-rendering:pixelated] ${
              onTileClick === undefined ? 'cursor-default' : 'cursor-crosshair'
            }`}
            style={{
              zIndex: getMapCanvasLayerZIndex('map'),
            }}
          />
          <canvas
            ref={tileOverlayCanvasRef}
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 block [image-rendering:pixelated]"
            style={{
              zIndex: getMapCanvasLayerZIndex('tile-overlay'),
            }}
          />
          {hoveredToolFootprint === null || hoverPreviewSpec === null ? null : (
            <div
              className="pointer-events-none absolute box-border"
              style={{
                background: `${hoverPreviewSpec.pendingColor}26`,
                border: `2px dashed ${hoverPreviewSpec.pendingColor}`,
                height: hoveredToolFootprint.side,
                left: hoveredToolFootprint.left,
                top: hoveredToolFootprint.top,
                width: hoveredToolFootprint.side,
                zIndex: getMapCanvasLayerZIndex('tool-cursor'),
              }}
            />
          )}
          {pendingTools.map((pending) => {
            const spec = getPlayableToolSpec(pending.command.tool);
            const footprint = projectMapCanvasToolFootprintRect({
              tileX: pending.command.x,
              tileY: pending.command.y,
              size: spec.size,
              offset: spec.offset,
              tileSize,
            });

            return (
              <div
                key={pending.commandId}
                className="pointer-events-none absolute"
                style={{
                  background: `${spec.pendingColor}4d`,
                  border: `1px dashed ${spec.pendingColor}`,
                  height: footprint.side,
                  left: footprint.left,
                  top: footprint.top,
                  width: footprint.side,
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
                className="pointer-events-none absolute [image-rendering:pixelated]"
                style={{
                  filter: sprite.renderFilterCss,
                  height: sprite.height,
                  left: sprite.left,
                  top: sprite.top,
                  width: sprite.width,
                  zIndex: getMapCanvasLayerZIndex('realtime-overlay'),
                }}
                title={`${sprite.name} frame ${sprite.frame}`}
              />
            ) : sprite.spriteSheetUrl !== undefined &&
              sprite.sourceWidth !== undefined &&
              sprite.sourceHeight !== undefined &&
              sprite.sourceX !== undefined &&
              sprite.sourceY !== undefined &&
              sprite.spriteSheetPixelWidth !== undefined &&
              sprite.spriteSheetPixelHeight !== undefined ? (
              <div
                aria-hidden="true"
                key={sprite.key}
                className="pointer-events-none absolute [image-rendering:pixelated]"
                style={{
                  backgroundImage: `url(${sprite.spriteSheetUrl})`,
                  backgroundPosition: `${-(sprite.sourceX * (sprite.width / sprite.sourceWidth))}px ${-(sprite.sourceY * (sprite.height / sprite.sourceHeight))}px`,
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: `${sprite.spriteSheetPixelWidth * (sprite.width / sprite.sourceWidth)}px ${sprite.spriteSheetPixelHeight * (sprite.height / sprite.sourceHeight)}px`,
                  filter: sprite.renderFilterCss,
                  height: sprite.height,
                  left: sprite.left,
                  top: sprite.top,
                  width: sprite.width,
                  zIndex: getMapCanvasLayerZIndex('realtime-overlay'),
                }}
                title={`${sprite.name} frame ${sprite.frame}`}
              />
            ) : (
              <div
                key={sprite.key}
                className="pointer-events-none absolute box-border flex items-center justify-center rounded-[3px] font-mono font-bold leading-none text-slate-900"
                style={{
                  background: `${sprite.color}59`,
                  border: `1px solid ${sprite.color}`,
                  fontSize: Math.max(7, Math.min(10, sprite.height * 0.45)),
                  height: sprite.height,
                  left: sprite.left,
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

/**
 * Draw optional per-tile visualization overlays above the base map canvas.
 * Not from Micropolis C: editor-only browser overlay pass for map-authoring UX.
 */
function drawMapCanvasTileOverlayLayer(options: {
  context: CanvasRenderingContext2D;
  mapState: RuntimeMapState;
  tileSize: number;
  tileOverlayResolver: MapCanvasTileOverlayResolver | undefined;
}): void {
  const { context, mapState, tileSize, tileOverlayResolver } = options;
  const overlayCanvas = context.canvas;
  context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (tileOverlayResolver === undefined) {
    return;
  }

  context.imageSmoothingEnabled = false;
  const width = mapState.width;
  const height = mapState.height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const tileWord = mapState.tiles[index] ?? 0;
      const overlayStyle = tileOverlayResolver(tileWord, x, y);
      if (overlayStyle === null) {
        continue;
      }
      drawMapCanvasTileOverlayCell({
        context,
        tileX: x,
        tileY: y,
        tileSize,
        overlayStyle,
      });
    }
  }
}

/**
 * Draw one tile-aligned overlay cell on the map overlay canvas.
 * Not from Micropolis C: browser-only annotation rendering for editor overlays.
 */
function drawMapCanvasTileOverlayCell(options: {
  context: CanvasRenderingContext2D;
  tileX: number;
  tileY: number;
  tileSize: number;
  overlayStyle: MapCanvasTileOverlayStyle;
}): void {
  const { context, tileX, tileY, tileSize, overlayStyle } = options;
  const left = tileX * tileSize;
  const top = tileY * tileSize;
  if (overlayStyle.fillColor !== undefined) {
    context.fillStyle = overlayStyle.fillColor;
    context.fillRect(left, top, tileSize, tileSize);
  }
  if (overlayStyle.strokeColor !== undefined) {
    context.strokeStyle = overlayStyle.strokeColor;
    context.lineWidth = Math.max(1, Math.floor(tileSize / 8));
    context.strokeRect(
      left + context.lineWidth / 2,
      top + context.lineWidth / 2,
      tileSize - context.lineWidth,
      tileSize - context.lineWidth,
    );
  }
  if (overlayStyle.label !== undefined && tileSize >= 10) {
    context.fillStyle = overlayStyle.labelColor ?? '#111827';
    context.font = `${Math.max(8, Math.floor(tileSize * 0.7))}px monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(overlayStyle.label, left + tileSize / 2, top + tileSize / 2);
  }
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
  return getCanvasTilePositionFromClientPoint({
    canvas,
    clientX: event.clientX,
    clientY: event.clientY,
    tileSize,
  });
}

/**
 * Converts a canvas pointer sample into map tile coordinates.
 * Mirrors tool-target tile resolution from `do_tool` in
 * `ref/micropolis/src/sim/w_tool.c`, adapted for browser pointer events.
 */
function getPointerTilePosition(
  event: PointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
  tileSize: number,
): { x: number; y: number } | null {
  return getCanvasTilePositionFromClientPoint({
    canvas,
    clientX: event.clientX,
    clientY: event.clientY,
    tileSize,
  });
}

/**
 * Converts one client-space sample over the canvas into map tile coordinates.
 * Mirrors Micropolis editor pixel-to-tile targeting in `do_tool`
 * (`ref/micropolis/src/sim/w_tool.c`) while accounting for browser canvas CSS scaling.
 */
function getCanvasTilePositionFromClientPoint({
  canvas,
  clientX,
  clientY,
  tileSize,
}: {
  canvas: HTMLCanvasElement;
  clientX: number;
  clientY: number;
  tileSize: number;
}): { x: number; y: number } | null {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) {
    return null;
  }

  const canvasX = ((clientX - bounds.left) * canvas.width) / bounds.width;
  const canvasY = ((clientY - bounds.top) * canvas.height) / bounds.height;

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
