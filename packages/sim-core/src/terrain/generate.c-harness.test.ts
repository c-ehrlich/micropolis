import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { World } from '../core/constants.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { generateMap } from './generate.ts';

/**
 * Loads a raw `uint16_t` little-endian dump produced by `micropolis-terrain-harness`.
 *
 * C reference:
 * - Harness output format in `packages/micropolis-c-harness/terrain/terrain_harness.c`
 * - Tile storage is `Map[x][y]` in `ref/micropolis/src/sim/s_gen.c`.
 */
const loadU16LE = (filePath: string): Uint16Array => {
  const buf = readFileSync(filePath);
  expect(buf.byteLength % 2).toBe(0);

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const words = new Uint16Array(buf.byteLength / 2);
  for (let i = 0; i < words.length; i += 1) {
    words[i] = view.getUint16(i * 2, true);
  }
  return words;
};

/**
 * Asserts byte-for-byte equality of two classic Micropolis maps.
 *
 * C reference:
 * - World size constants in `ref/micropolis/src/sim/headers/sim.h` (`WORLD_X/WORLD_Y`).
 */
const expectMapsEqual = (actual: Uint16Array, expected: Uint16Array): void => {
  expect(actual).toHaveLength(World.WORLD_X * World.WORLD_Y);
  expect(expected).toHaveLength(World.WORLD_X * World.WORLD_Y);

  for (let i = 0; i < expected.length; i += 1) {
    if (actual[i] !== expected[i]) {
      const x = Math.trunc(i / World.WORLD_Y);
      const y = i % World.WORLD_Y;
      throw new Error(
        `map mismatch at x=${x} y=${y} index=${i}: expected=${expected[i]} actual=${actual[i]}`,
      );
    }
  }
};

const SIM_CORE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_DIR = path.join(SIM_CORE_ROOT, 'fixtures', 'terrain');

describe('terrain/generateMap parity against C fixtures', () => {
  const manifestPath = path.join(FIXTURE_DIR, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    fixtures: Array<{
      seed: number;
      treeLevel: number;
      lakeLevel: number;
      curveLevel: number;
      createIsland: number;
      file: string;
    }>;
  };

  for (const fixture of manifest.fixtures) {
    it(`matches ${fixture.file}`, () => {
      const expected = loadU16LE(path.join(FIXTURE_DIR, fixture.file));

      const state = createSimState();
      const context = createSimContext();
      generateMap(state, context, {
        seed: fixture.seed,
        treeLevel: fixture.treeLevel,
        lakeLevel: fixture.lakeLevel,
        curveLevel: fixture.curveLevel,
        createIsland: fixture.createIsland,
        reseedAfter: false,
      });

      const actual = context.store.snapshot('map');
      expect(actual).toBeInstanceOf(Uint16Array);
      expectMapsEqual(actual as Uint16Array, expected);
    });
  }
});

describe('terrain/generateMap property parity against C harness (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  const HARNESS_PKG = path.resolve(SIM_CORE_ROOT, '..', 'micropolis-c-harness');
  const HARNESS_BIN = path.join(HARNESS_PKG, 'build', 'terrain', 'micropolis-terrain-harness');
  const HARNESS_BUILD_SCRIPT = path.join(HARNESS_PKG, 'scripts', 'build-terrain-harness.mjs');

  const ensureHarness = (): void => {
    if (existsSync(HARNESS_BIN)) {
      return;
    }
    execFileSync(process.execPath, [HARNESS_BUILD_SCRIPT], { stdio: 'inherit' });
    if (!existsSync(HARNESS_BIN)) {
      throw new Error(`expected harness binary at ${HARNESS_BIN}`);
    }
  };

  /**
   * Runs the terrain harness and returns the generated map as a `Uint16Array`.
   *
   * C reference:
   * - `GenerateMap(int r)` in `ref/micropolis/src/sim/s_gen.c`.
   */
  const runHarness = (opts: {
    seed: number;
    treeLevel: number;
    lakeLevel: number;
    curveLevel: number;
    createIsland: number;
  }): Uint16Array => {
    const out = execFileSync(HARNESS_BIN, [
      `--seed=${opts.seed}`,
      `--treeLevel=${opts.treeLevel}`,
      `--lakeLevel=${opts.lakeLevel}`,
      `--curveLevel=${opts.curveLevel}`,
      `--createIsland=${opts.createIsland}`,
      '--format=u16le',
    ]);

    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const words = new Uint16Array(out.byteLength / 2);
    for (let i = 0; i < words.length; i += 1) {
      words[i] = view.getUint16(i * 2, true);
    }
    return words;
  };

  it('matches C for many random seeds/knobs', () => {
    ensureHarness();

    const numRuns = process.env.CITY_TEST_PARITY_RUNS
      ? Math.trunc(Number(process.env.CITY_TEST_PARITY_RUNS))
      : 25;
    const rawSeed = process.env.CITY_TEST_PARITY_FC_SEED
      ? Math.trunc(Number(process.env.CITY_TEST_PARITY_FC_SEED))
      : 123456789;

    // `fast-check` seed must be a finite integer.
    const fcSeed = Number.isFinite(rawSeed) ? rawSeed : 123456789;

    fc.assert(
      fc.property(
        fc.record({
          seed: fc.integer({ min: 0, max: 0xffff_ffff }),
          treeLevel: fc.constantFrom(-1, 0, 1, 5, 10),
          lakeLevel: fc.constantFrom(-1, 0, 1, 10),
          curveLevel: fc.constantFrom(-1, 0, 1, 10),
          createIsland: fc.constantFrom(-1, 0, 1),
        }),
        (opts) => {
          const expected = runHarness(opts);

          const state = createSimState();
          const context = createSimContext();
          generateMap(state, context, { ...opts, reseedAfter: false });

          const actual = context.store.snapshot('map') as Uint16Array;
          expectMapsEqual(actual, expected);
        },
      ),
      { numRuns: Number.isFinite(numRuns) && numRuns > 0 ? numRuns : 25, seed: fcSeed },
    );
  });
});
