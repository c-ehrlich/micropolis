import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { exportDerivedImages } from './export-derived-images.mjs';
import { checkDerivedImageDrift } from './check-derived-image-drift.mjs';

const ALPHA_XPM = `/* XPM */
static char * alpha_xpm[] = {
"1 1 2 1",
"a c #000000",
". c None",
"a"
};
`;

const ZETA_XPM = `/* XPM */
static char * zeta_xpm[] = {
"2 1 2 1",
"a c #ffffff",
"b c #ff0000",
"ab"
};
`;

const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

/**
 * Build temporary Micropolis-style image fixtures for drift-gate tests.
 * Source mapping: no direct C function equivalent; this helper creates local
 * XPM fixtures that stand in for canonical `ref/micropolis/images/*.xpm`
 * identities consumed by `XpmReadFileToImage` in `ref/micropolis/src/sim/g_setup.c`.
 */
function createFixtureDirs() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'sim-assets-derived-drift-'));
  tempRoots.push(tempRoot);

  const sourceImagesDir = path.join(tempRoot, 'source-images');
  const outputImagesDir = path.join(tempRoot, 'generated-images', 'images');
  mkdirSync(sourceImagesDir, { recursive: true });

  writeFileSync(path.join(sourceImagesDir, 'zeta.xpm'), ZETA_XPM, 'utf8');
  writeFileSync(path.join(sourceImagesDir, 'alpha.xpm'), ALPHA_XPM, 'utf8');

  return {
    sourceImagesDir,
    outputImagesDir,
    canonicalImagesPrefix: 'ref/micropolis/images/',
    derivedImagesPrefix: 'packages/sim-assets/generated-images/images/',
  };
}

describe('check-derived-image-drift', () => {
  it('passes when checked-in derived pngs match deterministic export output', () => {
    const fixture = createFixtureDirs();

    exportDerivedImages(fixture);
    const result = checkDerivedImageDrift(fixture);

    expect(result.ok).toBe(true);
    expect(result.deterministic).toBe(true);
    expect(result.matchesCommittedOutput).toBe(true);
    expect(result.expectedPngCount).toBe(2);
    expect(result.committedPngCount).toBe(2);
    expect(result.driftDiff).toEqual({
      matches: true,
      missing: [],
      extra: [],
      changed: [],
    });
  });

  it('fails when derived png output is intentionally stale', () => {
    const fixture = createFixtureDirs();

    exportDerivedImages(fixture);
    writeFileSync(path.join(fixture.outputImagesDir, 'alpha.png'), 'stale', 'utf8');

    const result = checkDerivedImageDrift(fixture);

    expect(result.ok).toBe(false);
    expect(result.deterministic).toBe(true);
    expect(result.matchesCommittedOutput).toBe(false);
    expect(result.driftDiff.matches).toBe(false);
    expect(result.driftDiff.changed).toEqual(['alpha.png']);
  });
});
