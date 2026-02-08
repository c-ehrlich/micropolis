import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { exportDerivedImages } from './export-derived-images.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, '..');
const GENERATED_DERIVED_IMAGES_DIR = path.join(PACKAGE_DIR, 'generated-images', 'images');

/**
 * Deterministically compare ASCII path strings for stable drift reports.
 * Micropolis canonical image lookup keys are filename-based in
 * `ref/micropolis/src/sim/g_setup.c`; this helper keeps TypeScript drift
 * output ordering deterministic without altering canonical identity semantics.
 */
function compareAscii(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Recursively list PNG paths under a derived-output directory.
 * No direct C equivalent: this is TypeScript-only verification plumbing for
 * optional PNG overlays generated from canonical Micropolis XPM assets.
 */
function listDerivedPngRelativePaths(absoluteOutputImagesDir, relativePrefix = '') {
  const baseDir = relativePrefix
    ? path.join(absoluteOutputImagesDir, relativePrefix)
    : absoluteOutputImagesDir;
  const entries = readdirSync(baseDir, { withFileTypes: true });
  const relativePaths = [];

  for (const entry of entries) {
    const relativePath = relativePrefix ? path.posix.join(relativePrefix, entry.name) : entry.name;

    if (entry.isDirectory()) {
      relativePaths.push(...listDerivedPngRelativePaths(absoluteOutputImagesDir, relativePath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.png')) {
      relativePaths.push(relativePath);
    }
  }

  return relativePaths;
}

/**
 * Snapshot derived PNG output bytes by relative path.
 * Canonical Micropolis image identities remain rooted in
 * `ref/micropolis/images/*.xpm`; this TypeScript helper inspects only derived
 * PNG overlay artifacts under `packages/sim-assets/generated-images/images`.
 */
function readDerivedPngSnapshot(absoluteOutputImagesDir) {
  const outputDirStats = statSync(absoluteOutputImagesDir, { throwIfNoEntry: false });
  if (!outputDirStats || !outputDirStats.isDirectory()) {
    return new Map();
  }

  const relativePaths = listDerivedPngRelativePaths(absoluteOutputImagesDir).sort((left, right) =>
    compareAscii(left, right),
  );
  const snapshot = new Map();

  for (const relativePath of relativePaths) {
    snapshot.set(relativePath, readFileSync(path.join(absoluteOutputImagesDir, relativePath)));
  }

  return snapshot;
}

/**
 * Compare two derived PNG snapshots for missing/extra/changed files.
 * No C equivalent: this enforces deterministic TypeScript-generated overlay
 * artifacts while canonical Micropolis identities remain unchanged.
 */
function compareDerivedPngSnapshots(expectedSnapshot, actualSnapshot) {
  const missing = [];
  const extra = [];
  const changed = [];

  for (const expectedPath of expectedSnapshot.keys()) {
    const actualBytes = actualSnapshot.get(expectedPath);
    if (!actualBytes) {
      missing.push(expectedPath);
      continue;
    }

    const expectedBytes = expectedSnapshot.get(expectedPath);
    if (!expectedBytes.equals(actualBytes)) {
      changed.push(expectedPath);
    }
  }

  for (const actualPath of actualSnapshot.keys()) {
    if (!expectedSnapshot.has(actualPath)) {
      extra.push(actualPath);
    }
  }

  missing.sort((left, right) => compareAscii(left, right));
  extra.sort((left, right) => compareAscii(left, right));
  changed.sort((left, right) => compareAscii(left, right));

  return {
    matches: missing.length === 0 && extra.length === 0 && changed.length === 0,
    missing,
    extra,
    changed,
  };
}

/**
 * Check derived PNG drift against deterministic canonical XPM export output.
 * Source mapping:
 * - Canonical image identities loaded by Micropolis C runtime in
 *   `ref/micropolis/src/sim/g_setup.c` (`XpmReadFileToImage`,
 *   `XpmReadFileToPixmap`).
 * Parity note:
 * - Micropolis does not ship PNG exports; this TypeScript check validates that
 *   optional derived PNG overlays are deterministic and match checked-in
 *   generated artifacts.
 */
export function checkDerivedImageDrift({
  sourceImagesDir,
  outputImagesDir = GENERATED_DERIVED_IMAGES_DIR,
  canonicalImagesPrefix,
  derivedImagesPrefix,
  exportImages = exportDerivedImages,
} = {}) {
  const resolvedOutputImagesDir = path.resolve(outputImagesDir);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'sim-assets-derived-image-drift-'));
  const deterministicRunAOutputDir = path.join(tempRoot, 'run-a', 'images');
  const deterministicRunBOutputDir = path.join(tempRoot, 'run-b', 'images');

  const sharedExportOptions = {};
  if (sourceImagesDir !== undefined) {
    sharedExportOptions.sourceImagesDir = sourceImagesDir;
  }
  if (canonicalImagesPrefix !== undefined) {
    sharedExportOptions.canonicalImagesPrefix = canonicalImagesPrefix;
  }
  if (derivedImagesPrefix !== undefined) {
    sharedExportOptions.derivedImagesPrefix = derivedImagesPrefix;
  }

  try {
    exportImages({
      ...sharedExportOptions,
      outputImagesDir: deterministicRunAOutputDir,
    });
    exportImages({
      ...sharedExportOptions,
      outputImagesDir: deterministicRunBOutputDir,
    });

    const expectedSnapshot = readDerivedPngSnapshot(deterministicRunAOutputDir);
    const deterministicSnapshot = readDerivedPngSnapshot(deterministicRunBOutputDir);
    const checkedInSnapshot = readDerivedPngSnapshot(resolvedOutputImagesDir);

    const deterministicDiff = compareDerivedPngSnapshots(expectedSnapshot, deterministicSnapshot);
    const driftDiff = compareDerivedPngSnapshots(expectedSnapshot, checkedInSnapshot);

    return {
      ok: deterministicDiff.matches && driftDiff.matches,
      deterministic: deterministicDiff.matches,
      matchesCommittedOutput: driftDiff.matches,
      expectedPngCount: expectedSnapshot.size,
      committedPngCount: checkedInSnapshot.size,
      deterministicDiff,
      driftDiff,
      outputImagesDir: resolvedOutputImagesDir,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Format a concise derived PNG drift summary for CLI output.
 * No C equivalent: this is diagnostics text for TypeScript drift gates.
 */
function formatDiffSummary(diff) {
  return `missing=${diff.missing.length}, extra=${diff.extra.length}, changed=${diff.changed.length}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const result = checkDerivedImageDrift();

  if (!result.ok) {
    const messages = [];

    if (!result.deterministic) {
      messages.push(
        [
          'Derived-image drift check failed: repeated exports from identical canonical XPM inputs produced different PNG output bytes.',
          `Determinism diff (${formatDiffSummary(result.deterministicDiff)}).`,
        ].join(' '),
      );
    }

    if (!result.matchesCommittedOutput) {
      messages.push(
        [
          'Derived-image drift check failed: checked-in derived PNG output is stale.',
          `Checked-in diff (${formatDiffSummary(result.driftDiff)}).`,
          'Run `pnpm -C packages/sim-assets export-derived-images` and commit updated PNG files.',
        ].join(' '),
      );
    }

    process.stderr.write(messages.join('\n'));
    process.stderr.write('\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Derived-image drift check passed: ${result.expectedPngCount} deterministic PNG(s) match ${result.outputImagesDir}.\n`,
    );
  }
}
