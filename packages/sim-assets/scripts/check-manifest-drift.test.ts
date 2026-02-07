import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkManifestDrift } from './check-manifest-drift.mjs';

const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

/**
 * Test-only manifest fixture writer for drift-gate behavior.
 * Source mapping: no direct Micropolis C counterpart; this helper simulates the
 * generated TypeScript manifest artifact that is derived from canonical
 * `ref/micropolis/{res,images,manual}` inputs.
 */
function createTempManifestPath(initialContents: string) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'sim-assets-manifest-drift-'));
  tempRoots.push(tempRoot);

  const manifestPath = path.join(tempRoot, 'assets-manifest.ts');
  writeFileSync(manifestPath, initialContents, 'utf8');

  return manifestPath;
}

describe('check-manifest-drift', () => {
  it('passes when regeneration writes byte-identical manifest output', () => {
    const canonicalManifest = 'export const ASSETS_MANIFEST = {} as const;\n';
    const manifestPath = createTempManifestPath(canonicalManifest);

    const result = checkManifestDrift({
      manifestPath,
      regenerateManifest: () => {
        writeFileSync(manifestPath, canonicalManifest, 'utf8');
        return manifestPath;
      },
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(readFileSync(manifestPath, 'utf8')).toBe(canonicalManifest);
  });

  it('fails when regeneration updates stale manifest bytes', () => {
    const canonicalManifest = 'export const ASSETS_MANIFEST = {"v":2} as const;\n';
    const staleManifest = 'export const ASSETS_MANIFEST = {"v":1} as const;\n';
    const manifestPath = createTempManifestPath(staleManifest);

    const result = checkManifestDrift({
      manifestPath,
      regenerateManifest: () => {
        writeFileSync(manifestPath, canonicalManifest, 'utf8');
        return manifestPath;
      },
    });

    expect(result.ok).toBe(false);
    expect(result.changed).toBe(true);
    expect(readFileSync(manifestPath, 'utf8')).toBe(canonicalManifest);
  });
});
