import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateAssetsManifest } from './gen-assets-manifest.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, '..');
const GENERATED_MANIFEST_PATH = path.join(PACKAGE_DIR, 'src', 'generated', 'assets-manifest.ts');

/**
 * Read a UTF-8 file if present, returning `null` when absent.
 * This drift check guards deterministic generated manifest output whose canonical
 * asset identities mirror Micropolis resource/image/manual loading references in
 * `ref/micropolis/src/sim/w_resrc.c`, `ref/micropolis/src/sim/g_setup.c`, and
 * `ref/micropolis/res/micropolis.tcl` through `gen-assets-manifest.mjs`.
 */
function readUtf8FileOrNull(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

/**
 * Regenerate `src/generated/assets-manifest.ts` and fail when output bytes differ.
 * Source mapping: this wraps `generateAssetsManifest()` so drift checks are based on
 * canonical Micropolis roots (`ref/micropolis/{res,images,manual}`) already mapped
 * to C/Tcl loader identities in `gen-assets-manifest.mjs`.
 * Parity note: the check enforces deterministic generation only; it does not alter
 * canonical Micropolis source behavior.
 */
export function checkManifestDrift({
  manifestPath = GENERATED_MANIFEST_PATH,
  regenerateManifest = generateAssetsManifest,
} = {}) {
  const resolvedManifestPath = path.resolve(manifestPath);
  const before = readUtf8FileOrNull(resolvedManifestPath);
  const outputPath = path.resolve(regenerateManifest());

  if (outputPath !== resolvedManifestPath) {
    throw new Error(
      [
        'Manifest drift check misconfigured.',
        `Expected regenerate output path ${resolvedManifestPath}.`,
        `Received ${outputPath}.`,
      ].join(' '),
    );
  }

  const after = readUtf8FileOrNull(resolvedManifestPath);
  const changed = before !== after;

  return {
    ok: !changed,
    changed,
    manifestPath: resolvedManifestPath,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const result = checkManifestDrift();
  if (!result.ok) {
    process.stderr.write(
      [
        'Manifest drift check failed: generated manifest changed after regeneration.',
        'Run `pnpm -C packages/sim-assets check-manifest-drift` and commit updated generated files.',
      ].join(' '),
    );
    process.stderr.write('\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('Manifest drift check passed: generated manifest is up to date.\n');
  }
}
