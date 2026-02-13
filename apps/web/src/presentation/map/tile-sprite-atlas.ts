import {
  type CanonicalImageIdentityKey,
  canonicalSourcePathToDerivedPngPath,
  getDerivedImagePathManifestEntry,
  toCanonicalImageIdentityKey,
} from '../../../../../packages/sim-assets/src/derived-images.ts';
import {
  parseTileSheetHeader,
  TILE_SHEET_HEADERS,
  type TileSheetHeader,
} from '../../../../../packages/sim-assets/src/tiles.ts';
import { Tile, TileMask } from '../../../../../packages/sim-core/src/core/constants.ts';
import { getTileDebugColor, toDrawTileId } from './tile-renderer.ts';

const EDITOR_COLOR_TILE_ATLAS_URL = new URL(
  '../../../../../packages/sim-assets/generated-images/images/tiles.png',
  import.meta.url,
).href;
const EDITOR_MONOCHROME_TILE_ATLAS_URL = new URL(
  '../../../../../packages/sim-assets/generated-images/images/tilesbw.png',
  import.meta.url,
).href;
const MAP_COLOR_TILE_ATLAS_URL = new URL(
  '../../../../../packages/sim-assets/generated-images/images/tilessm.png',
  import.meta.url,
).href;
const FUTURE_USA_TILE_ATLAS_URL = new URL(
  '../../../../../packages/sim-assets/micropoliscore-tilesets/futureusa/tiles.png',
  import.meta.url,
).href;

const EDITOR_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY = toCanonicalImageIdentityKey(
  'ref/micropolis/images/tiles.xpm',
);
const EDITOR_MONOCHROME_TILE_ATLAS_CANONICAL_IDENTITY_KEY = toCanonicalImageIdentityKey(
  'ref/micropolis/images/tilesbw.xpm',
);
const MAP_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY = toCanonicalImageIdentityKey(
  'ref/micropolis/images/tilessm.xpm',
);
const FUTURE_USA_TILE_ATLAS_CANONICAL_IDENTITY_KEY = toCanonicalImageIdentityKey(
  'ref/micropolis/images/tiles-futureusa.xpm',
);

const EDITOR_COLOR_TILE_SHEET_HEADER = parseTileSheetHeader(TILE_SHEET_HEADERS.color);
const EDITOR_MONOCHROME_TILE_SHEET_HEADER = parseTileSheetHeader(TILE_SHEET_HEADERS.monochrome);
const MAP_COLOR_TILE_SHEET_HEADER = parseTileSheetHeader(TILE_SHEET_HEADERS.small);
const FUTURE_USA_TILE_SHEET_HEADER: TileSheetHeader = {
  width: 512,
  height: 480,
  colors: 256,
  charsPerPixel: 1,
};

/**
 * Runtime-selectable map tilesets.
 * Mirrors Micropolis tile-id semantics in `ref/micropolis/src/sim/headers/sim.h`
 * (`TILE_COUNT`, `LOMASK`) while allowing multiple atlas implementations.
 * Parity note: `classic` is 1:1 Micropolis XPM artwork; `futureusa` reuses
 * tile ids but renders through MicropolisCore grid-formatted art.
 */
export type RuntimeTilesetName = 'classic' | 'futureusa';

/**
 * Runtime menu choices for map tileset selection.
 * Mirrors C tile-id behavior from `g_bigmap.c` while adding a browser-only
 * selector over alternate atlas implementations.
 */
export const RUNTIME_TILESET_CHOICES: readonly Readonly<{
  name: RuntimeTilesetName;
  label: string;
}>[] = Object.freeze([
  Object.freeze({ name: 'classic', label: 'Classic' }),
  Object.freeze({ name: 'futureusa', label: 'Future USA' }),
]);

type TileAtlasDerivedPathPolicy =
  | Readonly<{ kind: 'manifest' }>
  | Readonly<{ kind: 'static'; derivedPngPath: string }>;

type TileAtlasLayoutAdapter =
  | Readonly<{ kind: 'vertical-strip' }>
  | Readonly<{ kind: 'grid'; columns: number }>;

interface TileAtlasDefinition {
  readonly canonicalIdentityKey: CanonicalImageIdentityKey;
  readonly spriteSheetUrl: string;
  readonly tileSheetHeader: TileSheetHeader;
  readonly pathPolicy: TileAtlasDerivedPathPolicy;
  readonly sourceTileWidth: number;
  readonly sourceTileHeight: number;
  readonly drawTileWidth: number;
  readonly drawTileHeight: number;
  readonly layout: TileAtlasLayoutAdapter;
}

const TILE_ATLAS_DEFINITIONS: readonly TileAtlasDefinition[] = Object.freeze([
  Object.freeze({
    canonicalIdentityKey: EDITOR_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
    spriteSheetUrl: EDITOR_COLOR_TILE_ATLAS_URL,
    tileSheetHeader: EDITOR_COLOR_TILE_SHEET_HEADER,
    pathPolicy: Object.freeze({ kind: 'manifest' }),
    sourceTileWidth: EDITOR_COLOR_TILE_SHEET_HEADER.width,
    sourceTileHeight: EDITOR_COLOR_TILE_SHEET_HEADER.height / Tile.TILE_COUNT,
    drawTileWidth: EDITOR_COLOR_TILE_SHEET_HEADER.width,
    drawTileHeight: EDITOR_COLOR_TILE_SHEET_HEADER.height / Tile.TILE_COUNT,
    layout: Object.freeze({ kind: 'vertical-strip' }),
  }),
  Object.freeze({
    canonicalIdentityKey: EDITOR_MONOCHROME_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
    spriteSheetUrl: EDITOR_MONOCHROME_TILE_ATLAS_URL,
    tileSheetHeader: EDITOR_MONOCHROME_TILE_SHEET_HEADER,
    pathPolicy: Object.freeze({ kind: 'manifest' }),
    sourceTileWidth: EDITOR_MONOCHROME_TILE_SHEET_HEADER.width,
    sourceTileHeight: EDITOR_MONOCHROME_TILE_SHEET_HEADER.height / Tile.TILE_COUNT,
    drawTileWidth: EDITOR_MONOCHROME_TILE_SHEET_HEADER.width,
    drawTileHeight: EDITOR_MONOCHROME_TILE_SHEET_HEADER.height / Tile.TILE_COUNT,
    layout: Object.freeze({ kind: 'vertical-strip' }),
  }),
  Object.freeze({
    canonicalIdentityKey: MAP_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
    spriteSheetUrl: MAP_COLOR_TILE_ATLAS_URL,
    tileSheetHeader: MAP_COLOR_TILE_SHEET_HEADER,
    pathPolicy: Object.freeze({ kind: 'manifest' }),
    sourceTileWidth: MAP_COLOR_TILE_SHEET_HEADER.width,
    sourceTileHeight: MAP_COLOR_TILE_SHEET_HEADER.height / Tile.TILE_COUNT,
    // `GetViewTiles` in `g_setup.c` documents small-map tiles as
    // "4 pixels wide per 3 pixel wide tile"; the 4th column is spacing.
    drawTileWidth: 3,
    drawTileHeight: MAP_COLOR_TILE_SHEET_HEADER.height / Tile.TILE_COUNT,
    layout: Object.freeze({ kind: 'vertical-strip' }),
  }),
  Object.freeze({
    canonicalIdentityKey: FUTURE_USA_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
    spriteSheetUrl: FUTURE_USA_TILE_ATLAS_URL,
    tileSheetHeader: FUTURE_USA_TILE_SHEET_HEADER,
    pathPolicy: Object.freeze({
      kind: 'static',
      derivedPngPath: 'packages/sim-assets/micropoliscore-tilesets/futureusa/tiles.png',
    }),
    sourceTileWidth: 16,
    sourceTileHeight: 16,
    drawTileWidth: 16,
    drawTileHeight: 16,
    // MicropolisCore `resources/tilesets/*/tiles.bmp` stores 960 tiles in
    // 32x30 grid form (512x480 pixels at 16x16 per tile).
    layout: Object.freeze({ kind: 'grid', columns: 32 }),
  }),
]);

const RUNTIME_TILESET_BASE_ATLAS_CANONICAL_IDENTITY_KEY = Object.freeze<
  Record<RuntimeTilesetName, CanonicalImageIdentityKey>
>({
  classic: EDITOR_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
  futureusa: FUTURE_USA_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
});

const TILE_NAME_TO_ID = createTileNameToId();
const TILE_ID_TO_NAME = createTileIdToName();

/**
 * `GetViewTiles` class branches that select tile art sources in Micropolis.
 * Mirrors `Editor_Class` and `Map_Class` in `ref/micropolis/src/sim/g_setup.c`
 * (1:1 branch names normalized to lowercase string literals).
 */
export type MicropolisTileSheetViewClass = 'editor' | 'map';

/**
 * Canonical key for the Micropolis color tile atlas source image.
 * Mirrors tile-sheet identity loaded by `GetViewTiles` in
 * `ref/micropolis/src/sim/g_setup.c` (`tiles.xpm`).
 */
export const DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY =
  EDITOR_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY;

/**
 * Canonical key for the Future USA MicropolisCore atlas source image.
 * Mirrors tile-id semantics from `sim.h` while adapting to MicropolisCore's
 * `resources/tilesets/futureusa/tiles.bmp` atlas layout (32x30 grid).
 * Parity note: key is TypeScript-only identity for non-XPM art.
 */
export const FUTURE_USA_TILE_ATLAS_DEFAULT_CANONICAL_IDENTITY_KEY =
  FUTURE_USA_TILE_ATLAS_CANONICAL_IDENTITY_KEY;

/**
 * Canonical identity keys for supported Sprite Atlas tile atlases.
 * Mirrors XPM-backed `GetViewTiles` sources from
 * `ref/micropolis/src/sim/g_setup.c` and extends with one MicropolisCore
 * grid-backed runtime atlas.
 */
export const TILE_ATLAS_CANONICAL_IDENTITY_KEYS: readonly CanonicalImageIdentityKey[] =
  Object.freeze(TILE_ATLAS_DEFINITIONS.map((atlas) => atlas.canonicalIdentityKey));

/**
 * Resolve canonical Micropolis tile-sheet identity by view class + color mode.
 * Mirrors `GetViewTiles` filename selection in `ref/micropolis/src/sim/g_setup.c`.
 * Parity note: this remains 1:1 only for XPM-backed branches (`tiles.xpm`,
 * `tilesbw.xpm`, `tilessm.xpm`); MicropolisCore tilesets are selected via
 * runtime tileset helpers.
 */
export function resolveMicropolisTileSheetCanonicalIdentityKey({
  viewClass,
  color,
}: Readonly<{
  viewClass: MicropolisTileSheetViewClass;
  color: boolean;
}>): CanonicalImageIdentityKey | undefined {
  if (viewClass === 'editor') {
    return color
      ? EDITOR_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY
      : EDITOR_MONOCHROME_TILE_ATLAS_CANONICAL_IDENTITY_KEY;
  }

  return color ? MAP_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY : undefined;
}

/**
 * Resolve base atlas identity key for one runtime tileset selection.
 * Mirrors C tile-id ownership in `g_bigmap.c` while adding a UI-selectable
 * atlas source indirection in TypeScript.
 */
export function resolveRuntimeTilesetBaseAtlasCanonicalIdentityKey(
  tilesetName: RuntimeTilesetName,
): CanonicalImageIdentityKey {
  return RUNTIME_TILESET_BASE_ATLAS_CANONICAL_IDENTITY_KEY[tilesetName];
}

/**
 * Resolve a tile id from a stable tile name.
 * Mirrors tile id symbols in `ref/micropolis/src/sim/headers/sim.h`
 * and returns `undefined` for unknown names.
 * Parity note: supports case-insensitive names and strips separators for
 * browser/runtime ergonomics (`road_base`, `ROADBASE`, `road-base`).
 */
export function resolveTileIdByName(tileName: string): number | undefined {
  const normalizedTileName = normalizeTileNameKey(tileName);
  if (normalizedTileName.length === 0) {
    return undefined;
  }
  return TILE_NAME_TO_ID.get(normalizedTileName);
}

/**
 * Resolve one human-readable tile name for a tile id.
 * Mirrors C symbol identity for named constants in `sim.h`; unknown ids are
 * rendered as `TILE_<id>` fallback labels.
 */
export function resolveTileNameById(tileId: number): string {
  const normalizedTileId = normalizeTileIdForLookup(tileId);
  return TILE_ID_TO_NAME.get(normalizedTileId) ?? `TILE_${normalizedTileId}`;
}

/**
 * One Sprite Atlas base-map atlas source, keyed by canonical Micropolis image id.
 * Mirrors tile-sheet identity ownership from `GetViewTiles` in
 * `ref/micropolis/src/sim/g_setup.c`.
 * Parity note: TypeScript adds `spriteSheetUrl` as a browser asset handle for
 * canonical XPM sheets and MicropolisCore grid-backed overlays.
 */
export interface TileAtlasSource {
  readonly canonicalIdentityKey: CanonicalImageIdentityKey;
  readonly derivedPngPath: string;
  readonly spriteSheetUrl: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly tileCount: number;
}

/**
 * Cached tile-id sprite rectangle and deterministic debug fallback color.
 * Mirrors draw-time tile id lookup in `MemDrawBeegMapRect` from
 * `ref/micropolis/src/sim/g_bigmap.c` (`tile & LOMASK`, wrapped into base page).
 * Parity note: fallback color is TypeScript-only diagnostics and has no C
 * visual equivalent; it stays deterministic for replay/debug usage.
 */
export interface TileSpriteLookup {
  readonly atlasCanonicalIdentityKey: CanonicalImageIdentityKey;
  readonly tileId: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly debugFallbackColor: string;
}

/**
 * Draw-time options for Sprite Atlas tile-to-sprite lookup.
 * Mirrors `flagBlink <= 0` handling in `MemDrawBeegMapRect` from
 * `ref/micropolis/src/sim/g_bigmap.c` for lightning-bolt substitution.
 */
export interface TileSpriteLookupOptions {
  readonly atlasCanonicalIdentityKey?: CanonicalImageIdentityKey;
  readonly blinkUnpoweredZoneCenter?: boolean;
}

/**
 * Lookup one Sprite Atlas tile sprite rectangle from a tile id value.
 * Mirrors `MemDrawBeegMapRect`/`WireDrawBeegMapRect` draw-time id normalization
 * in `ref/micropolis/src/sim/g_bigmap.c`:
 * `(tile & LOMASK)`, then wrap `[TILE_COUNT, 1023]` by subtracting `TILE_COUNT`.
 * Parity note: unlike `lookupTileSprite`, this helper does not apply the
 * blink-phase unpowered-zone `LIGHTNINGBOLT` substitution.
 */
export function lookupTileSpriteRectByTileId(
  tileId: number,
  options: Readonly<{ atlasCanonicalIdentityKey?: CanonicalImageIdentityKey }> = {},
): TileSpriteLookup {
  const atlasCanonicalIdentityKey =
    options.atlasCanonicalIdentityKey ?? DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY;
  const normalizedTileId = normalizeTileIdForLookup(tileId);
  const lookupForAtlas = getTileSpriteLookupForAtlas(atlasCanonicalIdentityKey);
  const cached = lookupForAtlas[normalizedTileId];
  assertDefined(
    cached,
    `Missing Sprite Atlas tile sprite lookup row for normalized tile id ${normalizedTileId}`,
  );
  return cached;
}

/**
 * Lookup one Sprite Atlas tile sprite rectangle from a tile name.
 * Mirrors C tile-id draw lookup in `g_bigmap.c` after converting symbolic
 * names to ids.
 * Parity note: name resolution is TypeScript-only ergonomics; C always draws
 * from numeric tile ids.
 */
export function lookupTileSpriteRectByTileName(
  tileName: string,
  options: Readonly<{ atlasCanonicalIdentityKey?: CanonicalImageIdentityKey }> = {},
): TileSpriteLookup | undefined {
  const tileId = resolveTileIdByName(tileName);
  if (tileId === undefined) {
    return undefined;
  }
  return lookupTileSpriteRectByTileId(tileId, options);
}

/**
 * Explicit env flag helper for retaining debug tile diagnostics in Sprite Atlas.
 * This has no direct C equivalent in Micropolis; it is a TypeScript-only
 * diagnostics switch layered over the Sprite Atlas sprite renderer.
 */
export function isDebugTileRendererEnabled(
  env: Readonly<{ VITE_DEBUG_TILE_RENDERER?: string }> = import.meta.env,
): boolean {
  const raw = env.VITE_DEBUG_TILE_RENDERER;
  if (raw === undefined) {
    return false;
  }

  return raw === '1' || raw.toLowerCase() === 'true';
}

/**
 * Lookup one Sprite Atlas tile sprite rectangle from an authoritative tile word.
 * Mirrors Micropolis draw-time masking in `MemDrawBeegMapRect` from
 * `ref/micropolis/src/sim/g_bigmap.c` and animation flag masking flow from
 * `ref/micropolis/src/sim/g_ani.c`.
 * Parity note: rectangle lookup is deterministic and keyed by canonical
 * tile atlas identity with browser-specific atlas coordinates.
 */
export function lookupTileSprite(
  tileWord: number,
  options: TileSpriteLookupOptions = {},
): TileSpriteLookup {
  const tileId = toDrawTileId(tileWord, {
    blinkUnpoweredZoneCenter: options.blinkUnpoweredZoneCenter,
  });
  return lookupTileSpriteRectByTileId(tileId, {
    atlasCanonicalIdentityKey: options.atlasCanonicalIdentityKey,
  });
}

/**
 * Resolve Sprite Atlas metadata by canonical image identity key.
 * Mirrors canonical image identity lookup behavior from
 * `ref/micropolis/src/sim/g_setup.c` (`tiles.xpm` file identity).
 * Parity note: TypeScript additionally supports non-XPM runtime overlays (for
 * example MicropolisCore BMP-derived atlases) behind canonical-style keys.
 */
export function getTileAtlasSourceByCanonicalIdentityKey(
  canonicalIdentityKey: CanonicalImageIdentityKey,
): TileAtlasSource | undefined {
  return TILE_ATLAS_SOURCE_BY_CANONICAL_IDENTITY_KEY.get(canonicalIdentityKey);
}

/**
 * Build deterministic tile-name-to-id map from exported `Tile` constants.
 * Mirrors named tile constants in `ref/micropolis/src/sim/headers/sim.h`.
 * Parity note: this map includes only named constants; unnamed ids still draw
 * correctly via numeric lookups.
 */
function createTileNameToId(): ReadonlyMap<string, number> {
  const nameToId = new Map<string, number>();
  for (const [tileName, tileIdCandidate] of Object.entries(Tile)) {
    if (tileName === 'TILE_COUNT') {
      continue;
    }
    if (!Number.isInteger(tileIdCandidate)) {
      continue;
    }
    const tileId = Number(tileIdCandidate);
    if (tileId < 0 || tileId >= Tile.TILE_COUNT) {
      continue;
    }
    nameToId.set(normalizeTileNameKey(tileName), tileId);
  }
  return nameToId;
}

/**
 * Build deterministic tile-id-to-name map from exported `Tile` constants.
 * Mirrors symbolic names from `sim.h`, preserving first-writer name stability.
 */
function createTileIdToName(): ReadonlyMap<number, string> {
  const idToName = new Map<number, string>();
  for (const [tileName, tileIdCandidate] of Object.entries(Tile)) {
    if (tileName === 'TILE_COUNT') {
      continue;
    }
    if (!Number.isInteger(tileIdCandidate)) {
      continue;
    }
    const tileId = Number(tileIdCandidate);
    if (tileId < 0 || tileId >= Tile.TILE_COUNT || idToName.has(tileId)) {
      continue;
    }
    idToName.set(tileId, tileName);
  }
  return idToName;
}

/**
 * Normalize a tile name token to a stable lookup key.
 * No direct C equivalent: TypeScript-only convenience normalization for
 * menu/input workflows (`ROAD_BASE`, `road-base`, `roadbase`).
 */
function normalizeTileNameKey(tileName: string): string {
  return tileName.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Resolve one derived PNG path from atlas path policy.
 * Mirrors canonical XPM path identity from `g_setup.c` for manifest-backed
 * entries; static policy is TypeScript-only for imported non-XPM assets.
 */
function resolveDerivedPngPath(definition: TileAtlasDefinition): string | undefined {
  if (definition.pathPolicy.kind === 'manifest') {
    const expectedDerivedPngPath = canonicalSourcePathToDerivedPngPath(
      definition.canonicalIdentityKey,
    );
    const manifestEntry = getDerivedImagePathManifestEntry(definition.canonicalIdentityKey);
    if (manifestEntry?.derivedPngPath !== expectedDerivedPngPath) {
      return undefined;
    }
    return manifestEntry.derivedPngPath;
  }

  return definition.pathPolicy.derivedPngPath;
}

/**
 * Validate that one atlas definition can address all `TILE_COUNT` ids.
 * Mirrors `TILE_COUNT` page lookup ownership in `g_bigmap.c` while handling
 * multiple atlas layout implementations.
 */
function hasAddressableTileLayout(definition: TileAtlasDefinition): boolean {
  const { tileSheetHeader, sourceTileWidth, sourceTileHeight, layout } = definition;
  if (sourceTileWidth <= 0 || sourceTileHeight <= 0) {
    return false;
  }

  if (layout.kind === 'vertical-strip') {
    return (
      tileSheetHeader.width === sourceTileWidth &&
      tileSheetHeader.height === sourceTileHeight * Tile.TILE_COUNT
    );
  }

  const columns = Math.trunc(layout.columns);
  if (columns <= 0 || tileSheetHeader.width !== sourceTileWidth * columns) {
    return false;
  }

  if (tileSheetHeader.height % sourceTileHeight !== 0) {
    return false;
  }

  const rows = tileSheetHeader.height / sourceTileHeight;
  return rows * columns >= Tile.TILE_COUNT;
}

function createTileAtlasSourceByCanonicalIdentityKey(): ReadonlyMap<
  CanonicalImageIdentityKey,
  TileAtlasSource
> {
  const atlasSourceByCanonicalIdentityKey = new Map<CanonicalImageIdentityKey, TileAtlasSource>();
  for (const definition of TILE_ATLAS_DEFINITIONS) {
    if (!hasAddressableTileLayout(definition)) {
      continue;
    }

    const derivedPngPath = resolveDerivedPngPath(definition);
    if (derivedPngPath === undefined) {
      continue;
    }

    atlasSourceByCanonicalIdentityKey.set(
      definition.canonicalIdentityKey,
      Object.freeze<TileAtlasSource>({
        canonicalIdentityKey: definition.canonicalIdentityKey,
        derivedPngPath,
        spriteSheetUrl: definition.spriteSheetUrl,
        tileWidth: definition.sourceTileWidth,
        tileHeight: definition.sourceTileHeight,
        tileCount: Tile.TILE_COUNT,
      }),
    );
  }

  return atlasSourceByCanonicalIdentityKey;
}

/**
 * Project one normalized tile id into source-atlas coordinates.
 * Mirrors `tile id -> sprite` lookup ownership in `g_bigmap.c`, extended to
 * support both Micropolis strip and MicropolisCore grid atlas layouts.
 */
function projectTileSourceRect(
  tileId: number,
  definition: TileAtlasDefinition,
): Readonly<{
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
}> {
  if (definition.layout.kind === 'vertical-strip') {
    return {
      sourceX: 0,
      sourceY: tileId * definition.sourceTileHeight,
      sourceWidth: definition.drawTileWidth,
      sourceHeight: definition.drawTileHeight,
    };
  }

  const columns = definition.layout.columns;
  return {
    sourceX: (tileId % columns) * definition.sourceTileWidth,
    sourceY: Math.trunc(tileId / columns) * definition.sourceTileHeight,
    sourceWidth: definition.drawTileWidth,
    sourceHeight: definition.drawTileHeight,
  };
}

function createTileSpriteLookupByCanonicalIdentityKey(): ReadonlyMap<
  CanonicalImageIdentityKey,
  readonly TileSpriteLookup[]
> {
  const lookupsByCanonicalIdentityKey = new Map<
    CanonicalImageIdentityKey,
    readonly TileSpriteLookup[]
  >();

  for (const definition of TILE_ATLAS_DEFINITIONS) {
    if (!hasAddressableTileLayout(definition)) {
      continue;
    }

    const lookup: TileSpriteLookup[] = new Array(Tile.TILE_COUNT);
    for (let tileId = 0; tileId < Tile.TILE_COUNT; tileId += 1) {
      const sourceRect = projectTileSourceRect(tileId, definition);
      lookup[tileId] = Object.freeze({
        atlasCanonicalIdentityKey: definition.canonicalIdentityKey,
        tileId,
        sourceX: sourceRect.sourceX,
        sourceY: sourceRect.sourceY,
        sourceWidth: sourceRect.sourceWidth,
        sourceHeight: sourceRect.sourceHeight,
        debugFallbackColor: getTileDebugColor(tileId),
      });
    }

    lookupsByCanonicalIdentityKey.set(definition.canonicalIdentityKey, Object.freeze(lookup));
  }

  return lookupsByCanonicalIdentityKey;
}

function getTileSpriteLookupForAtlas(
  atlasCanonicalIdentityKey: CanonicalImageIdentityKey,
): readonly TileSpriteLookup[] {
  const lookupForAtlas =
    TILE_SPRITE_LOOKUP_BY_CANONICAL_IDENTITY_KEY.get(atlasCanonicalIdentityKey) ??
    TILE_SPRITE_LOOKUP_BY_CANONICAL_IDENTITY_KEY.get(DEFAULT_TILE_ATLAS_CANONICAL_IDENTITY_KEY);
  assertDefined(
    lookupForAtlas,
    `Missing Sprite Atlas tile sprite lookup table for atlas "${atlasCanonicalIdentityKey}"`,
  );
  return lookupForAtlas;
}

/**
 * Normalizes one tile id candidate into the Sprite Atlas lookup page.
 * Mirrors draw-time id selection in `MemDrawBeegMapRect` / `WireDrawBeegMapRect`
 * from `ref/micropolis/src/sim/g_bigmap.c`: interpret tile words as 16-bit,
 * mask with `LOMASK`, then wrap `[TILE_COUNT, 1023]` by subtracting `TILE_COUNT`.
 * Parity note: this is a 1:1 C lookup-id normalization port used by the
 * TypeScript tile-id to sprite-rect path.
 */
function normalizeTileIdForLookup(tileId: number): number {
  const maskedTileId = tileId & 0xffff & TileMask.LOMASK;
  return maskedTileId >= Tile.TILE_COUNT ? maskedTileId - Tile.TILE_COUNT : maskedTileId;
}

function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
}

const TILE_ATLAS_SOURCE_BY_CANONICAL_IDENTITY_KEY = createTileAtlasSourceByCanonicalIdentityKey();
const TILE_SPRITE_LOOKUP_BY_CANONICAL_IDENTITY_KEY = createTileSpriteLookupByCanonicalIdentityKey();
