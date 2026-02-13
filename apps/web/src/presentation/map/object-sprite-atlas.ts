import {
  type CanonicalImageIdentityKey,
  canonicalSourcePathToDerivedPngPath,
  toCanonicalImageIdentityKey,
} from '../../../../../packages/sim-assets/src/derived-images.ts';
import {
  resolveMicropolisCoreTilesetDirectoryName,
  type RuntimeTilesetName,
} from './tile-sprite-atlas.ts';

const OBJECT_SPRITE_FRAME_MODULE_PATH_PATTERN = /\/obj(\d+)-(\d+)\.png$/;
const OBJECT_SPRITE_FRAME_MODULES = import.meta.glob(
  '../../../../../packages/sim-assets/generated-images/images/obj*-*.png',
  {
    eager: true,
    import: 'default',
  },
) as Record<string, string>;
const MICROPOLISCORE_OBJECT_SPRITE_SHEET_MODULES = import.meta.glob(
  '../../../../../packages/sim-assets/micropoliscore-tilesets/*/*.png',
  {
    eager: true,
    import: 'default',
  },
) as Record<string, string>;

const MICROPOLISCORE_OBJECT_SPRITE_ASSET_BASENAMES = Object.freeze([
  'train',
  'chopper',
  'plane',
  'ship',
  'monster',
  'tornado',
  'explode',
] as const);
type MicropolisCoreObjectSpriteAssetBasename =
  (typeof MICROPOLISCORE_OBJECT_SPRITE_ASSET_BASENAMES)[number];

interface MicropolisCoreObjectSpriteSheetSpec {
  readonly assetBasename: MicropolisCoreObjectSpriteAssetBasename;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly defaultFrameCount: number;
}

const MICROPOLISCORE_OBJECT_SPRITE_SHEET_SPEC_BY_TYPE = Object.freeze<
  Readonly<Record<number, MicropolisCoreObjectSpriteSheetSpec>>
>({
  // Mirrors object dimensions from `InitSprite` in `ref/micropolis/src/sim/w_sprite.c`.
  1: Object.freeze({
    assetBasename: 'train',
    frameWidth: 32,
    frameHeight: 32,
    defaultFrameCount: 9,
  }),
  2: Object.freeze({
    assetBasename: 'chopper',
    frameWidth: 32,
    frameHeight: 32,
    defaultFrameCount: 8,
  }),
  3: Object.freeze({
    assetBasename: 'plane',
    frameWidth: 48,
    frameHeight: 48,
    defaultFrameCount: 8,
  }),
  4: Object.freeze({
    assetBasename: 'ship',
    frameWidth: 48,
    frameHeight: 48,
    defaultFrameCount: 8,
  }),
  5: Object.freeze({
    assetBasename: 'monster',
    frameWidth: 48,
    frameHeight: 48,
    defaultFrameCount: 16,
  }),
  6: Object.freeze({
    assetBasename: 'tornado',
    frameWidth: 48,
    frameHeight: 48,
    defaultFrameCount: 3,
  }),
  7: Object.freeze({
    assetBasename: 'explode',
    frameWidth: 48,
    frameHeight: 48,
    defaultFrameCount: 6,
  }),
});

const MICROPOLISCORE_OBJECT_SHEET_FRAME_COUNT_OVERRIDES = Object.freeze({
  // Source: `resources/tilesets/futureusa/train.bmp` is 256x32 -> 8 32px frames.
  'futureusa:train': 8,
} as const);

const MICROPOLISCORE_OBJECT_SPRITE_SHEET_URL_BY_KEY =
  createMicropolisCoreObjectSpriteSheetUrlByKey();

/**
 * Browser sprite-frame metadata for one active Micropolis realtime object.
 * Mirrors `DrawObjects` frame indexing in `ref/micropolis/src/sim/w_sprite.c`,
 * where active object frames select picture/mask pairs via `(frame - 1)`.
 * Difference: TypeScript supports classic `obj*-*.xpm` frame assets and
 * MicropolisCore single-row sprite sheets selected by runtime tileset.
 */
export interface ObjectSpriteFrameLookup {
  readonly spriteType: number;
  readonly runtimeFrame: number;
  readonly sourceFrame: number;
  readonly canonicalIdentityKey: CanonicalImageIdentityKey;
  readonly derivedPngPath: string;
  readonly spriteFrameUrl?: string;
  readonly spriteSheetUrl?: string;
  readonly sourceX?: number;
  readonly sourceY?: number;
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;
  readonly spriteSheetPixelWidth?: number;
  readonly spriteSheetPixelHeight?: number;
}

/**
 * Resolve a Micropolis object frame image from runtime sprite fields.
 * Mirrors `DrawObjects` in `ref/micropolis/src/sim/w_sprite.c`, which skips
 * inactive `frame == 0` sprites and indexes object art with `(frame - 1)`.
 * Difference: TypeScript routes through tileset adapters so MicropolisCore
 * packs can replace classic object art without changing authoritative payloads.
 */
export function lookupObjectSpriteFrame({
  spriteType,
  runtimeFrame,
  tilesetName = 'classic',
}: Readonly<{
  spriteType: number;
  runtimeFrame: number;
  tilesetName?: RuntimeTilesetName;
}>): ObjectSpriteFrameLookup | undefined {
  if (!Number.isFinite(spriteType) || !Number.isFinite(runtimeFrame)) {
    return undefined;
  }

  const normalizedSpriteType = Math.trunc(spriteType);
  const normalizedRuntimeFrame = Math.trunc(runtimeFrame);
  if (normalizedSpriteType <= 0 || normalizedRuntimeFrame <= 0) {
    return undefined;
  }

  const sourceFrame = normalizedRuntimeFrame - 1;
  if (tilesetName === 'classic' || tilesetName === 'classicbw') {
    return lookupClassicObjectSpriteFrame(
      normalizedSpriteType,
      normalizedRuntimeFrame,
      sourceFrame,
    );
  }

  const micropolisCoreLookup = lookupMicropolisCoreObjectSpriteFrame({
    tilesetName,
    spriteType: normalizedSpriteType,
    runtimeFrame: normalizedRuntimeFrame,
    sourceFrame,
  });
  if (micropolisCoreLookup !== undefined) {
    return micropolisCoreLookup;
  }

  return lookupClassicObjectSpriteFrame(normalizedSpriteType, normalizedRuntimeFrame, sourceFrame);
}

/**
 * Build the runtime cache key for one `(sprite type, source frame)` tuple.
 * Mirrors object sprite identity loaded by `GetObjectXpms` in
 * `ref/micropolis/src/sim/g_setup.c` (`obj<ID>-<frame>.xpm`).
 */
function toObjectSpriteFrameKey(spriteType: number, sourceFrame: number): string {
  return `${spriteType}:${sourceFrame}`;
}

/**
 * Parse sprite type and frame index from one generated `obj*-*.png` module path.
 * Mirrors the canonical object basename pattern loaded by `GetObjectXpms` in
 * `ref/micropolis/src/sim/g_setup.c` (`obj<ID>-<frame>.xpm`).
 */
function parseObjectSpriteFrameModulePath(
  modulePath: string,
): Readonly<{ spriteType: number; sourceFrame: number }> | undefined {
  const match = OBJECT_SPRITE_FRAME_MODULE_PATH_PATTERN.exec(modulePath);
  if (match === null) {
    return undefined;
  }

  const spriteTypeToken = match[1];
  const sourceFrameToken = match[2];
  if (spriteTypeToken === undefined || sourceFrameToken === undefined) {
    return undefined;
  }

  return {
    spriteType: Number(spriteTypeToken),
    sourceFrame: Number(sourceFrameToken),
  };
}

/**
 * Resolve one frame from classic split `obj*-*.png` outputs.
 * Mirrors `GetObjectXpms` object-frame loading in `ref/micropolis/src/sim/g_setup.c`.
 */
function lookupClassicObjectSpriteFrame(
  spriteType: number,
  runtimeFrame: number,
  sourceFrame: number,
): ObjectSpriteFrameLookup | undefined {
  const spriteFrameUrl = OBJECT_SPRITE_FRAME_URL_BY_KEY.get(
    toObjectSpriteFrameKey(spriteType, sourceFrame),
  );
  if (spriteFrameUrl === undefined) {
    return undefined;
  }

  const canonicalIdentityKey = toCanonicalImageIdentityKey(
    `ref/micropolis/images/obj${spriteType}-${sourceFrame}.xpm`,
  );
  return {
    spriteType,
    runtimeFrame,
    sourceFrame,
    canonicalIdentityKey,
    derivedPngPath: canonicalSourcePathToDerivedPngPath(canonicalIdentityKey),
    spriteFrameUrl,
  };
}

/**
 * Resolve one frame from MicropolisCore sheet-form object art.
 * Mirrors runtime frame ownership from `DrawObjects` in `w_sprite.c`, while
 * adapting to `resources/tilesets/<tileset>/<object>.bmp` single-row frame strips.
 */
function lookupMicropolisCoreObjectSpriteFrame({
  tilesetName,
  spriteType,
  runtimeFrame,
  sourceFrame,
}: Readonly<{
  tilesetName: RuntimeTilesetName;
  spriteType: number;
  runtimeFrame: number;
  sourceFrame: number;
}>): ObjectSpriteFrameLookup | undefined {
  const directoryName = resolveMicropolisCoreTilesetDirectoryName(tilesetName);
  if (directoryName === undefined) {
    return undefined;
  }

  const spriteSheetSpec = MICROPOLISCORE_OBJECT_SPRITE_SHEET_SPEC_BY_TYPE[spriteType];
  if (spriteSheetSpec === undefined) {
    return undefined;
  }

  const frameCount = resolveMicropolisCoreObjectFrameCount({
    directoryName,
    assetBasename: spriteSheetSpec.assetBasename,
    defaultFrameCount: spriteSheetSpec.defaultFrameCount,
  });
  if (sourceFrame >= frameCount) {
    return undefined;
  }

  const spriteSheetUrl = MICROPOLISCORE_OBJECT_SPRITE_SHEET_URL_BY_KEY.get(
    toMicropolisCoreObjectSpriteSheetKey(directoryName, spriteSheetSpec.assetBasename),
  );
  if (spriteSheetUrl === undefined) {
    return undefined;
  }

  const spriteSheetPixelWidth = spriteSheetSpec.frameWidth * frameCount;
  const spriteSheetPixelHeight = spriteSheetSpec.frameHeight;
  const canonicalIdentityKey = toCanonicalImageIdentityKey(
    `ref/micropolis/images/tilesets/${directoryName}/${spriteSheetSpec.assetBasename}.xpm`,
  );
  return {
    spriteType,
    runtimeFrame,
    sourceFrame,
    canonicalIdentityKey,
    derivedPngPath: `packages/sim-assets/micropoliscore-tilesets/${directoryName}/${spriteSheetSpec.assetBasename}.png`,
    spriteSheetUrl,
    sourceX: sourceFrame * spriteSheetSpec.frameWidth,
    sourceY: 0,
    sourceWidth: spriteSheetSpec.frameWidth,
    sourceHeight: spriteSheetSpec.frameHeight,
    spriteSheetPixelWidth,
    spriteSheetPixelHeight,
  };
}

/**
 * Build the runtime lookup key for one MicropolisCore sheet asset.
 * Mirrors object-art identity ownership from `GetObjectXpms` in `g_setup.c`,
 * adapted to MicropolisCore directory + basename sheets.
 */
function toMicropolisCoreObjectSpriteSheetKey(
  directoryName: string,
  assetBasename: MicropolisCoreObjectSpriteAssetBasename,
): string {
  return `${directoryName}:${assetBasename}`;
}

/**
 * Resolve frame-count overrides for known MicropolisCore sheet differences.
 * Mirrors frame-index semantics from `DrawObjects` in `w_sprite.c`; TypeScript
 * adds per-tileset metadata where strip widths differ from defaults.
 */
function resolveMicropolisCoreObjectFrameCount({
  directoryName,
  assetBasename,
  defaultFrameCount,
}: Readonly<{
  directoryName: string;
  assetBasename: MicropolisCoreObjectSpriteAssetBasename;
  defaultFrameCount: number;
}>): number {
  const overrideKey =
    `${directoryName}:${assetBasename}` as keyof typeof MICROPOLISCORE_OBJECT_SHEET_FRAME_COUNT_OVERRIDES;
  return MICROPOLISCORE_OBJECT_SHEET_FRAME_COUNT_OVERRIDES[overrideKey] ?? defaultFrameCount;
}

/**
 * Runtime guard for supported MicropolisCore object sheet basenames.
 * Mirrors object-art enum intent from classic `GetObjectXpms` in `g_setup.c`,
 * adapted to MicropolisCore sprite sheet filenames.
 */
function isMicropolisCoreObjectSpriteAssetBasename(
  basename: string,
): basename is MicropolisCoreObjectSpriteAssetBasename {
  return MICROPOLISCORE_OBJECT_SPRITE_ASSET_BASENAMES.includes(
    basename as MicropolisCoreObjectSpriteAssetBasename,
  );
}

/**
 * Create a deterministic URL lookup table for generated object frame PNGs.
 * Mirrors `GetObjectXpms` object-frame discovery in
 * `ref/micropolis/src/sim/g_setup.c`, adapted to Vite static asset URLs.
 */
function createObjectSpriteFrameUrlByKey(): ReadonlyMap<string, string> {
  const urlsByKey = new Map<string, string>();
  for (const [modulePath, spriteFrameUrl] of Object.entries(OBJECT_SPRITE_FRAME_MODULES)) {
    const parsed = parseObjectSpriteFrameModulePath(modulePath);
    if (parsed === undefined) {
      continue;
    }
    urlsByKey.set(toObjectSpriteFrameKey(parsed.spriteType, parsed.sourceFrame), spriteFrameUrl);
  }
  return urlsByKey;
}

/**
 * Create deterministic URL lookup for MicropolisCore object sprite sheets.
 * Mirrors object art bundle selection by tileset directory in MicropolisCore
 * `resources/tilesets/<name>/*.bmp`, adapted to Vite static asset URLs.
 */
function createMicropolisCoreObjectSpriteSheetUrlByKey(): ReadonlyMap<string, string> {
  const urlsByKey = new Map<string, string>();
  for (const [modulePath, spriteSheetUrl] of Object.entries(
    MICROPOLISCORE_OBJECT_SPRITE_SHEET_MODULES,
  )) {
    const match = /\/micropoliscore-tilesets\/([^/]+)\/([^/]+)\.png$/.exec(modulePath);
    const directoryName = match?.[1];
    const basename = match?.[2];
    if (directoryName === undefined || basename === undefined) {
      continue;
    }
    if (!isMicropolisCoreObjectSpriteAssetBasename(basename)) {
      continue;
    }
    urlsByKey.set(toMicropolisCoreObjectSpriteSheetKey(directoryName, basename), spriteSheetUrl);
  }
  return urlsByKey;
}

const OBJECT_SPRITE_FRAME_URL_BY_KEY = createObjectSpriteFrameUrlByKey();
