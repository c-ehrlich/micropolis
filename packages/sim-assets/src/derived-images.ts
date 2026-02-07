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

/**
 * Canonical-to-derived path mapping entry for an XPM source image.
 * Canonical source identities mirror Micropolis image loads from
 * `ref/micropolis/src/sim/g_setup.c`; derived PNG paths are TypeScript-only
 * overlay outputs and intentionally have no 1:1 C runtime equivalent.
 */
export interface DerivedImagePathManifestEntry {
  readonly canonicalSourcePath: string;
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
    .map((canonicalSourcePath) => ({
      canonicalSourcePath,
      derivedPngPath: canonicalSourcePathToDerivedPngPath(canonicalSourcePath),
    }));

  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

/**
 * Deterministically map a canonical Micropolis source path to its derived PNG path.
 * This keeps canonical path identity (`ref/micropolis/...`) intact per C/Tcl
 * resource loading behavior while deriving a stable output location for PNG
 * overlays in TypeScript tooling.
 */
export function canonicalSourcePathToDerivedPngPath(canonicalSourcePath: string): string {
  if (!canonicalSourcePath.startsWith(MICROPOLIS_ROOT_PREFIX)) {
    throw new Error(
      `canonical source path must start with "${MICROPOLIS_ROOT_PREFIX}": ${canonicalSourcePath}`,
    );
  }
  if (!canonicalSourcePath.endsWith('.xpm')) {
    throw new Error(`canonical source path must end with ".xpm": ${canonicalSourcePath}`);
  }

  const relativeToMicropolisRoot = canonicalSourcePath.slice(MICROPOLIS_ROOT_PREFIX.length);
  return `${DERIVED_IMAGES_OUTPUT_DIR}/${relativeToMicropolisRoot.slice(0, -'.xpm'.length)}.png`;
}

/**
 * Stable manifest of canonical XPM source paths mapped to derived PNG outputs.
 * This manifest is generated from canonical Micropolis image entries in
 * `src/generated/assets-manifest.ts` and keeps canonical identity keys
 * unchanged, matching the source-of-truth model from the C/Tcl codebase.
 */
export const DERIVED_IMAGE_PATH_MANIFEST = createDerivedImagePathManifest();
