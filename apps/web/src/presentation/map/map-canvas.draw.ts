import type { CanonicalImageIdentityKey } from '../../../../../packages/sim-assets/src/derived-images.ts';
import type { RuntimeMapState } from '../../game/runtime/map-state.ts';
import { lookupTileSprite } from './tile-sprite-atlas.ts';

type MapCanvasDrawProc = (
  context: CanvasRenderingContext2D,
  mapState: RuntimeMapState,
  tileSize: number,
  tileRenderer: MapCanvasTileRenderer,
) => void;

type MapCanvasLayer = 'map' | 'pending-tool' | 'realtime-overlay' | 'tool-cursor';

export interface MapCanvasTileRenderer {
  baseTileAtlasCanonicalIdentityKey: CanonicalImageIdentityKey;
  blinkUnpoweredZoneCenter: boolean;
  tileAtlasImagesByCanonicalIdentityKey: ReadonlyMap<CanonicalImageIdentityKey, HTMLImageElement>;
}

/**
 * Queued authoritative map frame consumed by one browser paint.
 * Mirrors Micropolis map-view ownership where one `DoUpdateMap` pass paints
 * from the latest invalidated map state in `ref/micropolis/src/sim/w_map.c`.
 * Parity note: this payload exists only to coalesce browser paints and does
 * not change authority ordering or map mutation semantics.
 */
export interface MapCanvasRenderFrame {
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
export function drawMapCanvasFrame({
  canvas,
  frame,
  lastRenderedEpoch,
  lastRenderedBlinkUnpoweredZoneCenter,
}: {
  canvas: HTMLCanvasElement | null;
  frame: MapCanvasRenderFrame;
  lastRenderedEpoch: number;
  lastRenderedBlinkUnpoweredZoneCenter: boolean | null;
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
    blinkPhaseChanged:
      lastRenderedBlinkUnpoweredZoneCenter !== null &&
      frame.tileRenderer.blinkUnpoweredZoneCenter !== lastRenderedBlinkUnpoweredZoneCenter,
  });
  MAP_CANVAS_DRAW_PROCS[drawMode](context, frame.mapState, frame.tileSize, frame.tileRenderer);
  return frame.mapState.renderEpoch;
}

type MapCanvasTileRenderMode = 'atlas' | 'missing-atlas';
const MAP_CANVAS_MISSING_TILE_ATLAS_COLOR = '#111827';

/**
 * Returns deterministic DOM stacking order for Authoritative Runtime map layers.
 * Mirrors `DoUpdateEditor` draw order in `ref/micropolis/src/sim/w_editor.c`:
 * `MemDrawBeegMapRect` base map, then `DrawPending`, then `DrawObjects`,
 * and finally `DrawCursor`.
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
    case 'tool-cursor':
      return 3;
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
  blinkPhaseChanged = false,
}: {
  mapDrawMode: RuntimeMapState['drawMode'];
  renderEpoch: number;
  lastRenderedEpoch: number;
  resized: boolean;
  blinkPhaseChanged?: boolean;
}): RuntimeMapState['drawMode'] {
  if (mapDrawMode === 'snapshot' || resized || lastRenderedEpoch === 0 || blinkPhaseChanged) {
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
    blinkUnpoweredZoneCenter: tileRenderer.blinkUnpoweredZoneCenter,
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

function assertNever(value: never): never {
  throw new Error(`Unexpected map canvas layer "${String(value)}"`);
}
