import { type MouseEvent, useEffect, useRef } from 'react';

import { getPlayableToolSpec, type PendingToolCommandVisual } from '../runtime/index.ts';
import type { RuntimeMapState } from '../runtime/map-state.ts';
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
  onTileClick,
  tileSize = 4,
}: {
  mapState: RuntimeMapState;
  pendingTools?: readonly PendingToolCommandVisual[];
  onTileClick?: (x: number, y: number) => void;
  tileSize?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !mapState.hasSnapshot) {
      return;
    }

    const context = canvas.getContext('2d');
    if (context === null) {
      return;
    }

    const widthPx = mapState.width * tileSize;
    const heightPx = mapState.height * tileSize;
    if (canvas.width !== widthPx) {
      canvas.width = widthPx;
    }
    if (canvas.height !== heightPx) {
      canvas.height = heightPx;
    }

    MAP_CANVAS_DRAW_PROCS[mapState.drawMode](context, mapState, tileSize);
  }, [mapState, tileSize]);

  if (!mapState.hasSnapshot) {
    return <div>No map snapshot received yet.</div>;
  }

  const widthPx = mapState.width * tileSize;
  const heightPx = mapState.height * tileSize;

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
    </div>
  );
}

type MapCanvasDrawProc = (
  context: CanvasRenderingContext2D,
  mapState: RuntimeMapState,
  tileSize: number,
) => void;

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
  for (const tileIndex of mapState.dirtyTileIndexes) {
    const width = mapState.width;
    const x = tileIndex % width;
    const y = Math.floor(tileIndex / width);
    context.fillStyle = getStage4TileDebugColor(mapState.tiles[tileIndex] ?? 0);
    context.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
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
