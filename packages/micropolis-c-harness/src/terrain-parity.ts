import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `WORLD_X` from `ref/micropolis/src/sim/headers/sim.h` (1:1 value). */
export const TERRAIN_WORLD_X = 120;
/** `WORLD_Y` from `ref/micropolis/src/sim/headers/sim.h` (1:1 value). */
export const TERRAIN_WORLD_Y = 100;
/** Tile count for `Map[WORLD_X][WORLD_Y]` from Micropolis terrain code. */
export const TERRAIN_TILE_COUNT = TERRAIN_WORLD_X * TERRAIN_WORLD_Y;
/** Byte size for a full map dump (`uint16_t` per tile). */
export const TERRAIN_U16LE_BYTE_SIZE = TERRAIN_TILE_COUNT * 2;

const HARNESS_PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS_BIN = path.join(HARNESS_PKG, 'build', 'terrain', 'micropolis-terrain-harness');
const HARNESS_BUILD_SCRIPT = path.join(HARNESS_PKG, 'scripts', 'build-terrain-harness.mjs');
const HARNESS_SOURCE = path.join(HARNESS_PKG, 'terrain', 'terrain_harness.c');
let hasEnsuredHarness = false;

/**
 * Ensures the standalone terrain harness binary exists.
 *
 * This helper wraps the C harness build from
 * `packages/micropolis-c-harness/scripts/build-terrain-harness.mjs`.
 */
export function ensureTerrainHarness(): string {
  if (hasEnsuredHarness) {
    return HARNESS_BIN;
  }

  const needsBuild =
    !existsSync(HARNESS_BIN) ||
    statSync(HARNESS_BIN).mtimeMs < statSync(HARNESS_SOURCE).mtimeMs ||
    statSync(HARNESS_BIN).mtimeMs < statSync(HARNESS_BUILD_SCRIPT).mtimeMs;

  if (needsBuild) {
    execFileSync(process.execPath, [HARNESS_BUILD_SCRIPT], { stdio: 'inherit' });
  }
  if (!existsSync(HARNESS_BIN)) {
    throw new Error(`expected harness binary at ${HARNESS_BIN}`);
  }
  hasEnsuredHarness = true;
  return HARNESS_BIN;
}

/**
 * Runs `micropolis-terrain-harness` with provided CLI arguments.
 *
 * The binary embeds C terrain code from `ref/micropolis/src/sim/s_gen.c`.
 */
export function runTerrainHarness(args: readonly string[]): Buffer {
  const bin = ensureTerrainHarness();
  return execFileSync(bin, [...args]);
}

export interface TerrainGenerateHarnessCase {
  /**
   * `seed` argument to `GenerateMap(seed)` in Micropolis C.
   *
   * C reference:
   * - `GenerateMap(int r)` in `ref/micropolis/src/sim/s_gen.c`.
   */
  seed: number;

  /**
   * `TreeLevel` global used by `GenerateMap`.
   *
   * C reference:
   * - `TreeLevel` in `ref/micropolis/src/sim/s_gen.c`.
   */
  treeLevel: number;

  /**
   * `LakeLevel` global used by `GenerateMap`.
   *
   * C reference:
   * - `LakeLevel` in `ref/micropolis/src/sim/s_gen.c`.
   */
  lakeLevel: number;

  /**
   * `CurveLevel` global used by `GenerateMap`.
   *
   * C reference:
   * - `CurveLevel` in `ref/micropolis/src/sim/s_gen.c`.
   */
  curveLevel: number;

  /**
   * `CreateIsland` global used by `GenerateMap`.
   *
   * C reference:
   * - `CreateIsland` in `ref/micropolis/src/sim/s_gen.c`.
   */
  createIsland: number;

  /**
   * Optional per-case flag to call `SmoothWater()` after `GenerateMap()`.
   *
   * C reference:
   * - `SmoothWater` in `ref/micropolis/src/sim/s_gen.c` (not called by `GenerateMap`).
   */
  runSmoothWater?: boolean;
}

/**
 * Runs many `GenerateMap` harness cases in one process.
 *
 * This uses harness `--batch-cases` mode, where each input line is:
 * `<seed:u32> <treeLevel:i32> <lakeLevel:i32> <curveLevel:i32> <createIsland:i32> <runSmoothWater:0|1>`.
 *
 * C reference:
 * - `GenerateMap(int r)` in `ref/micropolis/src/sim/s_gen.c`.
 */
export function runTerrainGenerateHarnessBatch(
  cases: readonly TerrainGenerateHarnessCase[],
): Uint16Array[] {
  if (cases.length === 0) {
    return [];
  }

  const bin = ensureTerrainHarness();
  const scratchDir = mkdtempSync(path.join(tmpdir(), 'terrain-harness-batch-'));
  const batchCasesPath = path.join(scratchDir, 'cases.txt');

  try {
    const body = cases
      .map((entry) => {
        return `${entry.seed >>> 0} ${Math.trunc(entry.treeLevel)} ${Math.trunc(entry.lakeLevel)} ${Math.trunc(entry.curveLevel)} ${Math.trunc(entry.createIsland)} ${entry.runSmoothWater ? 1 : 0}`;
      })
      .join('\n');
    writeFileSync(batchCasesPath, `${body}\n`);

    const raw = execFileSync(bin, [`--batch-cases=${batchCasesPath}`, '--format=u16le']);
    const expectedByteLength = cases.length * TERRAIN_U16LE_BYTE_SIZE;
    if (raw.byteLength !== expectedByteLength) {
      throw new Error(
        `batch output size mismatch: got=${raw.byteLength} expected=${expectedByteLength}`,
      );
    }

    const maps: Uint16Array[] = [];
    for (let offset = 0; offset < raw.byteLength; offset += TERRAIN_U16LE_BYTE_SIZE) {
      const slice = raw.subarray(offset, offset + TERRAIN_U16LE_BYTE_SIZE);
      maps.push(decodeTerrainMapU16LE(slice));
    }
    return maps;
  } finally {
    rmSync(scratchDir, { force: true, recursive: true });
  }
}

/**
 * Decodes x-major `u16le` map bytes to a `Uint16Array`.
 *
 * Matches the `Map[x][y]` dump order used in
 * `packages/micropolis-c-harness/terrain/terrain_harness.c`.
 */
export function decodeTerrainMapU16LE(bytes: Uint8Array): Uint16Array {
  if (bytes.byteLength % 2 !== 0) {
    throw new Error(`invalid u16le byte length: ${bytes.byteLength}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const words = new Uint16Array(bytes.byteLength / 2);
  for (let i = 0; i < words.length; i += 1) {
    words[i] = view.getUint16(i * 2, true);
  }
  return words;
}

/**
 * Encodes x-major `Map[x][y]` words as little-endian `uint16_t` bytes.
 *
 * This mirrors harness file I/O in `terrain_harness.c` rather than changing
 * map ordering.
 */
export function encodeTerrainMapU16LE(words: Uint16Array): Uint8Array {
  const bytes = new Uint8Array(words.length * 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word === undefined) {
      throw new Error(`expected map word at index ${i}`);
    }
    view.setUint16(i * 2, word, true);
  }
  return bytes;
}

/**
 * Reads a full terrain map dump (`WORLD_X * WORLD_Y` words) from disk.
 *
 * The shape follows Micropolis terrain map dimensions in `sim.h`.
 */
export function readTerrainMapU16LE(filePath: string): Uint16Array {
  return decodeTerrainMapU16LE(readFileSync(filePath));
}

/**
 * Writes a full terrain map dump (`WORLD_X * WORLD_Y` words) to disk.
 *
 * The byte format matches the C harness map loader/writer contract.
 */
export function writeTerrainMapU16LE(filePath: string, words: Uint16Array): void {
  if (words.length !== TERRAIN_TILE_COUNT) {
    throw new Error(
      `invalid terrain map word count: ${words.length} (expected ${TERRAIN_TILE_COUNT})`,
    );
  }
  writeFileSync(filePath, encodeTerrainMapU16LE(words));
}

export interface TerrainMapMismatch {
  actual: number;
  expected: number;
  index: number;
  x: number;
  y: number;
}

/**
 * Finds the first tile mismatch between two x-major terrain maps.
 *
 * Index-to-coordinate conversion follows `index = x * WORLD_Y + y`.
 */
export function findTerrainMapMismatch(
  actual: Uint16Array,
  expected: Uint16Array,
): TerrainMapMismatch | null {
  if (actual.length !== expected.length) {
    throw new Error(`map length mismatch: actual=${actual.length} expected=${expected.length}`);
  }

  for (let i = 0; i < expected.length; i += 1) {
    const actualWord = actual[i];
    const expectedWord = expected[i];
    if (actualWord === undefined || expectedWord === undefined) {
      throw new Error(`expected map words at index ${i}`);
    }
    if (actualWord !== expectedWord) {
      return {
        actual: actualWord,
        expected: expectedWord,
        index: i,
        x: Math.trunc(i / TERRAIN_WORLD_Y),
        y: i % TERRAIN_WORLD_Y,
      };
    }
  }

  return null;
}

/**
 * Formats a terrain mismatch report with x/y/index and tile values.
 *
 * This shape is shared by parity tests to keep diagnostics consistent.
 */
export function formatTerrainMapMismatch(mismatch: TerrainMapMismatch): string {
  return `map mismatch at x=${mismatch.x} y=${mismatch.y} index=${mismatch.index}: expected=${mismatch.expected} actual=${mismatch.actual}`;
}
