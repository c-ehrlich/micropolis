import { ASSETS_MANIFEST } from './generated/assets-manifest.ts';

/**
 * Repository-relative output directory for optional derived PNG exports.
 * Micropolis C/Tcl loads canonical XPM/resource assets directly from
 * `ref/micropolis` (for example `ref/micropolis/src/sim/g_setup.c` and
 * `ref/micropolis/res/micropolis.tcl`), so this path is TypeScript-only build
 * output and does not replace canonical Micropolis asset identities.
 */
export const DERIVED_IMAGES_OUTPUT_DIR = 'packages/sim-assets/generated-images';

const MICROPOLIS_ROOT_PREFIX = 'ref/micropolis/';
const MICROPOLIS_IMAGES_PREFIX = 'ref/micropolis/images/' as const;

/**
 * Canonical runtime identity key for Micropolis XPM image assets.
 * Mirrors image filename identities loaded by `XpmReadFileToImage` and
 * `XpmReadFileToPixmap` in `ref/micropolis/src/sim/g_setup.c` (1:1 canonical
 * `ref/micropolis/images/*.xpm` namespace).
 */
export type CanonicalImageIdentityKey = `${typeof MICROPOLIS_IMAGES_PREFIX}${string}.xpm`;

/**
 * Normalize and validate a canonical Micropolis image identity key.
 * Mirrors C runtime image identity in `ref/micropolis/src/sim/g_setup.c`,
 * where file lookup identity is the canonical XPM source path.
 */
export function toCanonicalImageIdentityKey(
  canonicalSourcePath: string,
): CanonicalImageIdentityKey {
  if (!canonicalSourcePath.startsWith(MICROPOLIS_IMAGES_PREFIX)) {
    throw new Error(
      `canonical source path must start with "${MICROPOLIS_IMAGES_PREFIX}": ${canonicalSourcePath}`,
    );
  }
  if (!canonicalSourcePath.endsWith('.xpm')) {
    throw new Error(`canonical source path must end with ".xpm": ${canonicalSourcePath}`);
  }

  return canonicalSourcePath as CanonicalImageIdentityKey;
}

/**
 * Canonical-to-derived path mapping entry for an XPM source image.
 * Canonical source identities mirror Micropolis image loads from
 * `ref/micropolis/src/sim/g_setup.c`; derived PNG paths are TypeScript-only
 * overlay outputs and intentionally have no 1:1 C runtime equivalent.
 */
export interface DerivedImagePathManifestEntry {
  readonly canonicalIdentityKey: CanonicalImageIdentityKey;
  readonly canonicalSourcePath: CanonicalImageIdentityKey;
  readonly derivedPngPath: string;
}

/**
 * Build the canonical-source to derived-PNG path manifest.
 * Mirrors canonical image identity keys under `ref/micropolis/images/*.xpm`
 * used by `g_setup.c`, while projecting deterministic PNG overlay paths under
 * `packages/sim-assets/generated-images/` for optional TypeScript workflows.
 */
export function createDerivedImagePathManifest(): readonly DerivedImagePathManifestEntry[] {
  const entries = ASSETS_MANIFEST.files.images
    .map((imageFile) => `${ASSETS_MANIFEST.sourceRoots.images}/${imageFile.path}`)
    .filter((canonicalSourcePath) => canonicalSourcePath.endsWith('.xpm'))
    .map((canonicalSourcePath) => toCanonicalImageIdentityKey(canonicalSourcePath))
    .map((canonicalIdentityKey) => ({
      canonicalIdentityKey,
      canonicalSourcePath: canonicalIdentityKey,
      derivedPngPath: canonicalSourcePathToDerivedPngPath(canonicalIdentityKey),
    }));

  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

/**
 * Build canonical-keyed runtime metadata for derived image overlays.
 * Canonical keys mirror Micropolis C image identities (`g_setup.c`), while the
 * metadata value includes TypeScript-only overlay output paths.
 */
export function createDerivedImagePathManifestByCanonicalKey(
  entries: readonly DerivedImagePathManifestEntry[],
): ReadonlyMap<CanonicalImageIdentityKey, DerivedImagePathManifestEntry> {
  return new Map(
    entries.map((entry) => [entry.canonicalIdentityKey, entry] as const),
  ) as ReadonlyMap<CanonicalImageIdentityKey, DerivedImagePathManifestEntry>;
}

/**
 * Deterministically map a canonical Micropolis source path to its derived PNG path.
 * This keeps canonical path identity (`ref/micropolis/...`) intact per C/Tcl
 * resource loading behavior while deriving a stable output location for PNG
 * overlays in TypeScript tooling.
 */
export function canonicalSourcePathToDerivedPngPath(canonicalSourcePath: string): string {
  const canonicalIdentityKey = toCanonicalImageIdentityKey(canonicalSourcePath);

  if (!canonicalIdentityKey.startsWith(MICROPOLIS_ROOT_PREFIX)) {
    throw new Error(
      `canonical source path must start with "${MICROPOLIS_ROOT_PREFIX}": ${canonicalIdentityKey}`,
    );
  }

  const relativeToMicropolisRoot = canonicalIdentityKey.slice(MICROPOLIS_ROOT_PREFIX.length);
  return `${DERIVED_IMAGES_OUTPUT_DIR}/${relativeToMicropolisRoot.slice(0, -'.xpm'.length)}.png`;
}

/**
 * Stable manifest of canonical XPM source paths mapped to derived PNG outputs.
 * This manifest is generated from canonical Micropolis image entries in
 * `src/generated/assets-manifest.ts` and keeps canonical identity keys
 * unchanged, matching the source-of-truth model from the C/Tcl codebase.
 */
export const DERIVED_IMAGE_PATH_MANIFEST = createDerivedImagePathManifest();

/**
 * Runtime metadata indexed by canonical Micropolis image identity keys.
 * This guarantees runtime lookup keys stay canonical (`ref/micropolis/images/*.xpm`)
 * even when optional TypeScript-derived PNG overlays are present.
 */
export const DERIVED_IMAGE_PATH_MANIFEST_BY_CANONICAL_KEY =
  createDerivedImagePathManifestByCanonicalKey(DERIVED_IMAGE_PATH_MANIFEST);

/**
 * Resolve derived-image runtime metadata by canonical image identity key.
 * Mirrors C runtime canonical image identity usage in
 * `ref/micropolis/src/sim/g_setup.c`; derived PNG paths remain optional
 * TypeScript-only metadata attached to that canonical key.
 */
export function getDerivedImagePathManifestEntry(
  canonicalIdentityKey: CanonicalImageIdentityKey,
): DerivedImagePathManifestEntry | undefined {
  return DERIVED_IMAGE_PATH_MANIFEST_BY_CANONICAL_KEY.get(canonicalIdentityKey);
}
