import { useEffect, useRef } from 'react';

import type { RuntimeMapState } from '../runtime/map-state.ts';

/**
 * Canvas renderer for Stage 2 map snapshots and incremental tile patches.
 * Mirrors full-map vs incremental update intent from
 * `ref/micropolis/src/sim/w_map.c` + `ref/micropolis/src/sim/g_map.c`.
 * Difference: this is a minimal tile color debug view and not Micropolis art.
 */
export function MapCanvas({
  mapState,
  tileSize = 4,
}: {
  mapState: RuntimeMapState;
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

    if (mapState.drawMode === 'snapshot') {
      drawAllTiles(context, mapState, tileSize);
      return;
    }

    if (mapState.drawMode === 'patch') {
      drawPatchTiles(context, mapState, tileSize);
    }
  }, [mapState, tileSize]);

  if (!mapState.hasSnapshot) {
    return <div>No map snapshot received yet.</div>;
  }

  return (
    <canvas
      ref={canvasRef}
      style={{
        border: '1px solid #333',
        imageRendering: 'pixelated',
      }}
    />
  );
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
      context.fillStyle = mapTileColor(tiles[index] ?? 0);
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
    context.fillStyle = mapTileColor(mapState.tiles[tileIndex] ?? 0);
    context.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
  }
}

function mapTileColor(tile: number): string {
  const base = tile & 0xff;
  const hue = (base * 7) % 360;
  const sat = 45 + ((tile >> 8) & 0x1f);
  const light = 28 + ((tile >> 5) & 0x1f);
  return `hsl(${hue} ${Math.min(sat, 85)}% ${Math.min(light, 72)}%)`;
}
