import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  canonicalSourcePathToDerivedPngPath,
  createDerivedImagePathManifest,
  createDerivedImagePathManifestByCanonicalKey,
  DERIVED_IMAGE_PATH_MANIFEST,
  DERIVED_IMAGE_PATH_MANIFEST_BY_CANONICAL_KEY,
  DERIVED_IMAGES_OUTPUT_DIR,
  getDerivedImagePathManifestEntry,
  toCanonicalImageIdentityKey,
} from './derived-images.ts';
import { ASSETS_MANIFEST } from './generated/assets-manifest.ts';

describe('derived image output convention', () => {
  it('pins a stable repository-relative output directory', () => {
    expect(DERIVED_IMAGES_OUTPUT_DIR).toBe('packages/sim-assets/generated-images');
  });

  it('keeps a package-local output directory ready for derived exports', () => {
    const packageDir = fileURLToPath(new URL('..', import.meta.url));
    const repoRoot = path.resolve(packageDir, '..', '..');
    const outputDir = path.join(repoRoot, DERIVED_IMAGES_OUTPUT_DIR);

    expect(existsSync(outputDir)).toBe(true);
  });

  it('defines canonical source path to derived png mapping for every canonical xpm image', () => {
    const canonicalXpmPaths = ASSETS_MANIFEST.files.images
      .map((imageFile) => `${ASSETS_MANIFEST.sourceRoots.images}/${imageFile.path}`)
      .filter((canonicalPath) => canonicalPath.endsWith('.xpm'));

    expect(DERIVED_IMAGE_PATH_MANIFEST).toHaveLength(canonicalXpmPaths.length);
    expect(DERIVED_IMAGE_PATH_MANIFEST.map((entry) => entry.canonicalSourcePath)).toEqual(
      canonicalXpmPaths,
    );
    expect(DERIVED_IMAGE_PATH_MANIFEST.map((entry) => entry.canonicalIdentityKey)).toEqual(
      canonicalXpmPaths,
    );
  });

  it('maps canonical xpm paths into package-local png overlay outputs', () => {
    expect(canonicalSourcePathToDerivedPngPath('ref/micropolis/images/airport.xpm')).toBe(
      'packages/sim-assets/generated-images/images/airport.png',
    );
  });

  it('indexes runtime metadata by canonical identity key', () => {
    const canonicalIdentityKey = toCanonicalImageIdentityKey('ref/micropolis/images/airport.xpm');
    const entry = getDerivedImagePathManifestEntry(canonicalIdentityKey);

    expect(entry).toBeDefined();
    expect(entry?.canonicalIdentityKey).toBe(canonicalIdentityKey);
    expect(entry?.canonicalSourcePath).toBe(canonicalIdentityKey);
    expect(entry?.derivedPngPath).toBe('packages/sim-assets/generated-images/images/airport.png');
    expect(DERIVED_IMAGE_PATH_MANIFEST_BY_CANONICAL_KEY.has(canonicalIdentityKey)).toBe(true);
    expect(
      [...DERIVED_IMAGE_PATH_MANIFEST_BY_CANONICAL_KEY.keys()].every((key) =>
        key.startsWith('ref/micropolis/images/'),
      ),
    ).toBe(true);
  });

  it('keeps canonical identity keys stable when derived png overlays are omitted', () => {
    const overlayManifest = createDerivedImagePathManifest({ includeDerivedPngPathOverlay: true });
    const canonicalOnlyManifest = createDerivedImagePathManifest({
      includeDerivedPngPathOverlay: false,
    });
    const overlayMap = createDerivedImagePathManifestByCanonicalKey(overlayManifest);
    const canonicalOnlyMap = createDerivedImagePathManifestByCanonicalKey(canonicalOnlyManifest);

    expect(canonicalOnlyManifest.map((entry) => entry.canonicalIdentityKey)).toEqual(
      overlayManifest.map((entry) => entry.canonicalIdentityKey),
    );
    expect(canonicalOnlyManifest.map((entry) => entry.canonicalSourcePath)).toEqual(
      overlayManifest.map((entry) => entry.canonicalSourcePath),
    );
    expect(canonicalOnlyManifest.every((entry) => entry.derivedPngPath === undefined)).toBe(true);
    expect([...canonicalOnlyMap.keys()]).toEqual([...overlayMap.keys()]);

    const canonicalIdentityKey = toCanonicalImageIdentityKey('ref/micropolis/images/airport.xpm');
    expect(canonicalOnlyMap.get(canonicalIdentityKey)?.canonicalIdentityKey).toBe(
      canonicalIdentityKey,
    );
    expect(canonicalOnlyMap.get(canonicalIdentityKey)?.derivedPngPath).toBeUndefined();
  });
});
