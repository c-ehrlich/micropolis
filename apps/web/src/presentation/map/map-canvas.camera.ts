import type { CanonicalImageIdentityKey } from '../../../../../packages/sim-assets/src/derived-images.ts';
import {
  DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
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

export const DEFAULT_MAP_CANVAS_VIEWPORT_WIDTH_PX = 640;
export const DEFAULT_MAP_CANVAS_VIEWPORT_HEIGHT_PX = 480;
const MICROPOLIS_EDITOR_WORLD_PIXELS_PER_TILE = 16;
const MICROPOLIS_MAP_PAN_SCALE_NUMERATOR = 16;
const MICROPOLIS_MAP_PAN_SCALE_DENOMINATOR = 3;
const MAP_CANVAS_MIN_ZOOM = 0.2;
const MAP_CANVAS_MAX_ZOOM = 4;
const MAP_CANVAS_WHEEL_ZOOM_SENSITIVITY = 0.0015;
const MAP_CANVAS_WHEEL_LINE_DELTA_PX = 16;
const MICROPOLIS_FLAG_BLINK_PERIOD_MS = 1000;
export const MAP_CANVAS_BLINK_PHASE_SAMPLE_INTERVAL_MS = 125;

/**
 * Resolve whether unpowered-zone blink substitution is active at one wall-clock sample.
 * Mirrors `flagBlink` assignment in `ref/micropolis/src/sim/sim.c`:
 * `flagBlink = (now_time.tv_usec < 500000) ? 1 : -1`, then
 * `MemDrawBeegMapRect` in `ref/micropolis/src/sim/g_bigmap.c` blinks when
 * `flagBlink <= 0` for unpowered zone centers.
 * Parity note: this is a 1:1 half-second phase port in milliseconds
 * (`tv_usec >= 500000` <=> `(nowMs % 1000) >= 500`).
 */
export function isMapCanvasUnpoweredZoneBlinkPhase(nowMs: number): boolean {
  const microsWindowMs =
    ((Math.trunc(nowMs) % MICROPOLIS_FLAG_BLINK_PERIOD_MS) + MICROPOLIS_FLAG_BLINK_PERIOD_MS) %
    MICROPOLIS_FLAG_BLINK_PERIOD_MS;
  return microsWindowMs >= 500;
}

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
 * Axis-aligned tool-footprint rectangle projected into map-canvas pixel space.
 * Mirrors editor cursor footprint anchoring in `DrawCursor` default branch from
 * `ref/micropolis/src/sim/w_editor.c`, where `(tile - toolOffset) * 16` sets
 * top-left and `toolSize * 16` sets side length.
 * Difference: Authoritative Runtime scales by dynamic `tileSize` instead of fixed 16.
 */
export interface MapCanvasToolFootprintRect {
  left: number;
  top: number;
  side: number;
}

/**
 * Projects one Micropolis tool footprint from tile coordinates to canvas pixels.
 * Mirrors `toolSize[]`/`toolOffset[]` footprint usage in
 * `ref/micropolis/src/sim/w_tool.c` and `DrawCursor` placement math in
 * `ref/micropolis/src/sim/w_editor.c`.
 */
export function projectMapCanvasToolFootprintRect({
  tileX,
  tileY,
  size,
  offset,
  tileSize,
}: {
  tileX: number;
  tileY: number;
  size: number;
  offset: number;
  tileSize: number;
}): MapCanvasToolFootprintRect {
  return {
    left: (tileX - offset) * tileSize,
    top: (tileY - offset) * tileSize,
    side: size * tileSize,
  };
}

/**
 * One interpolated tile sample emitted while dragging one single-tile tool.
 * Mirrors `current_tool(..., first=0)` tile targets from `ToolDrag` in
 * `ref/micropolis/src/sim/w_tool.c` when `toolSize[tool_state] == 1`.
 */
export interface MapCanvasSingleTileDragSample {
  x: number;
  y: number;
}

/**
 * Interpolates one drag segment for single-tile tools with classic corner fill.
 * Mirrors the `dist == 1` branch in `ToolDrag` from
 * `ref/micropolis/src/sim/w_tool.c` including:
 * - `step = 0.3 / max(abs(dx), abs(dy))`
 * - truncation toward zero on sampled tile coordinates
 * - corner-fill insertion when both axes advance in one sample.
 * Difference: this helper works in tile coordinates only and excludes bounds checks.
 */
export function traceMapCanvasSingleTileToolDragPath({
  fromX,
  fromY,
  toX,
  toY,
}: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}): MapCanvasSingleTileDragSample[] {
  let lx = fromX;
  let ly = fromY;
  const dx = toX - lx;
  const dy = toY - ly;
  if (dx === 0 && dy === 0) {
    return [];
  }

  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const step = 0.3 / (adx > ady ? adx : ady);
  const rx = dx < 0 ? 1 : 0;
  const ry = dy < 0 ? 1 : 0;
  const samples: MapCanvasSingleTileDragSample[] = [];

  for (let i = 0; i <= 1 + step; i += step) {
    const tx = fromX + i * dx;
    const ty = fromY + i * dy;
    const dtx = Math.abs(tx - lx);
    const dty = Math.abs(ty - ly);
    if (dtx < 1 && dty < 1) {
      continue;
    }

    if (dtx >= 1 && dty >= 1) {
      if (dtx > dty) {
        samples.push({
          x: truncateTowardZero(tx + rx),
          y: ly,
        });
      } else {
        samples.push({
          x: lx,
          y: truncateTowardZero(ty + ry),
        });
      }
    }

    lx = truncateTowardZero(tx + rx);
    ly = truncateTowardZero(ty + ry);
    samples.push({
      x: lx,
      y: ly,
    });
  }

  return samples;
}

/**
 * Clamp camera offsets to the current map bounds.
 * Mirrors `DoAdjustPan` bounds-clamping in `ref/micropolis/src/sim/w_x.c`,
 * adapted from world pixels to browser canvas pixels.
 */
export function clampMapCanvasCameraOffset(
  offset: Readonly<{ x: number; y: number }>,
  maxX: number,
  maxY: number,
): { x: number; y: number } {
  return {
    x: clampMapCanvasCoordinate(offset.x, maxX),
    y: clampMapCanvasCoordinate(offset.y, maxY),
  };
}

/**
 * Clamp Authoritative Runtime browser zoom to supported bounds.
 * Micropolis C editor map flow in `w_map.c`/`w_x.c` is pan-only.
 * Difference: Authoritative Runtime adds bounded zoom while preserving C-style pan clamps.
 */
export function clampMapCanvasZoom(zoom: number): number {
  if (zoom <= MAP_CANVAS_MIN_ZOOM) {
    return MAP_CANVAS_MIN_ZOOM;
  }
  if (zoom >= MAP_CANVAS_MAX_ZOOM) {
    return MAP_CANVAS_MAX_ZOOM;
  }
  return zoom;
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

function truncateTowardZero(value: number): number {
  return Math.trunc(value);
}
