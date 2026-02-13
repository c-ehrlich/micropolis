import type { RuntimeRealtimeObject } from '../../game/runtime/realtime-state.ts';
import { lookupObjectSpriteFrame } from './object-sprite-atlas.ts';
import type { RuntimeTilesetName } from './tile-sprite-atlas.ts';

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
  renderFilterCss?: string;
  spriteFrameUrl?: string;
  spriteSheetUrl?: string;
  spriteSheetPixelWidth?: number;
  spriteSheetPixelHeight?: number;
  sourceX?: number;
  sourceY?: number;
  sourceWidth?: number;
  sourceHeight?: number;
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
  tilesetName = 'classic',
}: {
  objects: readonly RuntimeRealtimeObject[];
  tileSize: number;
  mapWidth: number;
  mapHeight: number;
  tilesetName?: RuntimeTilesetName;
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
      tilesetName,
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
      renderFilterCss: spriteFrame?.renderFilterCss,
      spriteFrameUrl: spriteFrame?.spriteFrameUrl,
      spriteSheetUrl: spriteFrame?.spriteSheetUrl,
      spriteSheetPixelWidth: spriteFrame?.spriteSheetPixelWidth,
      spriteSheetPixelHeight: spriteFrame?.spriteSheetPixelHeight,
      sourceX: spriteFrame?.sourceX,
      sourceY: spriteFrame?.sourceY,
      sourceWidth: spriteFrame?.sourceWidth,
      sourceHeight: spriteFrame?.sourceHeight,
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
