import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';

import type { CanonicalImageIdentityKey } from '../../../../../packages/sim-assets/src/derived-images.ts';
import { getPlayableToolSpec, type PendingToolCommandVisual } from '../runtime/index.ts';
import type { RuntimeMapState } from '../runtime/map-state.ts';
import type { RuntimeRealtimeObject } from '../runtime/realtime-state.ts';
import {
  getStage8TileAtlasSourceByCanonicalIdentityKey,
  isStage4DebugTileRendererEnabled,
  lookupStage8TileSprite,
  resolveStage8MicropolisTileSheetCanonicalIdentityKey,
  STAGE8_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
} from './stage8-tile-sprite-atlas.ts';

const STAGE8_BASE_MAP_TILE_ATLAS_CANONICAL_IDENTITY_KEY =
  resolveStage8MicropolisTileSheetCanonicalIdentityKey({
    viewClass: 'editor',
    color: true,
  }) ?? STAGE8_TILE_ATLAS_CANONICAL_IDENTITY_KEY;

/**
 * Canvas renderer for authoritative Stage 4 map snapshots and tile patches.
 * Mirrors full-map redraw vs incremental redraw ownership from
 * `ref/micropolis/src/sim/w_map.c` and tile-word lookup intent from
 * `ref/micropolis/src/sim/g_bigmap.c`.
 * Parity note: Stage 8 now uses Micropolis-derived tile sprites from canonical
 * `tiles.xpm` identity with a deterministic debug-color fallback flag.
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
  const tileAtlasImagesByCanonicalIdentityKeyRef = useRef<
    ReadonlyMap<CanonicalImageIdentityKey, HTMLImageElement>
  >(new Map());
  const queuedMapFrameRef = useRef<MapCanvasRenderFrame | null>(null);
  const pendingAnimationFrameRef = useRef<number | null>(null);
  const lastRenderedEpochRef = useRef(0);
  const [tileAtlasRenderVersion, setTileAtlasRenderVersion] = useState(0);
  const debugTileRendererEnabled = useMemo(() => isStage4DebugTileRendererEnabled(), []);

  useEffect(() => {
    if (debugTileRendererEnabled) {
      tileAtlasImagesByCanonicalIdentityKeyRef.current = new Map();
      return;
    }

    const atlas = getStage8TileAtlasSourceByCanonicalIdentityKey(
      STAGE8_BASE_MAP_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
    );
    if (atlas === undefined) {
      tileAtlasImagesByCanonicalIdentityKeyRef.current = new Map();
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
      setTileAtlasRenderVersion((version) => version + 1);
    };

    image.onerror = () => {
      if (cancelled) {
        return;
      }
      tileAtlasImagesByCanonicalIdentityKeyRef.current = new Map();
      setTileAtlasRenderVersion((version) => version + 1);
    };

    image.src = atlas.spriteSheetUrl;
    return () => {
      cancelled = true;
    };
  }, [debugTileRendererEnabled]);

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

    queuedMapFrameRef.current = {
      mapState,
      tileSize,
      tileRenderer: {
        debugTileRendererEnabled,
        baseTileAtlasCanonicalIdentityKey: STAGE8_BASE_MAP_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
        tileAtlasImagesByCanonicalIdentityKey: tileAtlasImagesByCanonicalIdentityKeyRef.current,
      },
    };

    if (pendingAnimationFrameRef.current !== null) {
      return;
    }

    pendingAnimationFrameRef.current = requestAnimationFrame(() => {
      pendingAnimationFrameRef.current = null;
      const frame = queuedMapFrameRef.current;
      if (frame === null) {
        return;
      }
      lastRenderedEpochRef.current = drawMapCanvasFrame({
        canvas: canvasRef.current,
        frame,
        lastRenderedEpoch: lastRenderedEpochRef.current,
      });
    });
  }, [debugTileRendererEnabled, mapState, tileAtlasRenderVersion, tileSize]);

  useEffect(() => {
    return () => {
      if (pendingAnimationFrameRef.current !== null) {
        cancelAnimationFrame(pendingAnimationFrameRef.current);
        pendingAnimationFrameRef.current = null;
      }
    };
  }, []);

  const widthPx = mapState.width * tileSize;
  const heightPx = mapState.height * tileSize;
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

  if (!mapState.hasSnapshot) {
    return <div>No map snapshot received yet.</div>;
  }

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
            zIndex: getMapCanvasLayerZIndex('realtime-overlay'),
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
  tileRenderer: MapCanvasTileRenderer,
) => void;

type MapCanvasLayer = 'map' | 'pending-tool' | 'realtime-overlay';

interface MapCanvasTileRenderer {
  baseTileAtlasCanonicalIdentityKey: CanonicalImageIdentityKey;
  debugTileRendererEnabled: boolean;
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
  context.imageSmoothingEnabled = false;

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

  const drawMode = selectMapCanvasDrawMode({
    mapDrawMode: frame.mapState.drawMode,
    renderEpoch: frame.mapState.renderEpoch,
    lastRenderedEpoch,
    resized,
  });
  MAP_CANVAS_DRAW_PROCS[drawMode](context, frame.mapState, frame.tileSize, frame.tileRenderer);
  return frame.mapState.renderEpoch;
}

type MapCanvasTileRenderMode = 'atlas' | 'diagnostic-debug' | 'missing-atlas';
const MAP_CANVAS_MISSING_TILE_ATLAS_COLOR = '#111827';

/**
 * Returns deterministic DOM stacking order for Stage 4 map layers.
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
 * Difference: Stage 7 sorts projected overlays by deterministic id/field order
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
 * Parity note: this is a 1:1 extraction of the Stage 4 patch draw walk so
 * snapshot-vs-patch visual parity can be asserted without canvas APIs.
 */
export function forEachMapCanvasPatchTileIndex(
  mapState: Readonly<Pick<RuntimeMapState, 'width' | 'height' | 'dirtyRects' | 'dirtyTileIndexes'>>,
  visit: (tileIndex: number) => void,
): void {
  if (mapState.dirtyRects.length > 0) {
    for (const rect of mapState.dirtyRects) {
      const startX = Math.max(0, rect.x);
      const startY = Math.max(0, rect.y);
      const endX = Math.min(mapState.width, rect.x + rect.width);
      const endY = Math.min(mapState.height, rect.y + rect.height);
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const index = y * mapState.width + x;
          visit(index);
        }
      }
    }
    return;
  }

  for (const tileIndex of mapState.dirtyTileIndexes) {
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
  const sprite = lookupStage8TileSprite(tileWord, {
    atlasCanonicalIdentityKey: tileRenderer.baseTileAtlasCanonicalIdentityKey,
  });
  const targetX = x * tileSize;
  const targetY = y * tileSize;
  const atlasImage = tileRenderer.tileAtlasImagesByCanonicalIdentityKey.get(
    sprite.atlasCanonicalIdentityKey,
  );
  const tileRenderMode = selectMapCanvasTileRenderMode({
    debugTileRendererEnabled: tileRenderer.debugTileRendererEnabled,
    hasAtlasImage: atlasImage !== undefined,
  });

  if (tileRenderMode === 'atlas') {
    if (atlasImage === undefined) {
      throw new Error('Expected Stage 8 tile atlas image for atlas render mode');
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

  if (tileRenderMode === 'diagnostic-debug') {
    context.fillStyle = sprite.debugFallbackColor;
    context.fillRect(targetX, targetY, tileSize, tileSize);
    return;
  }

  context.fillStyle = MAP_CANVAS_MISSING_TILE_ATLAS_COLOR;
  context.fillRect(targetX, targetY, tileSize, tileSize);
}

/**
 * Selects Stage 8 tile render mode for one map tile draw.
 * Micropolis C draw flow assumes `GetViewTiles` art resources are available
 * before `MemDrawBeegMapRect` draws tiles (`ref/micropolis/src/sim/g_setup.c`,
 * `ref/micropolis/src/sim/g_bigmap.c`).
 * Parity note: TypeScript adds an explicit diagnostics-only debug renderer flag
 * and keeps missing-atlas fallback separate so debug colors are opt-in only.
 */
export function selectMapCanvasTileRenderMode({
  debugTileRendererEnabled,
  hasAtlasImage,
}: {
  debugTileRendererEnabled: boolean;
  hasAtlasImage: boolean;
}): MapCanvasTileRenderMode {
  if (debugTileRendererEnabled) {
    return 'diagnostic-debug';
  }

  return hasAtlasImage ? 'atlas' : 'missing-atlas';
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

function assertNever(value: never): never {
  throw new Error(`Unexpected map canvas layer "${String(value)}"`);
}
