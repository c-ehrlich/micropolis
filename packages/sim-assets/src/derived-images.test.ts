import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DERIVED_IMAGES_OUTPUT_DIR } from './derived-images.ts';

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
});
