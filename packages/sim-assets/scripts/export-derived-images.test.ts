import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  encodeRgbaAsPng,
  exportDerivedImages,
  listCanonicalXpmExports,
  parseMicropolisXpmToRgba,
} from './export-derived-images.mjs';

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

function createFixtureDirs() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'sim-assets-derived-'));
  tempRoots.push(tempRoot);

  const sourceImagesDir = path.join(tempRoot, 'source-images');
  const outputImagesDir = path.join(tempRoot, 'derived-images');
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

describe('export-derived-images deterministic conversion', () => {
  it('keeps canonical xpm export ordering ASCII-stable', () => {
    const fixture = createFixtureDirs();
    const entries = listCanonicalXpmExports(fixture);

    expect(entries.map((entry) => entry.fileName)).toEqual(['alpha.xpm', 'zeta.xpm']);
    expect(entries.map((entry) => entry.canonicalSourcePath)).toEqual([
      'ref/micropolis/images/alpha.xpm',
      'ref/micropolis/images/zeta.xpm',
    ]);
  });

  it('keeps png bytes and write counts idempotent across repeated exports', () => {
    const fixture = createFixtureDirs();

    const first = exportDerivedImages(fixture);
    expect(first).toMatchObject({
      total: 2,
      written: 2,
      unchanged: 0,
      skippedEmpty: 0,
      removed: 0,
      dryRun: false,
    });

    const alphaPngPath = path.join(fixture.outputImagesDir, 'alpha.png');
    const firstAlphaBytes = readFileSync(alphaPngPath);

    const second = exportDerivedImages(fixture);
    expect(second).toMatchObject({
      total: 2,
      written: 0,
      unchanged: 2,
      skippedEmpty: 0,
      removed: 0,
      dryRun: false,
    });
    expect(readFileSync(alphaPngPath).equals(firstAlphaBytes)).toBe(true);
  });

  it('emits deterministic png bytes for identical xpm inputs', () => {
    const parsed = parseMicropolisXpmToRgba(ALPHA_XPM, 'ref/micropolis/images/alpha.xpm');
    const first = encodeRgbaAsPng(parsed.width, parsed.height, parsed.rgba);
    const second = encodeRgbaAsPng(parsed.width, parsed.height, parsed.rgba);

    expect(first.equals(second)).toBe(true);
  });
});
