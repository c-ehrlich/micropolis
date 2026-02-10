import { type MouseEvent, useEffect, useRef } from 'react';

import { getPlayableToolSpec, type PendingToolCommandVisual } from '../runtime/index.ts';
import type { RuntimeMapState } from '../runtime/map-state.ts';
import type { RuntimeRealtimeObject } from '../runtime/realtime-state.ts';
import { getStage4TileDebugColor } from './stage4-tile-renderer.ts';

/**
 * Canvas renderer for authoritative Stage 4 map snapshots and tile patches.
 * Mirrors full-map redraw vs incremental redraw ownership from
 * `ref/micropolis/src/sim/w_map.c` and tile-word lookup intent from
 * `ref/micropolis/src/sim/g_bigmap.c`.
 * Difference: this remains a debug-color renderer instead of sprite atlas art.
 */
export function MapCanvas({
  mapState,
  pendingTools = [],
  realtimeObjects = [],
  onTileClick,
  tileSize = 4,
}: {
  mapState: RuntimeMapState;
  pendingTools?: readonly PendingToolCommandVisual[];
  realtimeObjects?: readonly RuntimeRealtimeObject[];
  onTileClick?: (x: number, y: number) => void;
  tileSize?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastRenderedEpochRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !mapState.hasSnapshot) {
      lastRenderedEpochRef.current = 0;
      return;
    }

    const context = canvas.getContext('2d');
    if (context === null) {
      return;
    }

    const widthPx = mapState.width * tileSize;
    const heightPx = mapState.height * tileSize;
    let resized = false;
    if (canvas.width !== widthPx) {
      canvas.width = widthPx;
      resized = true;
    }
    if (canvas.height !== heightPx) {
      canvas.height = heightPx;
      resized = true;
    }

    const drawMode = selectMapCanvasDrawMode({
      mapDrawMode: mapState.drawMode,
      renderEpoch: mapState.renderEpoch,
      lastRenderedEpoch: lastRenderedEpochRef.current,
      resized,
    });
    MAP_CANVAS_DRAW_PROCS[drawMode](context, mapState, tileSize);
    lastRenderedEpochRef.current = mapState.renderEpoch;
  }, [mapState, tileSize]);

  if (!mapState.hasSnapshot) {
    return <div>No map snapshot received yet.</div>;
  }

  const widthPx = mapState.width * tileSize;
  const heightPx = mapState.height * tileSize;
  const realtimeOverlaySprites = projectRealtimeOverlaySprites({
    objects: realtimeObjects,
    tileSize,
    mapWidth: mapState.width,
    mapHeight: mapState.height,
  });

  return (
    <div
      style={{
        border: '1px solid #333',
        height: heightPx,
        overflow: 'hidden',
        position: 'relative',
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
            }}
          />
        );
      })}
      {realtimeOverlaySprites.map((sprite) => (
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
          }}
          title={`${sprite.name} frame ${sprite.frame}`}
        >
          {sprite.label}
        </div>
      ))}
    </div>
  );
}

type MapCanvasDrawProc = (
  context: CanvasRenderingContext2D,
  mapState: RuntimeMapState,
  tileSize: number,
) => void;

/**
 * Selects canvas redraw mode from authoritative map draw metadata.
 * Mirrors `DoUpdateMap` invalidation ownership in `ref/micropolis/src/sim/w_map.c`,
 * where invalid/backing-store resets force full `MemDrawMap` redraw before
 * incremental updates continue.
 * Parity note: browser mode detects invalidation via resized canvas backing
 * store and skipped render epochs (React batched snapshot+patch states).
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

  if (renderEpoch > lastRenderedEpoch + 1) {
    return 'snapshot';
  }

  return mapDrawMode;
}

/**
 * Stage 4 map draw-proc table keyed by runtime map draw mode.
 * Mirrors `mapProcs[]` + `MemDrawMap` dispatch in `ref/micropolis/src/sim/g_map.c`.
 * Parity note: Stage 4 currently carries only transport-level redraw modes
 * (`none`/`snapshot`/`patch`) rather than C thematic map overlays (`ALMAP`..`DYMAP`).
 */
const MAP_CANVAS_DRAW_PROCS: Record<RuntimeMapState['drawMode'], MapCanvasDrawProc> = {
  none: () => {},
  snapshot: drawAllTiles,
  patch: drawPatchTiles,
};

interface MapCanvasRealtimeSpriteSpec {
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
 * (`x + x_offset`, `y + y_offset`, `width`, `height`) using Stage 7 payloads.
 * Parity note: this keeps debug-label rectangles instead of Micropolis sprite art.
 */
export interface MapCanvasRealtimeOverlaySprite {
  key: string;
  name: string;
  frame: number;
  label: string;
  color: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

const MAP_CANVAS_REALTIME_SPRITE_SPECS: Record<number, MapCanvasRealtimeSpriteSpec> = {
  // 1:1 with `InitSprite` dimensions and offsets in `ref/micropolis/src/sim/w_sprite.c`.
  1: { width: 32, height: 32, xOffset: 32, yOffset: -16, label: 'TRN', color: '#22c55e' },
  2: { width: 32, height: 32, xOffset: 32, yOffset: -16, label: 'COP', color: '#0ea5e9' },
  3: { width: 48, height: 48, xOffset: 24, yOffset: 0, label: 'AIR', color: '#3b82f6' },
  4: { width: 48, height: 48, xOffset: 32, yOffset: -16, label: 'SHIP', color: '#06b6d4' },
  5: { width: 48, height: 48, xOffset: 24, yOffset: 0, label: 'MON', color: '#f97316' },
  6: { width: 48, height: 48, xOffset: 24, yOffset: 0, label: 'TOR', color: '#0f766e' },
  7: { width: 48, height: 48, xOffset: 24, yOffset: 0, label: 'EXP', color: '#ef4444' },
  8: { width: 32, height: 32, xOffset: 30, yOffset: -18, label: 'BUS', color: '#f59e0b' },
};

const MAP_CANVAS_FALLBACK_REALTIME_SPRITE_SPEC: MapCanvasRealtimeSpriteSpec = {
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

  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index];
    if (object === undefined || object.frame <= 0) {
      continue;
    }

    const spec = getRealtimeSpriteSpec(object.type);
    const left = (object.x + spec.xOffset) * pixelsPerWorldUnit;
    const top = (object.y + spec.yOffset) * pixelsPerWorldUnit;
    const width = spec.width * pixelsPerWorldUnit;
    const height = spec.height * pixelsPerWorldUnit;

    if (left + width <= 0 || top + height <= 0 || left >= viewportWidth || top >= viewportHeight) {
      continue;
    }

    overlays.push({
      key: `${object.type}:${object.name}:${index}`,
      name: object.name,
      frame: object.frame,
      label: spec.label,
      color: spec.color,
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

function drawAllTiles(
  context: CanvasRenderingContext2D,
  mapState: RuntimeMapState,
  tileSize: number,
): void {
  const { width, height, tiles } = mapState;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      context.fillStyle = getStage4TileDebugColor(tiles[index] ?? 0);
      context.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  }
}

function drawPatchTiles(
  context: CanvasRenderingContext2D,
  mapState: RuntimeMapState,
  tileSize: number,
): void {
  if (mapState.dirtyRects.length > 0) {
    drawPatchRects(context, mapState, tileSize);
    return;
  }

  for (const tileIndex of mapState.dirtyTileIndexes) {
    const width = mapState.width;
    const x = tileIndex % width;
    const y = Math.floor(tileIndex / width);
    context.fillStyle = getStage4TileDebugColor(mapState.tiles[tileIndex] ?? 0);
    context.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
  }
}

function drawPatchRects(
  context: CanvasRenderingContext2D,
  mapState: RuntimeMapState,
  tileSize: number,
): void {
  for (const rect of mapState.dirtyRects) {
    const startX = Math.max(0, rect.x);
    const startY = Math.max(0, rect.y);
    const endX = Math.min(mapState.width, rect.x + rect.width);
    const endY = Math.min(mapState.height, rect.y + rect.height);
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const index = y * mapState.width + x;
        context.fillStyle = getStage4TileDebugColor(mapState.tiles[index] ?? 0);
        context.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
      }
    }
  }
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
