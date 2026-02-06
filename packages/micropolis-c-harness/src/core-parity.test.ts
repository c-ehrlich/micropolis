import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  runCoreOracleInitNewCity,
  runCoreOracleLoadCty,
  runCoreOracleLoadCtyBytes,
  runCoreOracleSaveCty,
} from './core-parity.ts';

const ABOUT_CTY_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../sim-core/fixtures/cities/about.cty',
);

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
});
