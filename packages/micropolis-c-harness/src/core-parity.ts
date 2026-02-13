import { execFileSync, spawnSync } from 'node:child_process';
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
/** `QWX` from `ref/micropolis/src/sim/headers/sim.h` (1:1 value). */
export const CORE_QWX = CORE_WORLD_X >> 2;
/** `QWY` from `ref/micropolis/src/sim/headers/sim.h` (1:1 value). */
export const CORE_QWY = (CORE_WORLD_Y + 3) >> 2;

/** Word count for `Map[WORLD_X][WORLD_Y]` in Micropolis C. */
export const CORE_MAP_WORD_COUNT = CORE_WORLD_X * CORE_WORLD_Y;
/** Cell count for `TrfDensity[HWLDX][HWLDY]` in Micropolis C. */
export const CORE_TRF_CELL_COUNT = CORE_HWLDX * CORE_HWLDY;
/** Cell count for `RateOGMem[SmX][SmY]` in Micropolis C. */
export const CORE_ROG_CELL_COUNT = CORE_SMX * CORE_SMY;
/** Cell count for half-resolution (`2x2`) maps in Micropolis C. */
export const CORE_HALF_CELL_COUNT = CORE_HWLDX * CORE_HWLDY;
/** Cell count for quarter-resolution (`4x4`) maps in Micropolis C. */
export const CORE_QUARTER_CELL_COUNT = CORE_QWX * CORE_QWY;
/** Cell count for small-resolution (`8x8`) maps in Micropolis C. */
export const CORE_SMALL_CELL_COUNT = CORE_SMX * CORE_SMY;
/** Word count for each `*His` history array in Micropolis C (`HISTLEN / 2`). */
export const CORE_HISTORY_WORD_COUNT = 240;
/** Word count for `MiscHis` in Micropolis C (`MISCHISTLEN / 2`). */
export const CORE_MISC_WORD_COUNT = 120;
/** Word count for `PowerMap[PWRMAPSIZE]` in Micropolis C runtime usage. */
export const CORE_POWER_WORD_COUNT = ((CORE_WORLD_X + 15) >> 4) * CORE_WORLD_Y;
/** Byte count for `PowerStackX/Y[PWRSTKSIZE]` in Micropolis C. */
export const CORE_POWER_STACK_COUNT = (CORE_WORLD_X * CORE_WORLD_Y) >> 2;
/** Rendered point count per graph range (`10`/`120`) in `w_graph.c`. */
export const CORE_GRAPH_POINT_COUNT = 120;
/** Rendered graph series count (`RES..POLLUTION`) in `w_graph.c`. */
export const CORE_GRAPH_SERIES_COUNT = 6;

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
const POWER_SOURCE = path.resolve(
  HARNESS_PKG,
  '..',
  '..',
  'ref',
  'micropolis',
  'src',
  'sim',
  's_power.c',
);
const SCAN_SOURCE = path.resolve(
  HARNESS_PKG,
  '..',
  '..',
  'ref',
  'micropolis',
  'src',
  'sim',
  's_scan.c',
);
const CONNECTIVITY_SOURCE = path.resolve(
  HARNESS_PKG,
  '..',
  '..',
  'ref',
  'micropolis',
  'src',
  'sim',
  'w_con.c',
);

const SNAPSHOT_FILE = 'snapshot.json';
const MAP_FILE = 'map.u16le';
const TRF_FILE = 'trf-density.u8';
const ROG_FILE = 'rate-og-mem.i16le';
const POP_DENSITY_FILE = 'pop-density.u8';
const POLLUTION_FILE = 'pollution-mem.u8';
const LAND_VALUE_FILE = 'land-value-mem.u8';
const CRIME_FILE = 'crime-mem.u8';
const TERRAIN_FILE = 'terrain-mem.u8';
const FIRE_ST_FILE = 'fire-st-map.i16le';
const POLICE_FILE = 'police-map.i16le';
const POLICE_EFFECT_FILE = 'police-map-effect.i16le';
const FIRE_RATE_FILE = 'fire-rate.i16le';
const COM_RATE_FILE = 'com-rate.i16le';
const RES_HIS_FILE = 'res-his.i16le';
const COM_HIS_FILE = 'com-his.i16le';
const IND_HIS_FILE = 'ind-his.i16le';
const CRIME_HIS_FILE = 'crime-his.i16le';
const POLLUTION_HIS_FILE = 'pollution-his.i16le';
const MONEY_HIS_FILE = 'money-his.i16le';
const MISC_HIS_FILE = 'misc-his.i16le';
const POWER_FILE = 'power.u16le';
const POWER_STACK_X_FILE = 'power-stack-x.u8';
const POWER_STACK_Y_FILE = 'power-stack-y.u8';

let hasEnsuredCoreOracle = false;

export interface CoreOracleMapFlags {
  ALMAP: number;
  REMAP: number;
  COMAP: number;
  INMAP: number;
  PRMAP: number;
  RDMAP: number;
  PDMAP: number;
  RGMAP: number;
  TDMAP: number;
  PLMAP: number;
  CRMAP: number;
  LVMAP: number;
  FIMAP: number;
  POMAP: number;
  DYMAP: number;
}

export interface CoreOracleState {
  snapshotVersion: number;
  snapshotFormat: 'json+binary';
  snapshotFormatTodo: string;
  rngNext: number;
  TickNow: number;
  CityTime: number;
  StartingYear: number;
  CityTax: number;
  GameLevel: number;
  TaxFlag: number;
  AvCityTax: number;
  Scycle: number;
  Fcycle: number;
  SimSpeed: number;
  DoInitialEval: number;
  NewPower: number;
  MustUpdateOptions: number;
  LastCityTime: number;
  LastCityYear: number;
  LastCityMonth: number;
  LastFunds: number;
  TotalFunds: number;
  TaxFund: number;
  RoadFund: number;
  PoliceFund: number;
  FireFund: number;
  CashFlow: number;
  RoadSpend: number;
  PoliceSpend: number;
  FireSpend: number;
  roadPercent: number;
  policePercent: number;
  firePercent: number;
  autoBudget: number;
  autoBulldoze: number;
  autoGo: number;
  UserSoundOn: number;
  DoAnimation: number;
  DoMessages: number;
  DoNotices: number;
  RoadTotal: number;
  RailTotal: number;
  RoadEffect: number;
  PoliceEffect: number;
  FireEffect: number;
  PolicePop: number;
  FireStPop: number;
  LVAverage: number;
  MessagePort: number;
  MesX: number;
  MesY: number;
  MesNum: number;
  LastMesTime: number;
  LastPicNum: number;
  ScenarioID: number;
  ScoreType: number;
  ScoreWait: number;
  LastCityPop: number;
  LastCategory: number;
  CityClass: number;
  CityScore: number;
  TrafficAverage: number;
  CrimeAverage: number;
  PolluteAverage: number;
  ResPop: number;
  ComPop: number;
  IndPop: number;
  TotalPop: number;
  ResZPop: number;
  ComZPop: number;
  IndZPop: number;
  TotalZPop: number;
  HospPop: number;
  ChurchPop: number;
  NeedHosp: number;
  NeedChurch: number;
  StadiumPop: number;
  PortPop: number;
  APortPop: number;
  ResCap: number;
  ComCap: number;
  IndCap: number;
  CrimeRamp: number;
  PolluteRamp: number;
  ResHisMax: number;
  ComHisMax: number;
  IndHisMax: number;
  Res2HisMax: number;
  Com2HisMax: number;
  Ind2HisMax: number;
  Graph10Max: number;
  Graph120Max: number;
  CensusChanged: number;
  NoDisasters: number;
  DisasterEvent: number;
  DisasterWait: number;
  FloodCnt: number;
  FloodX: number;
  FloodY: number;
  CrashX: number;
  CrashY: number;
  CCx: number;
  CCy: number;
  DidLoseGame: number;
  DidWinGame: number;
  DidEarthquake: number;
  CChr9: number;
  CoalPop: number;
  NuclearPop: number;
  PwrdZCnt: number;
  unPwrdZCnt: number;
  CCx2: number;
  CCy2: number;
  PolMaxX: number;
  PolMaxY: number;
  CrimeMaxX: number;
  CrimeMaxY: number;
  DonDither: number;
  PowerStackNum: number;
  TrafMaxX: number;
  TrafMaxY: number;
  copControl: number;
  copDestX: number;
  copDestY: number;
  NewMapFlags: CoreOracleMapFlags;
  resHis: Int16Array;
  comHis: Int16Array;
  indHis: Int16Array;
  crimeHis: Int16Array;
  pollutionHis: Int16Array;
  moneyHis: Int16Array;
  miscHis: Int16Array;
  map: Uint16Array;
  trfDensity: Uint8Array;
  popDensity: Uint8Array;
  pollutionMem: Uint8Array;
  landValueMem: Uint8Array;
  crimeMem: Uint8Array;
  terrainMem: Uint8Array;
  rateOGMem: Int16Array;
  fireStMap: Int16Array;
  policeMap: Int16Array;
  policeMapEffect: Int16Array;
  fireRate: Int16Array;
  comRate: Int16Array;
  powerMap: Uint16Array;
  powerStackX: Uint8Array;
  powerStackY: Uint8Array;
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

export interface CoreOracleLoadCtyOptions {
  state: CoreOracleState;
  ctyPath: string;
}

export interface CoreOracleLoadCtyBytesOptions {
  state: CoreOracleState;
  ctyBytes: Uint8Array;
}

/**
 * Non-throwing command result for one oracle CLI invocation.
 *
 * Mirrors process-level status and signal semantics of the
 * `micropolis-core-oracle` binary in `packages/micropolis-c-harness/core/core_oracle.c`.
 */
export interface CoreOracleCommandResult {
  exitStatus: number | null;
  signal: NodeJS.Signals | null;
  stdout: Uint8Array;
  stderr: string;
}

/**
 * Failure-probe payload for `.cty` load commands.
 *
 * Mirrors `loadFile` failure flow in `ref/micropolis/src/sim/s_fileio.c` as exposed
 * by oracle `load-cty`/`load-cty-bytes` commands: callers can assert command status
 * and verify state stability by comparing pre/post `save-cty` bytes.
 */
export interface CoreOracleLoadCtyFailureProbeResult {
  command: CoreOracleCommandResult;
  beforeSaveCty: Uint8Array;
  afterSaveCty: Uint8Array;
}

/**
 * Input payload for oracle `.cty` save-byte extraction.
 * Mirrors the `saveFile` runtime inputs in `ref/micropolis/src/sim/s_fileio.c`:
 * scalar state + histories + misc + map buffers.
 */
export interface CoreOracleSaveCtyOptions {
  state: CoreOracleState;
}

export type CoreOracleToolName =
  | 'res'
  | 'com'
  | 'ind'
  | 'fire'
  | 'query'
  | 'police'
  | 'wire'
  | 'bulldoze'
  | 'rail'
  | 'road'
  | 'chalk'
  | 'eraser'
  | 'stadium'
  | 'park'
  | 'seaport'
  | 'coal'
  | 'nuclear'
  | 'airport'
  | 'network';

export interface CoreOracleApplyToolOptions {
  state: CoreOracleState;
  tool: CoreOracleToolName;
  x: number;
  y: number;
}

export interface CoreOracleApplyToolResult {
  code: number;
  state: CoreOracleState;
}

export interface CoreOracleDoBudgetNowOptions {
  state: CoreOracleState;
  fromMenu?: boolean;
}

/**
 * One rendered oracle graph-series payload for one range (`10` or `120` years).
 *
 * Mirrors `History10[]` / `History120[]` per-series byte buffers filled by
 * `doAllGraphs` + `drawMonth` in `ref/micropolis/src/sim/w_graph.c`.
 */
export interface CoreOracleGraphSeriesData {
  res: Uint8Array;
  com: Uint8Array;
  ind: Uint8Array;
  money: Uint8Array;
  crime: Uint8Array;
  pollution: Uint8Array;
}

/**
 * Full rendered graph payload from the oracle `do-all-graphs` command.
 *
 * Layout mirrors `History10[]` and `History120[]` in
 * `ref/micropolis/src/sim/w_graph.c`.
 */
export interface CoreOracleGraphData {
  history10: CoreOracleGraphSeriesData;
  history120: CoreOracleGraphSeriesData;
}

interface CoreOracleSnapshotJson {
  snapshotVersion: number;
  snapshotFormat: 'json+binary';
  snapshotFormatTodo: string;
  rngNext: number;
  TickNow: number;
  CityTime: number;
  StartingYear: number;
  CityTax: number;
  GameLevel: number;
  TaxFlag: number;
  AvCityTax: number;
  Scycle: number;
  Fcycle: number;
  SimSpeed: number;
  DoInitialEval: number;
  NewPower: number;
  MustUpdateOptions: number;
  LastCityTime: number;
  LastCityYear: number;
  LastCityMonth: number;
  LastFunds: number;
  TotalFunds: number;
  TaxFund: number;
  RoadFund: number;
  PoliceFund: number;
  FireFund: number;
  CashFlow: number;
  RoadSpend: number;
  PoliceSpend: number;
  FireSpend: number;
  roadPercent: number;
  policePercent: number;
  firePercent: number;
  autoBudget: number;
  autoBulldoze: number;
  autoGo: number;
  UserSoundOn: number;
  DoAnimation: number;
  DoMessages: number;
  DoNotices: number;
  RoadTotal: number;
  RailTotal: number;
  RoadEffect: number;
  PoliceEffect: number;
  FireEffect: number;
  PolicePop: number;
  FireStPop: number;
  LVAverage: number;
  MessagePort: number;
  MesX: number;
  MesY: number;
  MesNum: number;
  LastMesTime: number;
  LastPicNum: number;
  ScenarioID: number;
  ScoreType: number;
  ScoreWait: number;
  LastCityPop: number;
  LastCategory: number;
  CityClass: number;
  CityScore: number;
  TrafficAverage: number;
  CrimeAverage: number;
  PolluteAverage: number;
  ResPop: number;
  ComPop: number;
  IndPop: number;
  TotalPop: number;
  ResZPop: number;
  ComZPop: number;
  IndZPop: number;
  TotalZPop: number;
  HospPop: number;
  ChurchPop: number;
  NeedHosp: number;
  NeedChurch: number;
  StadiumPop: number;
  PortPop: number;
  APortPop: number;
  ResCap: number;
  ComCap: number;
  IndCap: number;
  CrimeRamp: number;
  PolluteRamp: number;
  ResHisMax: number;
  ComHisMax: number;
  IndHisMax: number;
  Res2HisMax: number;
  Com2HisMax: number;
  Ind2HisMax: number;
  Graph10Max: number;
  Graph120Max: number;
  CensusChanged: number;
  NoDisasters: number;
  DisasterEvent: number;
  DisasterWait: number;
  FloodCnt: number;
  FloodX: number;
  FloodY: number;
  CrashX: number;
  CrashY: number;
  CCx: number;
  CCy: number;
  DidLoseGame: number;
  DidWinGame: number;
  DidEarthquake: number;
  CChr9: number;
  CoalPop: number;
  NuclearPop: number;
  PwrdZCnt: number;
  unPwrdZCnt: number;
  CCx2: number;
  CCy2: number;
  PolMaxX: number;
  PolMaxY: number;
  CrimeMaxX: number;
  CrimeMaxY: number;
  DonDither: number;
  PowerStackNum: number;
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
  NewMapFlags_PDMAP: number;
  NewMapFlags_RGMAP: number;
  NewMapFlags_TDMAP: number;
  NewMapFlags_PLMAP: number;
  NewMapFlags_CRMAP: number;
  NewMapFlags_LVMAP: number;
  NewMapFlags_FIMAP: number;
  NewMapFlags_POMAP: number;
  NewMapFlags_DYMAP: number;
}

/**
 * Ensures `micropolis-core-oracle` is available.
 *
 * Wraps `packages/micropolis-c-harness/scripts/build-core-oracle.mjs`, which compiles
 * the headless core oracle and the reference `s_traf.c`/`s_power.c`/`s_scan.c`
 * translation units.
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
    statSync(CORE_BIN).mtimeMs < statSync(TRAFFIC_SOURCE).mtimeMs ||
    statSync(CORE_BIN).mtimeMs < statSync(POWER_SOURCE).mtimeMs ||
    statSync(CORE_BIN).mtimeMs < statSync(SCAN_SOURCE).mtimeMs ||
    statSync(CORE_BIN).mtimeMs < statSync(CONNECTIVITY_SOURCE).mtimeMs;

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
function runCoreOracle(args: readonly string[], options?: { stdinBytes?: Uint8Array }): Buffer {
  const result = runCoreOracleResult(args, options);
  if (result.signal !== null) {
    throw new Error(`core oracle command terminated by signal ${result.signal}`);
  }
  if (result.exitStatus !== 0) {
    const stderrText = result.stderr.trim();
    const stderrSuffix = stderrText.length > 0 ? `: ${stderrText}` : '';
    throw new Error(`core oracle command exited with status ${result.exitStatus}${stderrSuffix}`);
  }
  return Buffer.from(result.stdout);
}

/**
 * Executes one oracle CLI command and returns process result details.
 *
 * Mirrors command execution behavior in `packages/micropolis-c-harness/core/core_oracle.c`
 * without throwing on non-zero exit status, so parity tests can assert failures directly.
 */
function runCoreOracleResult(
  args: readonly string[],
  options?: { stdinBytes?: Uint8Array },
): CoreOracleCommandResult {
  const bin = ensureCoreOracle();
  const result = spawnSync(bin, [...args], {
    input: options?.stdinBytes,
  });
  if (result.error !== undefined) {
    throw result.error;
  }

  return {
    exitStatus: result.status,
    signal: result.signal,
    stdout: new Uint8Array(result.stdout),
    stderr: result.stderr.toString('utf8'),
  };
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
    TickNow: Math.trunc(state.TickNow),
    CityTime: Math.trunc(state.CityTime),
    StartingYear: Math.trunc(state.StartingYear),
    CityTax: Math.trunc(state.CityTax),
    GameLevel: Math.trunc(state.GameLevel),
    TaxFlag: Math.trunc(state.TaxFlag),
    AvCityTax: Math.trunc(state.AvCityTax),
    Scycle: Math.trunc(state.Scycle),
    Fcycle: Math.trunc(state.Fcycle),
    SimSpeed: Math.trunc(state.SimSpeed),
    DoInitialEval: Math.trunc(state.DoInitialEval),
    NewPower: Math.trunc(state.NewPower),
    MustUpdateOptions: Math.trunc(state.MustUpdateOptions),
    LastCityTime: Math.trunc(state.LastCityTime),
    LastCityYear: Math.trunc(state.LastCityYear),
    LastCityMonth: Math.trunc(state.LastCityMonth),
    LastFunds: Math.trunc(state.LastFunds),
    TotalFunds: Math.trunc(state.TotalFunds),
    TaxFund: Math.trunc(state.TaxFund),
    RoadFund: Math.trunc(state.RoadFund),
    PoliceFund: Math.trunc(state.PoliceFund),
    FireFund: Math.trunc(state.FireFund),
    CashFlow: Math.trunc(state.CashFlow),
    RoadSpend: Math.trunc(state.RoadSpend),
    PoliceSpend: Math.trunc(state.PoliceSpend),
    FireSpend: Math.trunc(state.FireSpend),
    roadPercent: state.roadPercent,
    policePercent: state.policePercent,
    firePercent: state.firePercent,
    autoBudget: Math.trunc(state.autoBudget),
    autoBulldoze: Math.trunc(state.autoBulldoze),
    autoGo: Math.trunc(state.autoGo),
    UserSoundOn: Math.trunc(state.UserSoundOn),
    DoAnimation: Math.trunc(state.DoAnimation),
    DoMessages: Math.trunc(state.DoMessages),
    DoNotices: Math.trunc(state.DoNotices),
    RoadTotal: Math.trunc(state.RoadTotal),
    RailTotal: Math.trunc(state.RailTotal),
    RoadEffect: Math.trunc(state.RoadEffect),
    PoliceEffect: Math.trunc(state.PoliceEffect),
    FireEffect: Math.trunc(state.FireEffect),
    PolicePop: Math.trunc(state.PolicePop),
    FireStPop: Math.trunc(state.FireStPop),
    LVAverage: Math.trunc(state.LVAverage),
    MessagePort: Math.trunc(state.MessagePort),
    MesX: Math.trunc(state.MesX),
    MesY: Math.trunc(state.MesY),
    MesNum: Math.trunc(state.MesNum),
    LastMesTime: Math.trunc(state.LastMesTime),
    LastPicNum: Math.trunc(state.LastPicNum),
    ScenarioID: Math.trunc(state.ScenarioID),
    ScoreType: Math.trunc(state.ScoreType),
    ScoreWait: Math.trunc(state.ScoreWait),
    LastCityPop: Math.trunc(state.LastCityPop),
    LastCategory: Math.trunc(state.LastCategory),
    CityClass: Math.trunc(state.CityClass),
    CityScore: Math.trunc(state.CityScore),
    TrafficAverage: Math.trunc(state.TrafficAverage),
    CrimeAverage: Math.trunc(state.CrimeAverage),
    PolluteAverage: Math.trunc(state.PolluteAverage),
    ResPop: Math.trunc(state.ResPop),
    ComPop: Math.trunc(state.ComPop),
    IndPop: Math.trunc(state.IndPop),
    TotalPop: Math.trunc(state.TotalPop),
    ResZPop: Math.trunc(state.ResZPop),
    ComZPop: Math.trunc(state.ComZPop),
    IndZPop: Math.trunc(state.IndZPop),
    TotalZPop: Math.trunc(state.TotalZPop),
    HospPop: Math.trunc(state.HospPop),
    ChurchPop: Math.trunc(state.ChurchPop),
    NeedHosp: Math.trunc(state.NeedHosp),
    NeedChurch: Math.trunc(state.NeedChurch),
    StadiumPop: Math.trunc(state.StadiumPop),
    PortPop: Math.trunc(state.PortPop),
    APortPop: Math.trunc(state.APortPop),
    ResCap: Math.trunc(state.ResCap),
    ComCap: Math.trunc(state.ComCap),
    IndCap: Math.trunc(state.IndCap),
    CrimeRamp: Math.trunc(state.CrimeRamp),
    PolluteRamp: Math.trunc(state.PolluteRamp),
    ResHisMax: Math.trunc(state.ResHisMax),
    ComHisMax: Math.trunc(state.ComHisMax),
    IndHisMax: Math.trunc(state.IndHisMax),
    Res2HisMax: Math.trunc(state.Res2HisMax),
    Com2HisMax: Math.trunc(state.Com2HisMax),
    Ind2HisMax: Math.trunc(state.Ind2HisMax),
    Graph10Max: Math.trunc(state.Graph10Max),
    Graph120Max: Math.trunc(state.Graph120Max),
    CensusChanged: Math.trunc(state.CensusChanged),
    NoDisasters: Math.trunc(state.NoDisasters),
    DisasterEvent: Math.trunc(state.DisasterEvent),
    DisasterWait: Math.trunc(state.DisasterWait),
    FloodCnt: Math.trunc(state.FloodCnt),
    FloodX: Math.trunc(state.FloodX),
    FloodY: Math.trunc(state.FloodY),
    CrashX: Math.trunc(state.CrashX),
    CrashY: Math.trunc(state.CrashY),
    CCx: Math.trunc(state.CCx),
    CCy: Math.trunc(state.CCy),
    DidLoseGame: Math.trunc(state.DidLoseGame),
    DidWinGame: Math.trunc(state.DidWinGame),
    DidEarthquake: Math.trunc(state.DidEarthquake),
    CChr9: Math.trunc(state.CChr9),
    CoalPop: Math.trunc(state.CoalPop),
    NuclearPop: Math.trunc(state.NuclearPop),
    PwrdZCnt: Math.trunc(state.PwrdZCnt),
    unPwrdZCnt: Math.trunc(state.unPwrdZCnt),
    CCx2: Math.trunc(state.CCx2),
    CCy2: Math.trunc(state.CCy2),
    PolMaxX: Math.trunc(state.PolMaxX),
    PolMaxY: Math.trunc(state.PolMaxY),
    CrimeMaxX: Math.trunc(state.CrimeMaxX),
    CrimeMaxY: Math.trunc(state.CrimeMaxY),
    DonDither: Math.trunc(state.DonDither),
    PowerStackNum: Math.trunc(state.PowerStackNum),
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
    NewMapFlags_PDMAP: Math.trunc(state.NewMapFlags.PDMAP),
    NewMapFlags_RGMAP: Math.trunc(state.NewMapFlags.RGMAP),
    NewMapFlags_TDMAP: Math.trunc(state.NewMapFlags.TDMAP),
    NewMapFlags_PLMAP: Math.trunc(state.NewMapFlags.PLMAP),
    NewMapFlags_CRMAP: Math.trunc(state.NewMapFlags.CRMAP),
    NewMapFlags_LVMAP: Math.trunc(state.NewMapFlags.LVMAP),
    NewMapFlags_FIMAP: Math.trunc(state.NewMapFlags.FIMAP),
    NewMapFlags_POMAP: Math.trunc(state.NewMapFlags.POMAP),
    NewMapFlags_DYMAP: Math.trunc(state.NewMapFlags.DYMAP),
  };

  if (state.map.length !== CORE_MAP_WORD_COUNT) {
    throw new Error(`invalid map length: ${state.map.length} (expected ${CORE_MAP_WORD_COUNT})`);
  }
  if (state.resHis.length !== CORE_HISTORY_WORD_COUNT) {
    throw new Error(
      `invalid resHis length: ${state.resHis.length} (expected ${CORE_HISTORY_WORD_COUNT})`,
    );
  }
  if (state.comHis.length !== CORE_HISTORY_WORD_COUNT) {
    throw new Error(
      `invalid comHis length: ${state.comHis.length} (expected ${CORE_HISTORY_WORD_COUNT})`,
    );
  }
  if (state.indHis.length !== CORE_HISTORY_WORD_COUNT) {
    throw new Error(
      `invalid indHis length: ${state.indHis.length} (expected ${CORE_HISTORY_WORD_COUNT})`,
    );
  }
  if (state.crimeHis.length !== CORE_HISTORY_WORD_COUNT) {
    throw new Error(
      `invalid crimeHis length: ${state.crimeHis.length} (expected ${CORE_HISTORY_WORD_COUNT})`,
    );
  }
  if (state.pollutionHis.length !== CORE_HISTORY_WORD_COUNT) {
    throw new Error(
      `invalid pollutionHis length: ${state.pollutionHis.length} (expected ${CORE_HISTORY_WORD_COUNT})`,
    );
  }
  if (state.moneyHis.length !== CORE_HISTORY_WORD_COUNT) {
    throw new Error(
      `invalid moneyHis length: ${state.moneyHis.length} (expected ${CORE_HISTORY_WORD_COUNT})`,
    );
  }
  if (state.miscHis.length !== CORE_MISC_WORD_COUNT) {
    throw new Error(
      `invalid miscHis length: ${state.miscHis.length} (expected ${CORE_MISC_WORD_COUNT})`,
    );
  }
  if (state.trfDensity.length !== CORE_TRF_CELL_COUNT) {
    throw new Error(
      `invalid trfDensity length: ${state.trfDensity.length} (expected ${CORE_TRF_CELL_COUNT})`,
    );
  }
  if (state.popDensity.length !== CORE_HALF_CELL_COUNT) {
    throw new Error(
      `invalid popDensity length: ${state.popDensity.length} (expected ${CORE_HALF_CELL_COUNT})`,
    );
  }
  if (state.pollutionMem.length !== CORE_HALF_CELL_COUNT) {
    throw new Error(
      `invalid pollutionMem length: ${state.pollutionMem.length} (expected ${CORE_HALF_CELL_COUNT})`,
    );
  }
  if (state.landValueMem.length !== CORE_HALF_CELL_COUNT) {
    throw new Error(
      `invalid landValueMem length: ${state.landValueMem.length} (expected ${CORE_HALF_CELL_COUNT})`,
    );
  }
  if (state.crimeMem.length !== CORE_HALF_CELL_COUNT) {
    throw new Error(
      `invalid crimeMem length: ${state.crimeMem.length} (expected ${CORE_HALF_CELL_COUNT})`,
    );
  }
  if (state.terrainMem.length !== CORE_QUARTER_CELL_COUNT) {
    throw new Error(
      `invalid terrainMem length: ${state.terrainMem.length} (expected ${CORE_QUARTER_CELL_COUNT})`,
    );
  }
  if (state.rateOGMem.length !== CORE_ROG_CELL_COUNT) {
    throw new Error(
      `invalid rateOGMem length: ${state.rateOGMem.length} (expected ${CORE_ROG_CELL_COUNT})`,
    );
  }
  if (state.fireStMap.length !== CORE_SMALL_CELL_COUNT) {
    throw new Error(
      `invalid fireStMap length: ${state.fireStMap.length} (expected ${CORE_SMALL_CELL_COUNT})`,
    );
  }
  if (state.policeMap.length !== CORE_SMALL_CELL_COUNT) {
    throw new Error(
      `invalid policeMap length: ${state.policeMap.length} (expected ${CORE_SMALL_CELL_COUNT})`,
    );
  }
  if (state.policeMapEffect.length !== CORE_SMALL_CELL_COUNT) {
    throw new Error(
      `invalid policeMapEffect length: ${state.policeMapEffect.length} (expected ${CORE_SMALL_CELL_COUNT})`,
    );
  }
  if (state.fireRate.length !== CORE_SMALL_CELL_COUNT) {
    throw new Error(
      `invalid fireRate length: ${state.fireRate.length} (expected ${CORE_SMALL_CELL_COUNT})`,
    );
  }
  if (state.comRate.length !== CORE_SMALL_CELL_COUNT) {
    throw new Error(
      `invalid comRate length: ${state.comRate.length} (expected ${CORE_SMALL_CELL_COUNT})`,
    );
  }
  if (state.powerMap.length !== CORE_POWER_WORD_COUNT) {
    throw new Error(
      `invalid powerMap length: ${state.powerMap.length} (expected ${CORE_POWER_WORD_COUNT})`,
    );
  }
  if (state.powerStackX.length !== CORE_POWER_STACK_COUNT) {
    throw new Error(
      `invalid powerStackX length: ${state.powerStackX.length} (expected ${CORE_POWER_STACK_COUNT})`,
    );
  }
  if (state.powerStackY.length !== CORE_POWER_STACK_COUNT) {
    throw new Error(
      `invalid powerStackY length: ${state.powerStackY.length} (expected ${CORE_POWER_STACK_COUNT})`,
    );
  }

  writeFileSync(path.join(dir, SNAPSHOT_FILE), `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileSync(path.join(dir, RES_HIS_FILE), encodeCoreI16LE(state.resHis));
  writeFileSync(path.join(dir, COM_HIS_FILE), encodeCoreI16LE(state.comHis));
  writeFileSync(path.join(dir, IND_HIS_FILE), encodeCoreI16LE(state.indHis));
  writeFileSync(path.join(dir, CRIME_HIS_FILE), encodeCoreI16LE(state.crimeHis));
  writeFileSync(path.join(dir, POLLUTION_HIS_FILE), encodeCoreI16LE(state.pollutionHis));
  writeFileSync(path.join(dir, MONEY_HIS_FILE), encodeCoreI16LE(state.moneyHis));
  writeFileSync(path.join(dir, MISC_HIS_FILE), encodeCoreI16LE(state.miscHis));
  writeFileSync(path.join(dir, MAP_FILE), encodeCoreU16LE(state.map));
  writeFileSync(path.join(dir, TRF_FILE), state.trfDensity);
  writeFileSync(path.join(dir, POP_DENSITY_FILE), state.popDensity);
  writeFileSync(path.join(dir, POLLUTION_FILE), state.pollutionMem);
  writeFileSync(path.join(dir, LAND_VALUE_FILE), state.landValueMem);
  writeFileSync(path.join(dir, CRIME_FILE), state.crimeMem);
  writeFileSync(path.join(dir, TERRAIN_FILE), state.terrainMem);
  writeFileSync(path.join(dir, ROG_FILE), encodeCoreI16LE(state.rateOGMem));
  writeFileSync(path.join(dir, FIRE_ST_FILE), encodeCoreI16LE(state.fireStMap));
  writeFileSync(path.join(dir, POLICE_FILE), encodeCoreI16LE(state.policeMap));
  writeFileSync(path.join(dir, POLICE_EFFECT_FILE), encodeCoreI16LE(state.policeMapEffect));
  writeFileSync(path.join(dir, FIRE_RATE_FILE), encodeCoreI16LE(state.fireRate));
  writeFileSync(path.join(dir, COM_RATE_FILE), encodeCoreI16LE(state.comRate));
  writeFileSync(path.join(dir, POWER_FILE), encodeCoreU16LE(state.powerMap));
  writeFileSync(path.join(dir, POWER_STACK_X_FILE), state.powerStackX);
  writeFileSync(path.join(dir, POWER_STACK_Y_FILE), state.powerStackY);
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
  const resHis = decodeCoreI16LE(readFileSync(path.join(dir, RES_HIS_FILE)));
  const comHis = decodeCoreI16LE(readFileSync(path.join(dir, COM_HIS_FILE)));
  const indHis = decodeCoreI16LE(readFileSync(path.join(dir, IND_HIS_FILE)));
  const crimeHis = decodeCoreI16LE(readFileSync(path.join(dir, CRIME_HIS_FILE)));
  const pollutionHis = decodeCoreI16LE(readFileSync(path.join(dir, POLLUTION_HIS_FILE)));
  const moneyHis = decodeCoreI16LE(readFileSync(path.join(dir, MONEY_HIS_FILE)));
  const miscHis = decodeCoreI16LE(readFileSync(path.join(dir, MISC_HIS_FILE)));
  const map = decodeCoreU16LE(readFileSync(path.join(dir, MAP_FILE)));
  const trfDensity = new Uint8Array(readFileSync(path.join(dir, TRF_FILE)));
  const popDensity = new Uint8Array(readFileSync(path.join(dir, POP_DENSITY_FILE)));
  const pollutionMem = new Uint8Array(readFileSync(path.join(dir, POLLUTION_FILE)));
  const landValueMem = new Uint8Array(readFileSync(path.join(dir, LAND_VALUE_FILE)));
  const crimeMem = new Uint8Array(readFileSync(path.join(dir, CRIME_FILE)));
  const terrainMem = new Uint8Array(readFileSync(path.join(dir, TERRAIN_FILE)));
  const rateOGMem = decodeCoreI16LE(readFileSync(path.join(dir, ROG_FILE)));
  const fireStMap = decodeCoreI16LE(readFileSync(path.join(dir, FIRE_ST_FILE)));
  const policeMap = decodeCoreI16LE(readFileSync(path.join(dir, POLICE_FILE)));
  const policeMapEffect = decodeCoreI16LE(readFileSync(path.join(dir, POLICE_EFFECT_FILE)));
  const fireRate = decodeCoreI16LE(readFileSync(path.join(dir, FIRE_RATE_FILE)));
  const comRate = decodeCoreI16LE(readFileSync(path.join(dir, COM_RATE_FILE)));
  const powerMap = decodeCoreU16LE(readFileSync(path.join(dir, POWER_FILE)));
  const powerStackX = new Uint8Array(readFileSync(path.join(dir, POWER_STACK_X_FILE)));
  const powerStackY = new Uint8Array(readFileSync(path.join(dir, POWER_STACK_Y_FILE)));

  if (map.length !== CORE_MAP_WORD_COUNT) {
    throw new Error(`oracle map size mismatch: ${map.length} (expected ${CORE_MAP_WORD_COUNT})`);
  }
  if (resHis.length !== CORE_HISTORY_WORD_COUNT) {
    throw new Error(
      `oracle resHis size mismatch: ${resHis.length} (expected ${CORE_HISTORY_WORD_COUNT})`,
    );
  }
  if (comHis.length !== CORE_HISTORY_WORD_COUNT) {
    throw new Error(
      `oracle comHis size mismatch: ${comHis.length} (expected ${CORE_HISTORY_WORD_COUNT})`,
    );
  }
  if (indHis.length !== CORE_HISTORY_WORD_COUNT) {
    throw new Error(
      `oracle indHis size mismatch: ${indHis.length} (expected ${CORE_HISTORY_WORD_COUNT})`,
    );
  }
  if (crimeHis.length !== CORE_HISTORY_WORD_COUNT) {
    throw new Error(
      `oracle crimeHis size mismatch: ${crimeHis.length} (expected ${CORE_HISTORY_WORD_COUNT})`,
    );
  }
  if (pollutionHis.length !== CORE_HISTORY_WORD_COUNT) {
    throw new Error(
      `oracle pollutionHis size mismatch: ${pollutionHis.length} (expected ${CORE_HISTORY_WORD_COUNT})`,
    );
  }
  if (moneyHis.length !== CORE_HISTORY_WORD_COUNT) {
    throw new Error(
      `oracle moneyHis size mismatch: ${moneyHis.length} (expected ${CORE_HISTORY_WORD_COUNT})`,
    );
  }
  if (miscHis.length !== CORE_MISC_WORD_COUNT) {
    throw new Error(
      `oracle miscHis size mismatch: ${miscHis.length} (expected ${CORE_MISC_WORD_COUNT})`,
    );
  }
  if (trfDensity.length !== CORE_TRF_CELL_COUNT) {
    throw new Error(
      `oracle trfDensity size mismatch: ${trfDensity.length} (expected ${CORE_TRF_CELL_COUNT})`,
    );
  }
  if (popDensity.length !== CORE_HALF_CELL_COUNT) {
    throw new Error(
      `oracle popDensity size mismatch: ${popDensity.length} (expected ${CORE_HALF_CELL_COUNT})`,
    );
  }
  if (pollutionMem.length !== CORE_HALF_CELL_COUNT) {
    throw new Error(
      `oracle pollutionMem size mismatch: ${pollutionMem.length} (expected ${CORE_HALF_CELL_COUNT})`,
    );
  }
  if (landValueMem.length !== CORE_HALF_CELL_COUNT) {
    throw new Error(
      `oracle landValueMem size mismatch: ${landValueMem.length} (expected ${CORE_HALF_CELL_COUNT})`,
    );
  }
  if (crimeMem.length !== CORE_HALF_CELL_COUNT) {
    throw new Error(
      `oracle crimeMem size mismatch: ${crimeMem.length} (expected ${CORE_HALF_CELL_COUNT})`,
    );
  }
  if (terrainMem.length !== CORE_QUARTER_CELL_COUNT) {
    throw new Error(
      `oracle terrainMem size mismatch: ${terrainMem.length} (expected ${CORE_QUARTER_CELL_COUNT})`,
    );
  }
  if (rateOGMem.length !== CORE_ROG_CELL_COUNT) {
    throw new Error(
      `oracle rateOGMem size mismatch: ${rateOGMem.length} (expected ${CORE_ROG_CELL_COUNT})`,
    );
  }
  if (fireStMap.length !== CORE_SMALL_CELL_COUNT) {
    throw new Error(
      `oracle fireStMap size mismatch: ${fireStMap.length} (expected ${CORE_SMALL_CELL_COUNT})`,
    );
  }
  if (policeMap.length !== CORE_SMALL_CELL_COUNT) {
    throw new Error(
      `oracle policeMap size mismatch: ${policeMap.length} (expected ${CORE_SMALL_CELL_COUNT})`,
    );
  }
  if (policeMapEffect.length !== CORE_SMALL_CELL_COUNT) {
    throw new Error(
      `oracle policeMapEffect size mismatch: ${policeMapEffect.length} (expected ${CORE_SMALL_CELL_COUNT})`,
    );
  }
  if (fireRate.length !== CORE_SMALL_CELL_COUNT) {
    throw new Error(
      `oracle fireRate size mismatch: ${fireRate.length} (expected ${CORE_SMALL_CELL_COUNT})`,
    );
  }
  if (comRate.length !== CORE_SMALL_CELL_COUNT) {
    throw new Error(
      `oracle comRate size mismatch: ${comRate.length} (expected ${CORE_SMALL_CELL_COUNT})`,
    );
  }
  if (powerMap.length !== CORE_POWER_WORD_COUNT) {
    throw new Error(
      `oracle powerMap size mismatch: ${powerMap.length} (expected ${CORE_POWER_WORD_COUNT})`,
    );
  }
  if (powerStackX.length !== CORE_POWER_STACK_COUNT) {
    throw new Error(
      `oracle powerStackX size mismatch: ${powerStackX.length} (expected ${CORE_POWER_STACK_COUNT})`,
    );
  }
  if (powerStackY.length !== CORE_POWER_STACK_COUNT) {
    throw new Error(
      `oracle powerStackY size mismatch: ${powerStackY.length} (expected ${CORE_POWER_STACK_COUNT})`,
    );
  }

  return {
    snapshotVersion: snapshot.snapshotVersion,
    snapshotFormat: snapshot.snapshotFormat,
    snapshotFormatTodo: snapshot.snapshotFormatTodo,
    rngNext: snapshot.rngNext >>> 0,
    TickNow: snapshot.TickNow,
    CityTime: snapshot.CityTime,
    StartingYear: snapshot.StartingYear,
    CityTax: snapshot.CityTax,
    GameLevel: snapshot.GameLevel,
    TaxFlag: snapshot.TaxFlag,
    AvCityTax: snapshot.AvCityTax,
    Scycle: snapshot.Scycle,
    Fcycle: snapshot.Fcycle,
    SimSpeed: snapshot.SimSpeed,
    DoInitialEval: snapshot.DoInitialEval,
    NewPower: snapshot.NewPower,
    MustUpdateOptions: snapshot.MustUpdateOptions,
    LastCityTime: snapshot.LastCityTime,
    LastCityYear: snapshot.LastCityYear,
    LastCityMonth: snapshot.LastCityMonth,
    LastFunds: snapshot.LastFunds,
    TotalFunds: snapshot.TotalFunds,
    TaxFund: snapshot.TaxFund,
    RoadFund: snapshot.RoadFund,
    PoliceFund: snapshot.PoliceFund,
    FireFund: snapshot.FireFund,
    CashFlow: snapshot.CashFlow,
    RoadSpend: snapshot.RoadSpend,
    PoliceSpend: snapshot.PoliceSpend,
    FireSpend: snapshot.FireSpend,
    roadPercent: snapshot.roadPercent,
    policePercent: snapshot.policePercent,
    firePercent: snapshot.firePercent,
    autoBudget: snapshot.autoBudget,
    autoBulldoze: snapshot.autoBulldoze,
    autoGo: snapshot.autoGo,
    UserSoundOn: snapshot.UserSoundOn,
    DoAnimation: snapshot.DoAnimation,
    DoMessages: snapshot.DoMessages,
    DoNotices: snapshot.DoNotices,
    RoadTotal: snapshot.RoadTotal,
    RailTotal: snapshot.RailTotal,
    RoadEffect: snapshot.RoadEffect,
    PoliceEffect: snapshot.PoliceEffect,
    FireEffect: snapshot.FireEffect,
    PolicePop: snapshot.PolicePop,
    FireStPop: snapshot.FireStPop,
    LVAverage: snapshot.LVAverage,
    MessagePort: snapshot.MessagePort,
    MesX: snapshot.MesX,
    MesY: snapshot.MesY,
    MesNum: snapshot.MesNum,
    LastMesTime: snapshot.LastMesTime,
    LastPicNum: snapshot.LastPicNum,
    ScenarioID: snapshot.ScenarioID,
    ScoreType: snapshot.ScoreType,
    ScoreWait: snapshot.ScoreWait,
    LastCityPop: snapshot.LastCityPop,
    LastCategory: snapshot.LastCategory,
    CityClass: snapshot.CityClass,
    CityScore: snapshot.CityScore,
    TrafficAverage: snapshot.TrafficAverage,
    CrimeAverage: snapshot.CrimeAverage,
    PolluteAverage: snapshot.PolluteAverage,
    ResPop: snapshot.ResPop,
    ComPop: snapshot.ComPop,
    IndPop: snapshot.IndPop,
    TotalPop: snapshot.TotalPop,
    ResZPop: snapshot.ResZPop,
    ComZPop: snapshot.ComZPop,
    IndZPop: snapshot.IndZPop,
    TotalZPop: snapshot.TotalZPop,
    HospPop: snapshot.HospPop,
    ChurchPop: snapshot.ChurchPop,
    NeedHosp: snapshot.NeedHosp,
    NeedChurch: snapshot.NeedChurch,
    StadiumPop: snapshot.StadiumPop,
    PortPop: snapshot.PortPop,
    APortPop: snapshot.APortPop,
    ResCap: snapshot.ResCap,
    ComCap: snapshot.ComCap,
    IndCap: snapshot.IndCap,
    CrimeRamp: snapshot.CrimeRamp,
    PolluteRamp: snapshot.PolluteRamp,
    ResHisMax: snapshot.ResHisMax,
    ComHisMax: snapshot.ComHisMax,
    IndHisMax: snapshot.IndHisMax,
    Res2HisMax: snapshot.Res2HisMax,
    Com2HisMax: snapshot.Com2HisMax,
    Ind2HisMax: snapshot.Ind2HisMax,
    Graph10Max: snapshot.Graph10Max,
    Graph120Max: snapshot.Graph120Max,
    CensusChanged: snapshot.CensusChanged,
    NoDisasters: snapshot.NoDisasters,
    DisasterEvent: snapshot.DisasterEvent,
    DisasterWait: snapshot.DisasterWait,
    FloodCnt: snapshot.FloodCnt,
    FloodX: snapshot.FloodX,
    FloodY: snapshot.FloodY,
    CrashX: snapshot.CrashX,
    CrashY: snapshot.CrashY,
    CCx: snapshot.CCx,
    CCy: snapshot.CCy,
    DidLoseGame: snapshot.DidLoseGame,
    DidWinGame: snapshot.DidWinGame,
    DidEarthquake: snapshot.DidEarthquake,
    CChr9: snapshot.CChr9,
    CoalPop: snapshot.CoalPop,
    NuclearPop: snapshot.NuclearPop,
    PwrdZCnt: snapshot.PwrdZCnt,
    unPwrdZCnt: snapshot.unPwrdZCnt,
    CCx2: snapshot.CCx2,
    CCy2: snapshot.CCy2,
    PolMaxX: snapshot.PolMaxX,
    PolMaxY: snapshot.PolMaxY,
    CrimeMaxX: snapshot.CrimeMaxX,
    CrimeMaxY: snapshot.CrimeMaxY,
    DonDither: snapshot.DonDither,
    PowerStackNum: snapshot.PowerStackNum,
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
      PDMAP: snapshot.NewMapFlags_PDMAP,
      RGMAP: snapshot.NewMapFlags_RGMAP,
      TDMAP: snapshot.NewMapFlags_TDMAP,
      PLMAP: snapshot.NewMapFlags_PLMAP,
      CRMAP: snapshot.NewMapFlags_CRMAP,
      LVMAP: snapshot.NewMapFlags_LVMAP,
      FIMAP: snapshot.NewMapFlags_FIMAP,
      POMAP: snapshot.NewMapFlags_POMAP,
      DYMAP: snapshot.NewMapFlags_DYMAP,
    },
    resHis,
    comHis,
    indHis,
    crimeHis,
    pollutionHis,
    moneyHis,
    miscHis,
    map,
    trfDensity,
    popDensity,
    pollutionMem,
    landValueMem,
    crimeMem,
    terrainMem,
    rateOGMem,
    fireStMap,
    policeMap,
    policeMapEffect,
    fireRate,
    comRate,
    powerMap,
    powerStackX,
    powerStackY,
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
 * `Map`, `TrfDensity`, `RateOGMem`, `PowerMap`, and power-stack buffers.
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
 * Loads a `.cty` file into an existing oracle snapshot state.
 *
 * Mirrors the load normalization path in `ref/micropolis/src/sim/s_fileio.c`
 * as implemented by the headless `load-cty` command in
 * `packages/micropolis-c-harness/core/core_oracle.c`.
 */
export function runCoreOracleLoadCty(options: CoreOracleLoadCtyOptions): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, options.state);
    runCoreOracle(['load-cty', '--state-dir', stateDir, '--cty-path', options.ctyPath]);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Loads `.cty` bytes into an existing oracle snapshot state without temp files.
 *
 * Mirrors `_load_file` + `loadFile` load semantics from
 * `ref/micropolis/src/sim/s_fileio.c` through the headless
 * `load-cty-bytes` command in `packages/micropolis-c-harness/core/core_oracle.c`.
 * Intentional difference: bytes are streamed over stdin instead of loading
 * from `CityFileName` or `--cty-path`.
 */
export function runCoreOracleLoadCtyBytes(options: CoreOracleLoadCtyBytesOptions): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, options.state);
    runCoreOracle(['load-cty-bytes', '--state-dir', stateDir], { stdinBytes: options.ctyBytes });
    return readCoreOracleState(stateDir);
  });
}

/**
 * Runs `load-cty --cty-path` as a non-throwing failure probe.
 *
 * Mirrors failed `loadFile` behavior in `ref/micropolis/src/sim/s_fileio.c`: when the
 * oracle command fails, `core_oracle.c` returns status `1` before `SaveStateDir`, so
 * `beforeSaveCty` and `afterSaveCty` should remain identical.
 */
export function runCoreOracleLoadCtyFailureProbe(
  options: CoreOracleLoadCtyOptions,
): CoreOracleLoadCtyFailureProbeResult {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, options.state);
    const beforeSaveCty = new Uint8Array(runCoreOracle(['save-cty', '--state-dir', stateDir]));
    const command = runCoreOracleResult([
      'load-cty',
      '--state-dir',
      stateDir,
      '--cty-path',
      options.ctyPath,
    ]);
    const afterSaveCty = new Uint8Array(runCoreOracle(['save-cty', '--state-dir', stateDir]));
    return { command, beforeSaveCty, afterSaveCty };
  });
}

/**
 * Runs `load-cty-bytes` as a non-throwing failure probe.
 *
 * Mirrors `_load_file` + `loadFile` error handling in
 * `ref/micropolis/src/sim/s_fileio.c` through `core_oracle.c` stdin command routing.
 * Failure status/signal/stderr are returned alongside pre/post `save-cty` bytes.
 */
export function runCoreOracleLoadCtyBytesFailureProbe(
  options: CoreOracleLoadCtyBytesOptions,
): CoreOracleLoadCtyFailureProbeResult {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, options.state);
    const beforeSaveCty = new Uint8Array(runCoreOracle(['save-cty', '--state-dir', stateDir]));
    const command = runCoreOracleResult(['load-cty-bytes', '--state-dir', stateDir], {
      stdinBytes: options.ctyBytes,
    });
    const afterSaveCty = new Uint8Array(runCoreOracle(['save-cty', '--state-dir', stateDir]));
    return { command, beforeSaveCty, afterSaveCty };
  });
}

/**
 * Encodes a `.cty` payload from oracle state using C save packing/order.
 *
 * Mirrors `saveFile` in `ref/micropolis/src/sim/s_fileio.c` through the
 * headless `save-cty` command in `packages/micropolis-c-harness/core/core_oracle.c`.
 * Intentional difference: returns bytes directly instead of writing a path.
 */
export function runCoreOracleSaveCty(options: CoreOracleSaveCtyOptions): Uint8Array {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, options.state);
    const raw = runCoreOracle(['save-cty', '--state-dir', stateDir]);
    return new Uint8Array(raw);
  });
}

/**
 * Advances deterministic headless realtime ticks in the C oracle.
 *
 * Mirrors `TickCount`-driven realtime time progression from
 * `ref/micropolis/src/sim/sim.c` in a command-driven headless form.
 */
export function runCoreOracleStepRealtime(state: CoreOracleState, ticks: number): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, state);
    runCoreOracle(['step-realtime', '--state-dir', stateDir, '--ticks', `${Math.trunc(ticks)}`]);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Runs C `DoPowerScan` and returns the updated snapshot state.
 *
 * Mirrors `DoPowerScan` in `ref/micropolis/src/sim/s_power.c`, including
 * `PowerMap` writes and `PowerStackNum` consumption.
 */
export function runCoreOracleDoPowerScan(state: CoreOracleState): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, state);
    runCoreOracle(['do-power-scan', '--state-dir', stateDir]);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Runs C `SendMessages` and returns the updated snapshot state.
 *
 * Mirrors `SendMessages` in `ref/micropolis/src/sim/s_msg.c` via the headless
 * oracle command implementation.
 */
export function runCoreOracleSendMessages(state: CoreOracleState): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, state);
    runCoreOracle(['send-messages', '--state-dir', stateDir]);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Runs C `CollectTax` and returns the updated snapshot state.
 *
 * Mirrors `CollectTax` in `ref/micropolis/src/sim/s_sim.c` (which dispatches
 * budget behavior through `w_budget.c` logic).
 */
export function runCoreOracleCollectTax(state: CoreOracleState): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, state);
    runCoreOracle(['collect-tax', '--state-dir', stateDir]);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Runs C `TakeCensus` and returns the updated snapshot state.
 *
 * Mirrors `TakeCensus` in `ref/micropolis/src/sim/s_sim.c`.
 */
export function runCoreOracleTakeCensus(state: CoreOracleState): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, state);
    runCoreOracle(['take-census', '--state-dir', stateDir]);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Runs C `Take2Census` and returns the updated snapshot state.
 *
 * Mirrors `Take2Census` in `ref/micropolis/src/sim/s_sim.c`.
 */
export function runCoreOracleTake2Census(state: CoreOracleState): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, state);
    runCoreOracle(['take-2-census', '--state-dir', stateDir]);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Runs C `doAllGraphs` and returns rendered graph-byte series for both ranges.
 *
 * Mirrors `doAllGraphs`/`drawMonth` in `ref/micropolis/src/sim/w_graph.c`.
 * Output bytes are read from oracle stdout in this fixed layout:
 * - `history10`: `res, com, ind, money, crime, pollution` (each 120 bytes)
 * - `history120`: same order.
 */
export function runCoreOracleDoAllGraphs(state: CoreOracleState): CoreOracleGraphData {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, state);
    const raw = new Uint8Array(runCoreOracle(['do-all-graphs', '--state-dir', stateDir]));
    const expectedLength = CORE_GRAPH_POINT_COUNT * CORE_GRAPH_SERIES_COUNT * 2;
    if (raw.length !== expectedLength) {
      throw new Error(
        `unexpected do-all-graphs byte length: ${raw.length} (expected ${expectedLength})`,
      );
    }

    const history10 = decodeCoreOracleGraphSeries(raw, 0);
    const history120 = decodeCoreOracleGraphSeries(
      raw,
      CORE_GRAPH_POINT_COUNT * CORE_GRAPH_SERIES_COUNT,
    );
    return {
      history10,
      history120,
    };
  });
}

/**
 * Runs C `DoBudgetNow` and returns the updated snapshot state.
 *
 * Mirrors `DoBudgetNow` in `ref/micropolis/src/sim/w_budget.c`.
 */
export function runCoreOracleDoBudgetNow(options: CoreOracleDoBudgetNowOptions): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, options.state);
    const args = ['do-budget-now', '--state-dir', stateDir] as string[];
    if (options.fromMenu !== undefined) {
      args.push('--from-menu', options.fromMenu ? '1' : '0');
    }
    runCoreOracle(args);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Runs C `updateDate` heads-time logic and returns updated snapshot state.
 *
 * Mirrors `updateDate` in `ref/micropolis/src/sim/w_update.c` including
 * `doMessage` message-port consumption behavior from `s_msg.c`.
 */
export function runCoreOracleUpdateDate(state: CoreOracleState): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, state);
    runCoreOracle(['update-date', '--state-dir', stateDir]);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Runs C `doMessage` directly and returns updated snapshot state.
 *
 * Mirrors `doMessage` in `ref/micropolis/src/sim/s_msg.c`.
 */
export function runCoreOracleDoMessage(state: CoreOracleState): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, state);
    runCoreOracle(['do-message', '--state-dir', stateDir]);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Runs C `DoDisasters` and returns updated snapshot state.
 *
 * Mirrors `DoDisasters` in `ref/micropolis/src/sim/s_disast.c`.
 */
export function runCoreOracleDoDisasters(state: CoreOracleState): CoreOracleState {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, state);
    runCoreOracle(['do-disasters', '--state-dir', stateDir]);
    return readCoreOracleState(stateDir);
  });
}

/**
 * Runs one C tool operation and returns result code + updated snapshot state.
 *
 * Mirrors the tool behavior from `ref/micropolis/src/sim/w_tool.c` and
 * connectivity rules in `ref/micropolis/src/sim/w_con.c` through the
 * headless `apply-tool` oracle command.
 */
export function runCoreOracleApplyTool(
  options: CoreOracleApplyToolOptions,
): CoreOracleApplyToolResult {
  return withTempStateDir((stateDir) => {
    writeCoreOracleState(stateDir, options.state);
    const raw = runCoreOracle([
      'apply-tool',
      '--state-dir',
      stateDir,
      '--tool',
      options.tool,
      '--x',
      `${Math.trunc(options.x)}`,
      '--y',
      `${Math.trunc(options.y)}`,
    ]);
    const parsed = JSON.parse(raw.toString('utf8')) as { code: number };
    return {
      code: Math.trunc(parsed.code),
      state: readCoreOracleState(stateDir),
    };
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

/**
 * Decodes one six-series graph range from oracle `do-all-graphs` stdout bytes.
 *
 * Mirrors C `HISTORIES` order (`RES, COM, IND, MONEY, CRIME, POLLUTION`) from
 * `ref/micropolis/src/sim/headers/sim.h`.
 */
function decodeCoreOracleGraphSeries(bytes: Uint8Array, offset: number): CoreOracleGraphSeriesData {
  const res = bytes.slice(offset + CORE_GRAPH_POINT_COUNT * 0, offset + CORE_GRAPH_POINT_COUNT * 1);
  const com = bytes.slice(offset + CORE_GRAPH_POINT_COUNT * 1, offset + CORE_GRAPH_POINT_COUNT * 2);
  const ind = bytes.slice(offset + CORE_GRAPH_POINT_COUNT * 2, offset + CORE_GRAPH_POINT_COUNT * 3);
  const money = bytes.slice(
    offset + CORE_GRAPH_POINT_COUNT * 3,
    offset + CORE_GRAPH_POINT_COUNT * 4,
  );
  const crime = bytes.slice(
    offset + CORE_GRAPH_POINT_COUNT * 4,
    offset + CORE_GRAPH_POINT_COUNT * 5,
  );
  const pollution = bytes.slice(
    offset + CORE_GRAPH_POINT_COUNT * 5,
    offset + CORE_GRAPH_POINT_COUNT * 6,
  );

  return {
    res,
    com,
    ind,
    money,
    crime,
    pollution,
  };
}
