import {
  type CanonicalImageIdentityKey,
  canonicalSourcePathToDerivedPngPath,
  toCanonicalImageIdentityKey,
} from '../../../../../packages/sim-assets/src/derived-images.ts';

const OBJECT_SPRITE_FRAME_MODULE_PATH_PATTERN = /\/obj(\d+)-(\d+)\.png$/;
const OBJECT_SPRITE_FRAME_MODULES = import.meta.glob(
  '../../../../../packages/sim-assets/generated-images/images/obj*-*.png',
  {
    eager: true,
    import: 'default',
  },
) as Record<string, string>;

/**
 * Browser sprite-frame metadata for one active Micropolis realtime object.
 * Mirrors `DrawObjects` frame indexing in `ref/micropolis/src/sim/w_sprite.c`,
 * where active object frames select picture/mask pairs via `(frame - 1)`.
 * Difference: TypeScript renders PNG overlays exported from canonical
 * `obj*-*.xpm` sources instead of X11 pixmap/mask handles.
 */
export interface ObjectSpriteFrameLookup {
  readonly spriteType: number;
  readonly runtimeFrame: number;
  readonly sourceFrame: number;
  readonly canonicalIdentityKey: CanonicalImageIdentityKey;
  readonly derivedPngPath: string;
  readonly spriteFrameUrl: string;
}

/**
 * Resolve a Micropolis object frame image from runtime sprite fields.
 * Mirrors `DrawObjects` in `ref/micropolis/src/sim/w_sprite.c`, which skips
 * inactive `frame == 0` sprites and indexes object art with `(frame - 1)`.
 * Difference: missing browser assets return `undefined` so callers can fall
 * back deterministically (for example, debug labels) rather than crash.
 */
export function lookupObjectSpriteFrame({
  spriteType,
  runtimeFrame,
}: Readonly<{
  spriteType: number;
  runtimeFrame: number;
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
  const spriteFrameUrl = OBJECT_SPRITE_FRAME_URL_BY_KEY.get(
    toObjectSpriteFrameKey(normalizedSpriteType, sourceFrame),
  );
  if (spriteFrameUrl === undefined) {
    return undefined;
  }

  const canonicalIdentityKey = toCanonicalImageIdentityKey(
    `ref/micropolis/images/obj${normalizedSpriteType}-${sourceFrame}.xpm`,
  );
  return {
    spriteType: normalizedSpriteType,
    runtimeFrame: normalizedRuntimeFrame,
    sourceFrame,
    canonicalIdentityKey,
    derivedPngPath: canonicalSourcePathToDerivedPngPath(canonicalIdentityKey),
    spriteFrameUrl,
  };
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

const OBJECT_SPRITE_FRAME_URL_BY_KEY = createObjectSpriteFrameUrlByKey();
