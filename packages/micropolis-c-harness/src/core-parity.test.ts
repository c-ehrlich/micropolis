import type { SpawnSyncReturns } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ensureCoreOracle,
  runCoreOracleInitNewCity,
  runCoreOracleLoadCty,
  runCoreOracleLoadCtyBytes,
  runCoreOracleSaveCty,
} from './core-parity.ts';

const ABOUT_CTY_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../sim-core/fixtures/cities/about.cty',
);

interface LoadFailureProbeResult {
  exitStatus: number | null;
  signal: NodeJS.Signals | null;
  beforeSaveCty: Uint8Array;
  afterSaveCty: Uint8Array;
}

interface LoadFailureProbeOptions {
  seed: number;
  payload: Uint8Array;
  mode: 'path' | 'bytes';
}

/**
 * Runs one `micropolis-core-oracle` command and returns the spawn result.
 *
 * Wraps CLI handling in `packages/micropolis-c-harness/core/core_oracle.c` (1:1 command
 * contract) while intentionally using `spawnSync` so tests can assert non-zero exit status.
 */
function runOracleCommand(
  args: readonly string[],
  options?: { stdinBytes?: Uint8Array },
): SpawnSyncReturns<Buffer> {
  const result = spawnSync(ensureCoreOracle(), args, {
    input: options?.stdinBytes,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return result;
}

/**
 * Probes failed `.cty` load behavior for `load-cty` and `load-cty-bytes`.
 *
 * Mirrors the failure branch in `main` in `packages/micropolis-c-harness/core/core_oracle.c`
 * where load failures return exit code `1` before `SaveStateDir`, matching `loadFile` failure
 * flow in `ref/micropolis/src/sim/s_fileio.c` (no state mutation on failed load).
 */
function probeLoadFailure(options: LoadFailureProbeOptions): LoadFailureProbeResult {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'core-oracle-load-cty-negative-'));
  const ctyPath = path.join(stateDir, 'invalid.cty');

  try {
    const initResult = runOracleCommand([
      'init-new-city',
      '--state-dir',
      stateDir,
      '--seed',
      `${Math.trunc(options.seed) >>> 0}`,
    ]);
    expect(initResult.status).toBe(0);

    const beforeSaveResult = runOracleCommand(['save-cty', '--state-dir', stateDir]);
    expect(beforeSaveResult.status).toBe(0);

    let loadResult: SpawnSyncReturns<Buffer>;
    if (options.mode === 'path') {
      writeFileSync(ctyPath, options.payload);
      loadResult = runOracleCommand(['load-cty', '--state-dir', stateDir, '--cty-path', ctyPath]);
    } else {
      loadResult = runOracleCommand(['load-cty-bytes', '--state-dir', stateDir], {
        stdinBytes: options.payload,
      });
    }

    const afterSaveResult = runOracleCommand(['save-cty', '--state-dir', stateDir]);
    expect(afterSaveResult.status).toBe(0);

    return {
      exitStatus: loadResult.status,
      signal: loadResult.signal,
      beforeSaveCty: new Uint8Array(beforeSaveResult.stdout),
      afterSaveCty: new Uint8Array(afterSaveResult.stdout),
    };
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

describe('core oracle .cty load command parity', () => {
  it('matches load-cty and load-cty-bytes state for the same fixture payload', () => {
    const startState = runCoreOracleInitNewCity({ seed: 0x00c7f1e });
    const ctyBytes = readFileSync(ABOUT_CTY_FIXTURE);
    const tempDir = mkdtempSync(path.join(tmpdir(), 'core-oracle-load-cty-'));
    const ctyPath = path.join(tempDir, 'about.cty');
    writeFileSync(ctyPath, ctyBytes);

    try {
      // Mirrors `loadFile` semantics in `ref/micropolis/src/sim/s_fileio.c`.
      const loadedFromPath = runCoreOracleLoadCty({
        state: startState,
        ctyPath,
      });
      // Mirrors `_load_file` + `loadFile` via stdin bytes in the same C loader path.
      const loadedFromBytes = runCoreOracleLoadCtyBytes({
        state: startState,
        ctyBytes,
      });

      expect(loadedFromPath).toEqual(loadedFromBytes);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('matches load-cty and load-cty-bytes state for oracle-generated payloads', () => {
    const savedFromState = runCoreOracleInitNewCity({ seed: 0x00012345 });
    const ctyBytes = runCoreOracleSaveCty({ state: savedFromState });
    const startState = runCoreOracleInitNewCity({ seed: 0x00098765 });
    const tempDir = mkdtempSync(path.join(tmpdir(), 'core-oracle-load-cty-'));
    const ctyPath = path.join(tempDir, 'saved.cty');
    writeFileSync(ctyPath, ctyBytes);

    try {
      // `saveFile` + `loadFile` roundtrip path in `ref/micropolis/src/sim/s_fileio.c`.
      const loadedFromPath = runCoreOracleLoadCty({
        state: startState,
        ctyPath,
      });
      // Same load path as above, but fed by stdin bytes for parity plumbing.
      const loadedFromBytes = runCoreOracleLoadCtyBytes({
        state: startState,
        ctyBytes,
      });

      expect(loadedFromPath).toEqual(loadedFromBytes);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails identically and preserves state for invalid .cty payloads', () => {
    const validFixture = readFileSync(ABOUT_CTY_FIXTURE);
    const invalidCases = [
      // `_load_file`/`loadFile` accepts only 27120/99120/219120-byte files in `s_fileio.c`.
      { name: 'empty payload', payload: new Uint8Array(0) },
      { name: 'unsupported short length', payload: new Uint8Array(27119) },
      // Malformed payload: valid city bytes with trailing garbage (invalid total file size).
      {
        name: 'valid payload with trailing byte',
        payload: Buffer.concat([validFixture, Buffer.from([0xff])]),
      },
    ] as const;

    for (const testCase of invalidCases) {
      const pathResult = probeLoadFailure({
        mode: 'path',
        seed: 0x0050beef,
        payload: testCase.payload,
      });
      const bytesResult = probeLoadFailure({
        mode: 'bytes',
        seed: 0x0050beef,
        payload: testCase.payload,
      });

      // `core_oracle.c` returns 1 for failed load commands (not usage errors).
      expect(pathResult.exitStatus, `path mode should fail: ${testCase.name}`).toBe(1);
      expect(bytesResult.exitStatus, `bytes mode should fail: ${testCase.name}`).toBe(1);
      expect(pathResult.signal).toBe(bytesResult.signal);

      expect(pathResult.beforeSaveCty).toEqual(pathResult.afterSaveCty);
      expect(bytesResult.beforeSaveCty).toEqual(bytesResult.afterSaveCty);
      expect(pathResult.beforeSaveCty).toEqual(bytesResult.beforeSaveCty);
      expect(pathResult.afterSaveCty).toEqual(bytesResult.afterSaveCty);
    }
  });
});
