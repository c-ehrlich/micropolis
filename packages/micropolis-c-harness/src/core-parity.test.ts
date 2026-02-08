import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  runCoreOracleInitNewCity,
  runCoreOracleLoadCty,
  runCoreOracleLoadCtyBytes,
  runCoreOracleLoadCtyBytesFailureProbe,
  runCoreOracleLoadCtyFailureProbe,
  runCoreOracleSaveCty,
} from './core-parity.ts';

const ABOUT_CTY_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../sim-core/fixtures/cities/about.cty',
);

/**
 * Normalizes source-specific stderr text so path/stdin variants can be compared.
 *
 * Mirrors source-label differences from `LoadCtyBytes` diagnostics in
 * `packages/micropolis-c-harness/core/core_oracle.c` while preserving message shape.
 */
function normalizeLoadFailureStderrShape(stderrText: string): string {
  return stderrText
    .trim()
    .replace(
      /cty payload too small for 120x100 map: .+/gu,
      'cty payload too small for 120x100 map: <source>',
    )
    .replace(/cty map payload too short: .+/gu, 'cty map payload too short: <source>');
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
      const startState = runCoreOracleInitNewCity({ seed: 0x0050beef });
      const tempDir = mkdtempSync(path.join(tmpdir(), 'core-oracle-load-cty-negative-'));
      const ctyPath = path.join(tempDir, 'invalid.cty');

      try {
        writeFileSync(ctyPath, testCase.payload);
        const pathResult = runCoreOracleLoadCtyFailureProbe({
          state: startState,
          ctyPath,
        });
        const bytesResult = runCoreOracleLoadCtyBytesFailureProbe({
          state: startState,
          ctyBytes: testCase.payload,
        });

        // `core_oracle.c` returns 1 for failed load commands (not usage errors).
        expect(pathResult.command.exitStatus, `path mode should fail: ${testCase.name}`).toBe(1);
        expect(bytesResult.command.exitStatus, `bytes mode should fail: ${testCase.name}`).toBe(1);
        expect(pathResult.command.signal).toBe(bytesResult.command.signal);

        const pathStderrShape = normalizeLoadFailureStderrShape(pathResult.command.stderr);
        const bytesStderrShape = normalizeLoadFailureStderrShape(bytesResult.command.stderr);
        expect(pathStderrShape).toEqual(bytesStderrShape);
        expect(pathStderrShape).toMatch(/^unsupported cty size: \d+$/u);

        expect(pathResult.beforeSaveCty).toEqual(pathResult.afterSaveCty);
        expect(bytesResult.beforeSaveCty).toEqual(bytesResult.afterSaveCty);
        expect(pathResult.beforeSaveCty).toEqual(bytesResult.beforeSaveCty);
        expect(pathResult.afterSaveCty).toEqual(bytesResult.afterSaveCty);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });
});
