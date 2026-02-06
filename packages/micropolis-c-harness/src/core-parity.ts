import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `WORLD_X` from `ref/micropolis/src/sim/headers/sim.h` (1:1 value). */
export const CORE_WORLD_X = 120;
/** `WORLD_Y` from `ref/micropolis/src/sim/headers/sim.h` (1:1 value). */
export const CORE_WORLD_Y = 100;
/** `HWLDX` from `ref/micropolis/src/sim/headers/sim.h` (1:1 value). */
export const CORE_HWLDX = CORE_WORLD_X >> 1;
/** `HWLDY` from `ref/micropolis/src/sim/headers/sim.h` (1:1 value). */
export const CORE_HWLDY = CORE_WORLD_Y >> 1;
/** `SmX` from `ref/micropolis/src/sim/headers/sim.h` (1:1 value). */
export const CORE_SMX = CORE_WORLD_X >> 3;
/** `SmY` from `ref/micropolis/src/sim/headers/sim.h` (1:1 value). */
export const CORE_SMY = (CORE_WORLD_Y + 7) >> 3;

/** Word count for `Map[WORLD_X][WORLD_Y]` in Micropolis C. */
export const CORE_MAP_WORD_COUNT = CORE_WORLD_X * CORE_WORLD_Y;
/** Cell count for `TrfDensity[HWLDX][HWLDY]` in Micropolis C. */
export const CORE_TRF_CELL_COUNT = CORE_HWLDX * CORE_HWLDY;
/** Cell count for `RateOGMem[SmX][SmY]` in Micropolis C. */
export const CORE_ROG_CELL_COUNT = CORE_SMX * CORE_SMY;

const HARNESS_PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_BIN = path.join(HARNESS_PKG, 'build', 'core', 'micropolis-core-oracle');
const CORE_BUILD_SCRIPT = path.join(HARNESS_PKG, 'scripts', 'build-core-oracle.mjs');
const CORE_SOURCE = path.join(HARNESS_PKG, 'core', 'core_oracle.c');
const CORE_HEADER = path.join(HARNESS_PKG, 'core', 'sim.h');
const TRAFFIC_SOURCE = path.resolve(
  HARNESS_PKG,
  '..',
  '..',
  'ref',
  'micropolis',
  'src',
  'sim',
  's_traf.c',
);

const SNAPSHOT_FILE = 'snapshot.json';
const MAP_FILE = 'map.u16le';
const TRF_FILE = 'trf-density.u8';
const ROG_FILE = 'rate-og-mem.i16le';

let hasEnsuredCoreOracle = false;

export interface CoreOracleMapFlags {
  ALMAP: number;
  REMAP: number;
  COMAP: number;
  INMAP: number;
  PRMAP: number;
  RDMAP: number;
  TDMAP: number;
  DYMAP: number;
}

export interface CoreOracleState {
  snapshotVersion: number;
  snapshotFormat: 'json+binary';
  snapshotFormatTodo: string;
  rngNext: number;
  CityTime: number;
  CityTax: number;
  AvCityTax: number;
  Scycle: number;
  Fcycle: number;
  SimSpeed: number;
  DoInitialEval: number;
  NewPower: number;
  TrafMaxX: number;
  TrafMaxY: number;
  copControl: number;
  copDestX: number;
  copDestY: number;
  NewMapFlags: CoreOracleMapFlags;
  map: Uint16Array;
  trfDensity: Uint8Array;
  rateOGMem: Int16Array;
}

export interface CoreOracleInitNewCityOptions {
  seed?: number;
  cityTime?: number;
  cityTax?: number;
  simSpeed?: number;
}

export interface CoreOracleMakeTrafOptions {
  state: CoreOracleState;
  x: number;
  y: number;
  source: 0 | 1 | 2;
}

export interface CoreOracleMakeTrafResult {
  result: -1 | 0 | 1;
  state: CoreOracleState;
}

interface CoreOracleSnapshotJson {
  snapshotVersion: number;
  snapshotFormat: 'json+binary';
  snapshotFormatTodo: string;
  rngNext: number;
  CityTime: number;
  CityTax: number;
  AvCityTax: number;
  Scycle: number;
  Fcycle: number;
  SimSpeed: number;
  DoInitialEval: number;
  NewPower: number;
  TrafMaxX: number;
  TrafMaxY: number;
  copControl: number;
  copDestX: number;
  copDestY: number;
  NewMapFlags_ALMAP: number;
  NewMapFlags_REMAP: number;
  NewMapFlags_COMAP: number;
  NewMapFlags_INMAP: number;
  NewMapFlags_PRMAP: number;
  NewMapFlags_RDMAP: number;
  NewMapFlags_TDMAP: number;
  NewMapFlags_DYMAP: number;
}

/**
 * Ensures `micropolis-core-oracle` is available.
 *
 * Wraps `packages/micropolis-c-harness/scripts/build-core-oracle.mjs`, which compiles
 * the headless core oracle and the reference `s_traf.c` translation unit.
 */
export function ensureCoreOracle(): string {
  if (hasEnsuredCoreOracle) {
    return CORE_BIN;
  }

  const needsBuild =
    !existsSync(CORE_BIN) ||
    statSync(CORE_BIN).mtimeMs < statSync(CORE_BUILD_SCRIPT).mtimeMs ||
    statSync(CORE_BIN).mtimeMs < statSync(CORE_SOURCE).mtimeMs ||
    statSync(CORE_BIN).mtimeMs < statSync(CORE_HEADER).mtimeMs ||
    statSync(CORE_BIN).mtimeMs < statSync(TRAFFIC_SOURCE).mtimeMs;

  if (needsBuild) {
    execFileSync(process.execPath, [CORE_BUILD_SCRIPT], { stdio: 'inherit' });
  }
  if (!existsSync(CORE_BIN)) {
    throw new Error(`expected core oracle binary at ${CORE_BIN}`);
  }

  hasEnsuredCoreOracle = true;
  return CORE_BIN;
}

/**
 * Decodes little-endian `uint16_t` words from oracle sidecars.
 *
 * Maps to x-major `Map[x][y]` dumps from the core oracle.
 */
export function decodeCoreU16LE(bytes: Uint8Array): Uint16Array {
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
 * Encodes words as little-endian `uint16_t` for oracle sidecars.
 *
 * Used for `map.u16le` and `rate-og-mem.i16le` payload creation.
 */
export function encodeCoreU16LE(words: Uint16Array): Uint8Array {
  const bytes = new Uint8Array(words.length * 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word === undefined) {
      throw new Error(`expected word at index ${i}`);
    }
    view.setUint16(i * 2, word, true);
  }
  return bytes;
}

/**
 * Encodes signed 16-bit words as little-endian for `RateOGMem`.
 *
 * Mirrors `short RateOGMem[SmX][SmY]` in `ref/micropolis/src/sim/s_sim.c`.
 */
export function encodeCoreI16LE(words: Int16Array): Uint8Array {
  const bytes = new Uint8Array(words.length * 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word === undefined) {
      throw new Error(`expected i16 word at index ${i}`);
    }
    view.setInt16(i * 2, word, true);
  }
  return bytes;
}

/**
 * Decodes little-endian signed 16-bit words from oracle sidecars.
 *
 * Mirrors `short RateOGMem[SmX][SmY]` in `ref/micropolis/src/sim/s_sim.c`.
 */
export function decodeCoreI16LE(bytes: Uint8Array): Int16Array {
  if (bytes.byteLength % 2 !== 0) {
    throw new Error(`invalid i16le byte length: ${bytes.byteLength}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const words = new Int16Array(bytes.byteLength / 2);
  for (let i = 0; i < words.length; i += 1) {
    words[i] = view.getInt16(i * 2, true);
  }
  return words;
}

/**
 * Executes a single headless oracle command invocation.
 *
 * This wraps the CLI contract implemented in `core/core_oracle.c`.
 */
function runCoreOracle(args: readonly string[]): Buffer {
  const bin = ensureCoreOracle();
  return execFileSync(bin, [...args]);
}

/**
 * Writes one full oracle snapshot directory (`json+binary` sidecars).
 *
 * The file set mirrors the state layout handled by `core_oracle.c`.
 */
function writeCoreOracleState(dir: string, state: CoreOracleState): void {
  const snapshot: CoreOracleSnapshotJson = {
    snapshotVersion: state.snapshotVersion,
    snapshotFormat: state.snapshotFormat,
    snapshotFormatTodo: state.snapshotFormatTodo,
    rngNext: state.rngNext >>> 0,
    CityTime: Math.trunc(state.CityTime),
    CityTax: Math.trunc(state.CityTax),
    AvCityTax: Math.trunc(state.AvCityTax),
    Scycle: Math.trunc(state.Scycle),
    Fcycle: Math.trunc(state.Fcycle),
    SimSpeed: Math.trunc(state.SimSpeed),
    DoInitialEval: Math.trunc(state.DoInitialEval),
    NewPower: Math.trunc(state.NewPower),
    TrafMaxX: Math.trunc(state.TrafMaxX),
    TrafMaxY: Math.trunc(state.TrafMaxY),
    copControl: Math.trunc(state.copControl),
    copDestX: Math.trunc(state.copDestX),
    copDestY: Math.trunc(state.copDestY),
    NewMapFlags_ALMAP: Math.trunc(state.NewMapFlags.ALMAP),
    NewMapFlags_REMAP: Math.trunc(state.NewMapFlags.REMAP),
    NewMapFlags_COMAP: Math.trunc(state.NewMapFlags.COMAP),
    NewMapFlags_INMAP: Math.trunc(state.NewMapFlags.INMAP),
    NewMapFlags_PRMAP: Math.trunc(state.NewMapFlags.PRMAP),
    NewMapFlags_RDMAP: Math.trunc(state.NewMapFlags.RDMAP),
    NewMapFlags_TDMAP: Math.trunc(state.NewMapFlags.TDMAP),
    NewMapFlags_DYMAP: Math.trunc(state.NewMapFlags.DYMAP),
  };

  if (state.map.length !== CORE_MAP_WORD_COUNT) {
    throw new Error(`invalid map length: ${state.map.length} (expected ${CORE_MAP_WORD_COUNT})`);
  }
  if (state.trfDensity.length !== CORE_TRF_CELL_COUNT) {
    throw new Error(
      `invalid trfDensity length: ${state.trfDensity.length} (expected ${CORE_TRF_CELL_COUNT})`,
    );
  }
  if (state.rateOGMem.length !== CORE_ROG_CELL_COUNT) {
    throw new Error(
      `invalid rateOGMem length: ${state.rateOGMem.length} (expected ${CORE_ROG_CELL_COUNT})`,
    );
  }

  writeFileSync(path.join(dir, SNAPSHOT_FILE), `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileSync(path.join(dir, MAP_FILE), encodeCoreU16LE(state.map));
  writeFileSync(path.join(dir, TRF_FILE), state.trfDensity);
  writeFileSync(path.join(dir, ROG_FILE), encodeCoreI16LE(state.rateOGMem));
}

/**
 * Reads one full oracle snapshot directory into a typed TS structure.
 *
 * The binary decode order matches C x-major array dumps.
 */
function readCoreOracleState(dir: string): CoreOracleState {
  const snapshot = JSON.parse(
    readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8'),
  ) as CoreOracleSnapshotJson;
  const map = decodeCoreU16LE(readFileSync(path.join(dir, MAP_FILE)));
  const trfDensity = new Uint8Array(readFileSync(path.join(dir, TRF_FILE)));
  const rateOGMem = decodeCoreI16LE(readFileSync(path.join(dir, ROG_FILE)));

  if (map.length !== CORE_MAP_WORD_COUNT) {
    throw new Error(`oracle map size mismatch: ${map.length} (expected ${CORE_MAP_WORD_COUNT})`);
  }
  if (trfDensity.length !== CORE_TRF_CELL_COUNT) {
    throw new Error(
      `oracle trfDensity size mismatch: ${trfDensity.length} (expected ${CORE_TRF_CELL_COUNT})`,
    );
  }
  if (rateOGMem.length !== CORE_ROG_CELL_COUNT) {
    throw new Error(
      `oracle rateOGMem size mismatch: ${rateOGMem.length} (expected ${CORE_ROG_CELL_COUNT})`,
    );
  }

  return {
    snapshotVersion: snapshot.snapshotVersion,
    snapshotFormat: snapshot.snapshotFormat,
    snapshotFormatTodo: snapshot.snapshotFormatTodo,
    rngNext: snapshot.rngNext >>> 0,
    CityTime: snapshot.CityTime,
    CityTax: snapshot.CityTax,
    AvCityTax: snapshot.AvCityTax,
    Scycle: snapshot.Scycle,
    Fcycle: snapshot.Fcycle,
    SimSpeed: snapshot.SimSpeed,
    DoInitialEval: snapshot.DoInitialEval,
    NewPower: snapshot.NewPower,
    TrafMaxX: snapshot.TrafMaxX,
    TrafMaxY: snapshot.TrafMaxY,
    copControl: snapshot.copControl,
    copDestX: snapshot.copDestX,
    copDestY: snapshot.copDestY,
    NewMapFlags: {
      ALMAP: snapshot.NewMapFlags_ALMAP,
      REMAP: snapshot.NewMapFlags_REMAP,
      COMAP: snapshot.NewMapFlags_COMAP,
      INMAP: snapshot.NewMapFlags_INMAP,
      PRMAP: snapshot.NewMapFlags_PRMAP,
      RDMAP: snapshot.NewMapFlags_RDMAP,
      TDMAP: snapshot.NewMapFlags_TDMAP,
      DYMAP: snapshot.NewMapFlags_DYMAP,
    },
    map,
    trfDensity,
    rateOGMem,
  };
}

/**
 * Allocates and cleans a temporary oracle state directory for one command flow.
 *
 * This keeps tests deterministic and isolated across invocations.
 */
function withTempStateDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'core-oracle-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * Creates a fresh deterministic oracle city state.
 *
 * This maps to headless initialization in `core_oracle.c`, which seeds RNG and clears
 * `Map`, `TrfDensity`, and `RateOGMem` in C-compatible layouts.
 */
export function runCoreOracleInitNewCity(
  options: CoreOracleInitNewCityOptions = {},
): CoreOracleState {
  return withTempStateDir((stateDir) => {
    const args = ['init-new-city', '--state-dir', stateDir] as string[];
    if (options.seed !== undefined) {
      args.push('--seed', `${Math.trunc(options.seed) >>> 0}`);
    }
    if (options.cityTime !== undefined) {
      args.push('--city-time', `${Math.trunc(options.cityTime)}`);
    }
    if (options.cityTax !== undefined) {
      args.push('--city-tax', `${Math.trunc(options.cityTax)}`);
    }
    if (options.simSpeed !== undefined) {
      args.push('--sim-speed', `${Math.trunc(options.simSpeed)}`);
    }

    runCoreOracle(args);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Steps one simulation phase via C `Simulate(mod16)`.
 *
 * Mirrors `Simulate` in `ref/micropolis/src/sim/s_sim.c` using the oracle's
 * headless stubbed subsystems.
 */
export function runCoreOracleStepPhase(state: CoreOracleState, phase: number): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, state);
    runCoreOracle(['step-phase', '--state-dir', stateDir, '--phase', `${Math.trunc(phase)}`]);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Steps sixteen phases in sequence.
 *
 * Mirrors a deterministic tick-like progression over C `Simulate` phases.
 */
export function runCoreOracleStepTick(state: CoreOracleState, startPhase = 0): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, state);
    runCoreOracle([
      'step-tick',
      '--state-dir',
      stateDir,
      '--start-phase',
      `${Math.trunc(startPhase)}`,
    ]);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Runs C `MakeTraf` and returns result + updated snapshot state.
 *
 * Mirrors `MakeTraf` in `ref/micropolis/src/sim/s_traf.c` including `TrfDensity`
 * writes and `TrafMaxX/TrafMaxY` updates.
 */
export function runCoreOracleMakeTraf(
  options: CoreOracleMakeTrafOptions,
): CoreOracleMakeTrafResult {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, options.state);
    const raw = runCoreOracle([
      'make-traf',
      '--state-dir',
      stateDir,
      '--x',
      `${Math.trunc(options.x)}`,
      '--y',
      `${Math.trunc(options.y)}`,
      '--source',
      `${Math.trunc(options.source)}`,
    ]);
    const parsed = JSON.parse(raw.toString('utf8')) as { result: number };
    const result = parsed.result;
    if (result !== -1 && result !== 0 && result !== 1) {
      throw new Error(`unexpected make-traf result: ${result}`);
    }

    return {
      result,
      state: readCoreOracleState(stateDir),
    };
  });
}

/**
 * Reads scalar snapshot info through the oracle `snapshot` command.
 *
 * This command is intentionally lightweight and omits binary payloads.
 */
export function runCoreOracleSnapshot(state: CoreOracleState): Record<string, number> {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, state);
    const raw = runCoreOracle(['snapshot', '--state-dir', stateDir]);
    return JSON.parse(raw.toString('utf8')) as Record<string, number>;
  });
}
