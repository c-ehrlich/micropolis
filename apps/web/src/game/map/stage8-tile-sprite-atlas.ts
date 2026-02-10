import {
  type CanonicalImageIdentityKey,
  getDerivedImagePathManifestEntry,
  toCanonicalImageIdentityKey,
} from '../../../../../packages/sim-assets/src/derived-images.ts';
import {
  parseTileSheetHeader,
  TILE_SHEET_HEADERS,
} from '../../../../../packages/sim-assets/src/tiles.ts';
import { Tile } from '../../../../../packages/sim-core/src/core/constants.ts';
import { getStage4TileDebugColor, toStage4DrawTileId } from './stage4-tile-renderer.ts';

const STAGE8_TILE_ATLAS_DERIVED_PNG_PATH = 'packages/sim-assets/generated-images/images/tiles.png';
const STAGE8_TILE_ATLAS_IMPORT_PATH =
  '../../../../../packages/sim-assets/generated-images/images/tiles.png';

const COLOR_TILE_SHEET_HEADER = parseTileSheetHeader(TILE_SHEET_HEADERS.color);

const STAGE8_TILE_ATLAS_TILE_WIDTH = COLOR_TILE_SHEET_HEADER.width;
const STAGE8_TILE_ATLAS_TILE_HEIGHT = COLOR_TILE_SHEET_HEADER.height / Tile.TILE_COUNT;
const STAGE8_TILE_ATLAS_ROW_COUNT = Math.trunc(
  COLOR_TILE_SHEET_HEADER.height / STAGE8_TILE_ATLAS_TILE_HEIGHT,
);
const STAGE8_EDITOR_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY = toCanonicalImageIdentityKey(
  'ref/micropolis/images/tiles.xpm',
);
const STAGE8_EDITOR_MONOCHROME_TILE_ATLAS_CANONICAL_IDENTITY_KEY = toCanonicalImageIdentityKey(
  'ref/micropolis/images/tilesbw.xpm',
);
const STAGE8_MAP_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY = toCanonicalImageIdentityKey(
  'ref/micropolis/images/tilessm.xpm',
);

/**
 * `GetViewTiles` class branches that select tile art sources in Micropolis.
 * Mirrors `Editor_Class` and `Map_Class` in `ref/micropolis/src/sim/g_setup.c`
 * (1:1 branch names normalized to lowercase string literals).
 */
export type Stage8MicropolisTileSheetViewClass = 'editor' | 'map';

/**
 * Canonical key for the Micropolis color tile atlas source image.
 * Mirrors tile-sheet identity loaded by `GetViewTiles` in
 * `ref/micropolis/src/sim/g_setup.c` (`tiles.xpm`).
 */
export const STAGE8_TILE_ATLAS_CANONICAL_IDENTITY_KEY =
  STAGE8_EDITOR_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY;

/**
 * Resolve canonical Micropolis tile-sheet identity by view class + color mode.
 * Mirrors `GetViewTiles` filename selection in `ref/micropolis/src/sim/g_setup.c`.
 * Parity note: this is 1:1 for XPM-backed branches (`tiles.xpm`, `tilesbw.xpm`,
 * `tilessm.xpm`). Map-class monochrome in C uses `MickGetHexa(SIM_GSMTILE)`
 * (non-XPM resource bytes), so TypeScript returns `undefined` for that branch.
 */
export function resolveStage8MicropolisTileSheetCanonicalIdentityKey({
  viewClass,
  color,
}: Readonly<{
  viewClass: Stage8MicropolisTileSheetViewClass;
  color: boolean;
}>): CanonicalImageIdentityKey | undefined {
  if (viewClass === 'editor') {
    return color
      ? STAGE8_EDITOR_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY
      : STAGE8_EDITOR_MONOCHROME_TILE_ATLAS_CANONICAL_IDENTITY_KEY;
  }

  return color ? STAGE8_MAP_COLOR_TILE_ATLAS_CANONICAL_IDENTITY_KEY : undefined;
}

/**
 * One Stage 8 base-map atlas source, keyed by canonical Micropolis image id.
 * Mirrors tile-sheet identity ownership from `GetViewTiles` in
 * `ref/micropolis/src/sim/g_setup.c`.
 * Parity note: TypeScript adds `spriteSheetUrl` as a browser asset handle for
 * the same canonical tile sheet (`tiles.xpm` -> derived `tiles.png`).
 */
export interface Stage8TileAtlasSource {
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
export interface Stage8TileSpriteLookup {
  readonly atlasCanonicalIdentityKey: CanonicalImageIdentityKey;
  readonly tileId: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly debugFallbackColor: string;
}

/**
 * Draw-time options for Stage 8 tile-to-sprite lookup.
 * Mirrors `flagBlink <= 0` handling in `MemDrawBeegMapRect` from
 * `ref/micropolis/src/sim/g_bigmap.c` for lightning-bolt substitution.
 */
export interface Stage8TileSpriteLookupOptions {
  readonly blinkUnpoweredZoneCenter?: boolean;
}

/**
 * Explicit env flag helper for retaining debug tile diagnostics in Stage 8.
 * This has no direct C equivalent in Micropolis; it is a TypeScript-only
 * diagnostics switch layered over the Stage 8 sprite renderer.
 */
export function isStage4DebugTileRendererEnabled(
  env: Readonly<{ VITE_STAGE4_DEBUG_TILE_RENDERER?: string }> = import.meta.env,
): boolean {
  const raw = env.VITE_STAGE4_DEBUG_TILE_RENDERER;
  if (raw === undefined) {
    return false;
  }

  return raw === '1' || raw.toLowerCase() === 'true';
}

/**
 * Lookup one Stage 8 tile sprite rectangle from an authoritative tile word.
 * Mirrors Micropolis draw-time masking in `MemDrawBeegMapRect` from
 * `ref/micropolis/src/sim/g_bigmap.c` and animation flag masking flow from
 * `ref/micropolis/src/sim/g_ani.c`.
 * Parity note: rectangle lookup is deterministic and keyed by canonical
 * `tiles.xpm` identity; this is a 1:1 tile-id draw relationship port with
 * browser-specific atlas coordinates.
 */
export function lookupStage8TileSprite(
  tileWord: number,
  options: Stage8TileSpriteLookupOptions = {},
): Stage8TileSpriteLookup {
  const tileId = toStage4DrawTileId(tileWord, {
    blinkUnpoweredZoneCenter: options.blinkUnpoweredZoneCenter,
  });
  const cached = STAGE8_TILE_SPRITE_LOOKUP_BY_TILE_ID[tileId];
  assertDefined(cached, `Missing Stage 8 tile sprite lookup row for tile id ${tileId}`);
  return cached;
}

/**
 * Resolve Stage 8 atlas metadata by canonical image identity key.
 * Mirrors canonical image identity lookup behavior from
 * `ref/micropolis/src/sim/g_setup.c` (`tiles.xpm` file identity).
 * Parity note: returns `undefined` when derived PNG metadata drifts, forcing
 * deterministic debug fallback rather than nondeterministic missing-art draws.
 */
export function getStage8TileAtlasSourceByCanonicalIdentityKey(
  canonicalIdentityKey: CanonicalImageIdentityKey,
): Stage8TileAtlasSource | undefined {
  return STAGE8_TILE_ATLAS_SOURCE_BY_CANONICAL_IDENTITY_KEY.get(canonicalIdentityKey);
}

function createStage8TileAtlasSourceByCanonicalIdentityKey(): ReadonlyMap<
  CanonicalImageIdentityKey,
  Stage8TileAtlasSource
> {
  const manifestEntry = getDerivedImagePathManifestEntry(STAGE8_TILE_ATLAS_CANONICAL_IDENTITY_KEY);
  if (
    manifestEntry?.derivedPngPath !== STAGE8_TILE_ATLAS_DERIVED_PNG_PATH ||
    STAGE8_TILE_ATLAS_ROW_COUNT !== Tile.TILE_COUNT
  ) {
    return new Map();
  }

  const source = Object.freeze<Stage8TileAtlasSource>({
    canonicalIdentityKey: STAGE8_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
    derivedPngPath: manifestEntry.derivedPngPath,
    spriteSheetUrl: new URL(STAGE8_TILE_ATLAS_IMPORT_PATH, import.meta.url).href,
    tileWidth: STAGE8_TILE_ATLAS_TILE_WIDTH,
    tileHeight: STAGE8_TILE_ATLAS_TILE_HEIGHT,
    tileCount: Tile.TILE_COUNT,
  });

  return new Map<CanonicalImageIdentityKey, Stage8TileAtlasSource>([
    [STAGE8_TILE_ATLAS_CANONICAL_IDENTITY_KEY, source],
  ]);
}

function createStage8TileSpriteLookupByTileId(): readonly Stage8TileSpriteLookup[] {
  const lookup: Stage8TileSpriteLookup[] = new Array(Tile.TILE_COUNT);
  for (let tileId = 0; tileId < Tile.TILE_COUNT; tileId += 1) {
    lookup[tileId] = Object.freeze({
      atlasCanonicalIdentityKey: STAGE8_TILE_ATLAS_CANONICAL_IDENTITY_KEY,
      tileId,
      sourceX: 0,
      sourceY: tileId * STAGE8_TILE_ATLAS_TILE_HEIGHT,
      sourceWidth: STAGE8_TILE_ATLAS_TILE_WIDTH,
      sourceHeight: STAGE8_TILE_ATLAS_TILE_HEIGHT,
      debugFallbackColor: getStage4TileDebugColor(tileId),
    });
  }
  return Object.freeze(lookup);
}

function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
}

const STAGE8_TILE_ATLAS_SOURCE_BY_CANONICAL_IDENTITY_KEY =
  createStage8TileAtlasSourceByCanonicalIdentityKey();
const STAGE8_TILE_SPRITE_LOOKUP_BY_TILE_ID = createStage8TileSpriteLookupByTileId();
