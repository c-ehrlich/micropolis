import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  runTerrainHarness,
  TERRAIN_TILE_COUNT,
  TERRAIN_WORLD_Y,
  writeTerrainMapU16LE,
} from '@city/micropolis-c-harness/terrain-parity';
import { describe, expect, it } from 'vitest';

/**
 * Builds a deterministic map payload for harness I/O parity checks.
 *
 * The tile count and x-major index math mirror `Map[WORLD_X][WORLD_Y]` from
 * `ref/micropolis/src/sim/s_gen.c` and `ref/micropolis/src/sim/headers/sim.h`.
 */
const makeDeterministicMap = (): Uint16Array => {
  const words = new Uint16Array(TERRAIN_TILE_COUNT);
  for (let i = 0; i < words.length; i += 1) {
    const x = Math.trunc(i / TERRAIN_WORLD_Y);
    const y = i % TERRAIN_WORLD_Y;
    // Mixed x/y coefficients exercise both low/high u16 bytes in round-trips.
    words[i] = (x * 257 + y * 17) & 0xffff;
  }
  return words;
};

describe('terrain harness --op noop parity (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  it('preserves exact u16le bytes for input-map -> output', () => {
    const caseDir = mkdtempSync(path.join(tmpdir(), 'city-terrain-noop-'));
    const inputPath = path.join(caseDir, 'input.u16le');
    const outputPath = path.join(caseDir, 'output.u16le');

    try {
      writeTerrainMapU16LE(inputPath, makeDeterministicMap());
      runTerrainHarness([
        '--op=noop',
        `--input-map=${inputPath}`,
        '--format=u16le',
        `--dump-path=${outputPath}`,
      ]);

      const inputBytes = readFileSync(inputPath);
      const outputBytes = readFileSync(outputPath);
      expect(outputBytes.equals(inputBytes)).toBe(true);
    } finally {
      rmSync(caseDir, { force: true, recursive: true });
    }
  });
});
