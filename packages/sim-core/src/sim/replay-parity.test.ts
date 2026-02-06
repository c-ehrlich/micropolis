import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type CoreOracleState,
  runCoreOracleInitNewCity,
  runCoreOracleStepTick,
} from '@city/micropolis-c-harness/core-parity';
import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import { MAP_FLAGS } from '../core/map-flags.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { createRng } from '../core/rng.ts';
import { createSimContext, type SimContext } from '../core/sim-context.ts';
import { createSimState, type SimState } from '../core/sim-state.ts';
import { applyLoadNormalization, decodeCityFileForMap, readCityMeta } from '../io/cty.ts';
import { hashBytes, hashInt16, hashScalars, hashUint16, mixHashes } from '../io/hash.ts';
import { doPowerScan, pushPowerStack, setZPowerAt } from '../systems/power.ts';
import { decTrafficMem } from '../systems/traffic.ts';
import { decROGMem } from '../systems/zones.ts';
import { dispatchSimPhase, type SimMapFlag, type SimPhaseSystems } from './simulate.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CITY_DIR = path.join(ROOT, 'fixtures', 'cities');
const REPLAY_FIXTURE_DIR = path.join(ROOT, 'fixtures', 'replay');
const CLASSIC_MAP = { width: World.WORLD_X, height: World.WORLD_Y } as const;
const { WORLD_Y, HWLDY, SmY } = World;
const { LOMASK } = TileMask;

/**
 * Tick-local scalar fields used by replay fixture action logs.
 *
 * These fields mirror scalar values consumed by `Simulate` in
 * `ref/micropolis/src/sim/s_sim.c` and by the headless oracle snapshot
 * in `packages/micropolis-c-harness/core/core_oracle.c`.
 */
type ReplayScalarField =
  | 'Scycle'
  | 'NewPower'
  | 'DoInitialEval'
  | 'CityTime'
  | 'CityTax'
  | 'AvCityTax'
  | 'SimSpeed';

/**
 * Replay action that mutates one scalar before a tick executes.
 *
 * Test harness action layer only; this is not a direct C API. It mutates
 * fields that drive `Simulate` behavior from `ref/micropolis/src/sim/s_sim.c`.
 */
interface ReplaySetScalarAction {
  tick: number;
  kind: 'set-scalar';
  field: ReplayScalarField;
  value: number;
}

/**
 * Replay action that mutates one traffic-memory cell before a tick executes.
 *
 * Targets `TrfDensity[HWLDX][HWLDY]` from `ref/micropolis/src/sim/s_sim.c`.
 */
interface ReplaySetTrafficAction {
  tick: number;
  kind: 'set-trf-density';
  x: number;
  y: number;
  value: number;
}

/**
 * Replay action that mutates one ROG-memory cell before a tick executes.
 *
 * Targets `RateOGMem[SmX][SmY]` from `ref/micropolis/src/sim/s_sim.c`.
 */
interface ReplaySetRogAction {
  tick: number;
  kind: 'set-rate-og-mem';
  x: number;
  y: number;
  value: number;
}

type ReplayFixtureAction = ReplaySetScalarAction | ReplaySetTrafficAction | ReplaySetRogAction;

/**
 * On-disk replay action-log fixture shape.
 *
 * This file format is test-only and feeds both TS and C-oracle states.
 */
interface ReplayActionLogFile {
  version: number;
  actions: ReplayFixtureAction[];
}

/**
 * One canonical replay fixture entry.
 *
 * Pairs a `.cty` source city with a deterministic action-log and expected
 * replay hash for this phase-5 parity suite.
 */
interface ReplayFixtureRecord {
  name: string;
  city: string;
  actions: string;
  seed: number;
  expectedReplayHash: number;
}

/**
 * On-disk manifest for canonical replay fixtures.
 *
 * Maintains suite defaults and expected hashes for CI-stable replay parity.
 */
interface ReplayFixtureManifest {
  version: number;
  defaultTicks: number;
  defaultCheckpointCadence: number[];
  fixtures: ReplayFixtureRecord[];
}

/**
 * Hashed digest of parity-critical state at one checkpoint.
 *
 * Bundles maps/layers/scalars that are currently modeled by
 * `core_oracle.c` snapshots and compared against TS simulation.
 */
interface ReplayCheckpointDigest {
  mapHash: number;
  trfHash: number;
  rogHash: number;
  powerHash: number;
  powerStackXHash: number;
  powerStackYHash: number;
  scalarHash: number;
  combinedHash: number;
}

/**
 * Pairwise TS-vs-C checkpoint record.
 *
 * Captures one tick boundary to keep replay diagnostics local and deterministic.
 */
interface ReplayCheckpointRecord {
  tick: number;
  ts: ReplayCheckpointDigest;
  oracle: ReplayCheckpointDigest;
}

/**
 * Half-resolution index helper for `TrfDensity[HWLDX][HWLDY]`.
 *
 * Mirrors traffic layer indexing in `ref/micropolis/src/sim/s_sim.c`.
 */
function trfIndexFor(x: number, y: number): number {
  return x * HWLDY + y;
}

/**
 * Eighth-resolution index helper for `RateOGMem[SmX][SmY]`.
 *
 * Mirrors ROG layer indexing in `ref/micropolis/src/sim/s_sim.c`.
 */
function rogIndexFor(x: number, y: number): number {
  return x * SmY + y;
}

/**
 * Parse a positive integer environment override.
 *
 * Test harness utility; no direct C equivalent.
 */
function parsePositiveEnvInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const value = Math.trunc(Number(raw));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  return value;
}

/**
 * Parse a comma-separated cadence list from environment.
 *
 * Test harness utility; used to control replay checkpoint density.
 */
function parseCadenceEnv(name: string): number[] | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const parsed = raw
    .split(',')
    .map((part) => Math.trunc(Number(part.trim())))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (parsed.length === 0) {
    throw new Error(`${name} must contain at least one positive integer, got: ${raw}`);
  }
  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

/**
 * Parse an optional fixture-name filter from environment.
 *
 * Test harness utility for env-gated replay fixture subsets.
 */
function parseFixtureFilterEnv(name: string): string[] | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const names = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (names.length === 0) {
    throw new Error(`${name} must contain at least one fixture name when set`);
  }
  return Array.from(new Set(names));
}

/**
 * Build checkpoint tick ids from cadence values.
 *
 * This phase-5 cadence model is plan-driven (every `1/4/16` ticks by default),
 * not a direct C API behavior.
 */
function buildCheckpointSet(totalTicks: number, cadence: readonly number[]): Set<number> {
  const checkpoints = new Set<number>();
  for (let tick = 1; tick <= totalTicks; tick += 1) {
    for (const step of cadence) {
      if (tick % step === 0) {
        checkpoints.add(tick);
        break;
      }
    }
  }
  checkpoints.add(totalTicks);
  return checkpoints;
}

/**
 * Load and validate the replay fixture manifest.
 *
 * Test harness utility for canonical `.cty` + action-log fixture wiring.
 */
function readReplayFixtureManifest(): ReplayFixtureManifest {
  const file = path.join(REPLAY_FIXTURE_DIR, 'manifest.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ReplayFixtureManifest>;
  if (!Array.isArray(parsed.fixtures) || typeof parsed.defaultTicks !== 'number') {
    throw new Error(`invalid replay fixture manifest: ${file}`);
  }
  if (
    !Array.isArray(parsed.defaultCheckpointCadence) ||
    parsed.defaultCheckpointCadence.length === 0
  ) {
    throw new Error(`manifest must declare default checkpoint cadence: ${file}`);
  }
  return parsed as ReplayFixtureManifest;
}

/**
 * Load and validate one replay action-log file.
 *
 * Test harness utility for deterministic action injection before each tick.
 */
function readReplayActionLog(fileName: string): ReplayActionLogFile {
  const file = path.join(REPLAY_FIXTURE_DIR, fileName);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ReplayActionLogFile>;
  if (!Array.isArray(parsed.actions)) {
    throw new Error(`invalid replay action-log fixture: ${file}`);
  }
  return parsed as ReplayActionLogFile;
}

/**
 * Group fixture actions by tick boundary.
 *
 * Test harness utility; enables deterministic pre-tick action application.
 */
function groupActionsByTick(
  actions: readonly ReplayFixtureAction[],
): Map<number, ReplayFixtureAction[]> {
  const grouped = new Map<number, ReplayFixtureAction[]>();
  for (const action of actions) {
    const tick = Math.max(0, Math.trunc(action.tick));
    const bucket = grouped.get(tick);
    if (bucket) {
      bucket.push(action);
    } else {
      grouped.set(tick, [action]);
    }
  }
  return grouped;
}

/**
 * Apply one fixture action to oracle snapshot state.
 *
 * The mutated fields map to oracle snapshot payloads generated by
 * `packages/micropolis-c-harness/core/core_oracle.c`.
 */
function applyActionToOracleState(state: CoreOracleState, action: ReplayFixtureAction): void {
  if (action.kind === 'set-scalar') {
    state[action.field] = Math.trunc(action.value);
    return;
  }

  if (action.kind === 'set-trf-density') {
    const index = trfIndexFor(action.x, action.y);
    if (index < 0 || index >= state.trfDensity.length) {
      throw new Error(`trf action out of bounds at (${action.x}, ${action.y})`);
    }
    state.trfDensity[index] = Math.trunc(action.value) & 0xff;
    return;
  }

  const index = rogIndexFor(action.x, action.y);
  if (index < 0 || index >= state.rateOGMem.length) {
    throw new Error(`rog action out of bounds at (${action.x}, ${action.y})`);
  }
  state.rateOGMem[index] = Math.trunc(action.value);
}

/**
 * Apply one fixture action to TS simulation state.
 *
 * Mirrors the oracle mutation shape above so both engines consume the same
 * replay action-log before stepping each tick.
 */
function applyActionToTsState(
  state: SimState,
  context: SimContext,
  action: ReplayFixtureAction,
): void {
  if (action.kind === 'set-scalar') {
    state[action.field] = Math.trunc(action.value);
    return;
  }

  if (action.kind === 'set-trf-density') {
    const trfDensity = context.store.getLayer('trfDensity') as Uint8Array;
    const index = trfIndexFor(action.x, action.y);
    if (index < 0 || index >= trfDensity.length) {
      throw new Error(`trf action out of bounds at (${action.x}, ${action.y})`);
    }
    trfDensity[index] = Math.trunc(action.value) & 0xff;
    return;
  }

  const rateOGMem = context.store.getLayer('rateOGMem') as Int16Array;
  const index = rogIndexFor(action.x, action.y);
  if (index < 0 || index >= rateOGMem.length) {
    throw new Error(`rog action out of bounds at (${action.x}, ${action.y})`);
  }
  rateOGMem[index] = Math.trunc(action.value);
}

/**
 * Minimal `MapScan` behavior aligned with the current headless core oracle.
 *
 * Mirrors `MapScan` + zone-power subset in
 * `packages/micropolis-c-harness/core/core_oracle.c`, which in turn maps to
 * `ref/micropolis/src/sim/s_sim.c` and `ref/micropolis/src/sim/s_zone.c`.
 */
function mapScanOracleSubset(phase: number, state: SimState, context: SimContext): void {
  if (phase < 1 || phase > 8) {
    return;
  }

  const x1 = Math.floor(((phase - 1) * World.WORLD_X) / 8);
  const x2 = Math.floor((phase * World.WORLD_X) / 8);
  const map = context.store.getLayer('map') as Uint16Array;
  const power = context.store.getLayer('power') as Uint16Array;

  for (let x = x1; x < x2; x += 1) {
    const base = x * WORLD_Y;
    for (let y = 0; y < World.WORLD_Y; y += 1) {
      const index = base + y;
      const tile = map[index] ?? 0;
      if (tile === 0) {
        continue;
      }

      const tileId = tile & LOMASK;
      state.CChr9 = tileId;
      if (tileId < Tile.FLOOD) {
        continue;
      }

      if (state.NewPower !== 0 && (tile & TileFlag.CONDBIT) !== 0) {
        setZPowerAt(context.store, power, x, y, index, tile);
      }

      const zoneTile = map[index] ?? tile;
      if ((zoneTile & TileFlag.ZONEBIT) !== 0) {
        const powered = setZPowerAt(context.store, power, x, y, index, zoneTile);
        if (powered) {
          state.PwrdZCnt += 1;
        } else {
          state.unPwrdZCnt += 1;
        }
        if (tileId === Tile.POWERPLANT) {
          state.CoalPop += 1;
          pushPowerStack(state, x, y);
        } else if (tileId === Tile.NUCLEAR) {
          state.NuclearPop += 1;
          pushPowerStack(state, x, y);
        }
        continue;
      }

      if (tileId >= Tile.SOMETINYEXP && tileId <= Tile.LASTTINYEXP) {
        const rubble = Tile.RUBBLE + (context.rng.next16() & 3) + TileFlag.BULLBIT;
        context.store.write('map', index, rubble);
      }
    }
  }
}

/**
 * Minimal `ClearCensus` behavior aligned with the current headless core oracle.
 *
 * Mirrors `ClearCensus` subset implemented in
 * `packages/micropolis-c-harness/core/core_oracle.c`.
 */
function clearCensusOracleSubset(state: SimState): void {
  state.PwrdZCnt = 0;
  state.unPwrdZCnt = 0;
  state.CoalPop = 0;
  state.NuclearPop = 0;
  state.PowerStackNum = 0;
}

/**
 * Map-dirty bridge used by phase 10/11 parity checks.
 *
 * Mirrors `NewMapFlags[...] = 1` writes in `Simulate` from
 * `ref/micropolis/src/sim/s_sim.c`.
 */
function markMapDirtyFlags(flags: ReadonlyArray<SimMapFlag>, state: SimState): void {
  for (const flag of flags) {
    state.NewMapFlags[MAP_FLAGS[flag]] = 1;
  }
}

/**
 * Build the TS system wiring that mirrors current oracle coverage.
 *
 * This intentionally matches the subset of systems compiled into
 * `packages/micropolis-c-harness/core/core_oracle.c`.
 */
function createOracleSubsetSystems(): SimPhaseSystems {
  return {
    clearCensus: (state) => clearCensusOracleSubset(state),
    mapScan: mapScanOracleSubset,
    decTrafficMem,
    decROGMem,
    doPowerScan,
    markMapDirty: (flags, state) => markMapDirtyFlags(flags, state),
  };
}

/**
 * Step one TS tick using the oracle-subset phase wiring.
 *
 * Mirrors the `step-tick` command path in `core_oracle.c`, which runs
 * sixteen `Simulate((start + i) & 15)` calls.
 */
function stepTsTick(state: SimState, context: SimContext, systems: SimPhaseSystems): void {
  for (let phase = 0; phase < 16; phase += 1) {
    dispatchSimPhase(phase, state, context, systems);
  }
}

/**
 * Copy parity-critical scalar fields from oracle state to TS state.
 *
 * Keeps both runners aligned with the scalar snapshot contract in
 * `packages/micropolis-c-harness/core/core_oracle.c`.
 */
function syncTsStateFromOracle(state: SimState, oracle: CoreOracleState): void {
  state.CityTime = oracle.CityTime;
  state.CityTax = oracle.CityTax;
  state.AvCityTax = oracle.AvCityTax;
  state.Scycle = oracle.Scycle;
  state.Fcycle = oracle.Fcycle;
  state.SimSpeed = oracle.SimSpeed;
  state.DoInitialEval = oracle.DoInitialEval;
  state.NewPower = oracle.NewPower;
  state.CChr9 = oracle.CChr9;
  state.CoalPop = oracle.CoalPop;
  state.NuclearPop = oracle.NuclearPop;
  state.PwrdZCnt = oracle.PwrdZCnt;
  state.unPwrdZCnt = oracle.unPwrdZCnt;
  state.PowerStackNum = oracle.PowerStackNum;
  state.TrafMaxX = oracle.TrafMaxX;
  state.TrafMaxY = oracle.TrafMaxY;
  state.PowerStackX.set(oracle.powerStackX);
  state.PowerStackY.set(oracle.powerStackY);
  state.NewMapFlags[MAP_FLAGS.ALMAP] = oracle.NewMapFlags.ALMAP;
  state.NewMapFlags[MAP_FLAGS.REMAP] = oracle.NewMapFlags.REMAP;
  state.NewMapFlags[MAP_FLAGS.COMAP] = oracle.NewMapFlags.COMAP;
  state.NewMapFlags[MAP_FLAGS.INMAP] = oracle.NewMapFlags.INMAP;
  state.NewMapFlags[MAP_FLAGS.PRMAP] = oracle.NewMapFlags.PRMAP;
  state.NewMapFlags[MAP_FLAGS.RDMAP] = oracle.NewMapFlags.RDMAP;
  state.NewMapFlags[MAP_FLAGS.TDMAP] = oracle.NewMapFlags.TDMAP;
  state.NewMapFlags[MAP_FLAGS.DYMAP] = oracle.NewMapFlags.DYMAP;
}

/**
 * Hash oracle scalar fields that are modeled in TS parity checks.
 *
 * This follows the oracle snapshot field list from `core_oracle.c`.
 */
function hashOracleScalars(state: CoreOracleState): number {
  return hashScalars([
    state.CityTime,
    state.CityTax,
    state.AvCityTax,
    state.Scycle,
    state.Fcycle,
    state.SimSpeed,
    state.DoInitialEval,
    state.NewPower,
    state.CChr9,
    state.CoalPop,
    state.NuclearPop,
    state.PwrdZCnt,
    state.unPwrdZCnt,
    state.PowerStackNum,
    state.TrafMaxX,
    state.TrafMaxY,
    state.NewMapFlags.ALMAP,
    state.NewMapFlags.REMAP,
    state.NewMapFlags.COMAP,
    state.NewMapFlags.INMAP,
    state.NewMapFlags.PRMAP,
    state.NewMapFlags.RDMAP,
    state.NewMapFlags.TDMAP,
    state.NewMapFlags.DYMAP,
  ]);
}

/**
 * Hash TS scalar fields that correspond to oracle snapshot fields.
 *
 * This is the TS-side counterpart to `hashOracleScalars`.
 */
function hashTsScalars(state: SimState): number {
  return hashScalars([
    state.CityTime,
    state.CityTax,
    state.AvCityTax,
    state.Scycle,
    state.Fcycle,
    state.SimSpeed,
    state.DoInitialEval,
    state.NewPower,
    state.CChr9,
    state.CoalPop,
    state.NuclearPop,
    state.PwrdZCnt,
    state.unPwrdZCnt,
    state.PowerStackNum,
    state.TrafMaxX,
    state.TrafMaxY,
    state.NewMapFlags[MAP_FLAGS.ALMAP] ?? 0,
    state.NewMapFlags[MAP_FLAGS.REMAP] ?? 0,
    state.NewMapFlags[MAP_FLAGS.COMAP] ?? 0,
    state.NewMapFlags[MAP_FLAGS.INMAP] ?? 0,
    state.NewMapFlags[MAP_FLAGS.PRMAP] ?? 0,
    state.NewMapFlags[MAP_FLAGS.RDMAP] ?? 0,
    state.NewMapFlags[MAP_FLAGS.TDMAP] ?? 0,
    state.NewMapFlags[MAP_FLAGS.DYMAP] ?? 0,
  ]);
}

/**
 * Build the digest for one oracle checkpoint.
 *
 * Combines layer hashes + scalar hash from the current oracle snapshot.
 */
function digestOracleCheckpoint(state: CoreOracleState): ReplayCheckpointDigest {
  const mapHash = hashUint16(state.map);
  const trfHash = hashBytes(state.trfDensity);
  const rogHash = hashInt16(state.rateOGMem);
  const powerHash = hashUint16(state.powerMap);
  const powerStackXHash = hashBytes(state.powerStackX);
  const powerStackYHash = hashBytes(state.powerStackY);
  const scalarHash = hashOracleScalars(state);
  const combinedHash = mixHashes(
    mapHash,
    trfHash,
    rogHash,
    powerHash,
    powerStackXHash,
    powerStackYHash,
    scalarHash,
  );

  return {
    mapHash,
    trfHash,
    rogHash,
    powerHash,
    powerStackXHash,
    powerStackYHash,
    scalarHash,
    combinedHash,
  };
}

/**
 * Build the digest for one TS checkpoint.
 *
 * Uses the same hash composition as `digestOracleCheckpoint`.
 */
function digestTsCheckpoint(state: SimState, context: SimContext): ReplayCheckpointDigest {
  const map = context.store.getLayer('map') as Uint16Array;
  const trf = context.store.getLayer('trfDensity') as Uint8Array;
  const rog = context.store.getLayer('rateOGMem') as Int16Array;
  const power = context.store.getLayer('power') as Uint16Array;

  const mapHash = hashUint16(map);
  const trfHash = hashBytes(trf);
  const rogHash = hashInt16(rog);
  const powerHash = hashUint16(power);
  const powerStackXHash = hashBytes(state.PowerStackX);
  const powerStackYHash = hashBytes(state.PowerStackY);
  const scalarHash = hashTsScalars(state);
  const combinedHash = mixHashes(
    mapHash,
    trfHash,
    rogHash,
    powerHash,
    powerStackXHash,
    powerStackYHash,
    scalarHash,
  );

  return {
    mapHash,
    trfHash,
    rogHash,
    powerHash,
    powerStackXHash,
    powerStackYHash,
    scalarHash,
    combinedHash,
  };
}

/**
 * Fold checkpoint hashes into a stable replay-suite hash.
 *
 * This phase-5 suite hash is a test harness construct, used to keep CI parity
 * checkpoints stable over time.
 */
function hashReplaySeries(checkpoints: readonly ReplayCheckpointRecord[]): number {
  const scalars: number[] = [];
  for (const checkpoint of checkpoints) {
    scalars.push(checkpoint.tick, checkpoint.ts.combinedHash);
  }
  return hashScalars(scalars);
}

/**
 * Run one canonical replay fixture end-to-end and collect checkpoint digests.
 *
 * Uses `.cty` map input from `ref/micropolis/src/sim/s_fileio.c`-compatible
 * decoding plus action-log mutations, then compares TS steps against
 * `micropolis-core-oracle` tick stepping.
 */
function runReplayFixture(
  fixture: ReplayFixtureRecord,
  ticks: number,
  checkpointCadence: readonly number[],
): { checkpoints: ReplayCheckpointRecord[]; replayHash: number } {
  const cityPath = path.join(CITY_DIR, fixture.city);
  const cityBytes = readFileSync(cityPath);
  const city = decodeCityFileForMap(cityBytes, CLASSIC_MAP);
  const loadMeta = applyLoadNormalization(readCityMeta(city.misc));

  let oracleState = runCoreOracleInitNewCity({
    seed: fixture.seed,
    cityTime: loadMeta.cityTime,
    cityTax: loadMeta.cityTax,
    simSpeed: loadMeta.simSpeed,
  });
  oracleState.map.set(city.map);

  const store = createClassicMapStore();
  const context = createSimContext({ store, rng: createRng(fixture.seed) });
  const state = createSimState();
  syncTsStateFromOracle(state, oracleState);

  store.beginTick();
  (store.getLayer('map') as Uint16Array).set(city.map);
  (store.getLayer('trfDensity') as Uint8Array).set(oracleState.trfDensity);
  (store.getLayer('rateOGMem') as Int16Array).set(oracleState.rateOGMem);
  (store.getLayer('power') as Uint16Array).set(oracleState.powerMap);

  const actions = readReplayActionLog(fixture.actions);
  const actionsByTick = groupActionsByTick(actions.actions);
  const checkpointsToCapture = buildCheckpointSet(ticks, checkpointCadence);
  const checkpoints: ReplayCheckpointRecord[] = [];
  const systems = createOracleSubsetSystems();

  for (let tick = 0; tick < ticks; tick += 1) {
    const tickActions = actionsByTick.get(tick);
    if (tickActions) {
      for (const action of tickActions) {
        applyActionToOracleState(oracleState, action);
        applyActionToTsState(state, context, action);
      }
    }

    oracleState = runCoreOracleStepTick(oracleState);
    stepTsTick(state, context, systems);

    const tickNumber = tick + 1;
    if (!checkpointsToCapture.has(tickNumber)) {
      continue;
    }

    const oracleDigest = digestOracleCheckpoint(oracleState);
    const tsDigest = digestTsCheckpoint(state, context);

    checkpoints.push({
      tick: tickNumber,
      ts: tsDigest,
      oracle: oracleDigest,
    });
  }

  store.commitTick();

  return {
    checkpoints,
    replayHash: hashReplaySeries(checkpoints),
  };
}

/**
 * Resolve fixture selection from manifest + optional env filter.
 *
 * Test harness utility to gate heavy replay fixture sets in parity jobs.
 */
function selectFixtures(
  fixtures: readonly ReplayFixtureRecord[],
  requestedNames: readonly string[] | undefined,
): ReplayFixtureRecord[] {
  if (!requestedNames || requestedNames.length === 0) {
    return [...fixtures];
  }

  const byName = new Map(fixtures.map((fixture) => [fixture.name, fixture] as const));
  const selected: ReplayFixtureRecord[] = [];
  for (const name of requestedNames) {
    const fixture = byName.get(name);
    if (!fixture) {
      throw new Error(`unknown replay fixture: ${name}`);
    }
    selected.push(fixture);
  }
  return selected;
}

describe('Replay parity against C oracle (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  it('matches canonical replay checkpoints and suite hashes for fixture/action logs', () => {
    const manifest = readReplayFixtureManifest();
    const ticks = parsePositiveEnvInt('CITY_TEST_PARITY_REPLAY_TICKS') ?? manifest.defaultTicks;
    const checkpointCadence =
      parseCadenceEnv('CITY_TEST_PARITY_REPLAY_CHECKPOINTS') ?? manifest.defaultCheckpointCadence;
    const requestedFixtures = parseFixtureFilterEnv('CITY_TEST_PARITY_REPLAY_FIXTURES');
    const fixtures = selectFixtures(manifest.fixtures, requestedFixtures);

    const hasCustomKnobs =
      process.env.CITY_TEST_PARITY_REPLAY_TICKS !== undefined ||
      process.env.CITY_TEST_PARITY_REPLAY_CHECKPOINTS !== undefined ||
      process.env.CITY_TEST_PARITY_REPLAY_FIXTURES !== undefined;

    // These fixture actions intentionally exercise C decay boundaries from
    // `DecTrafficMem`/`DecROGMem` in `ref/micropolis/src/sim/s_sim.c`:
    // traffic thresholds 24/200 and ROG clamping at +/-200.
    for (const fixture of fixtures) {
      const result = runReplayFixture(fixture, ticks, checkpointCadence);
      expect(result.checkpoints.length).toBeGreaterThan(0);

      for (const checkpoint of result.checkpoints) {
        expect(checkpoint.ts.mapHash).toBe(checkpoint.oracle.mapHash);
        expect(checkpoint.ts.trfHash).toBe(checkpoint.oracle.trfHash);
        expect(checkpoint.ts.rogHash).toBe(checkpoint.oracle.rogHash);
        expect(checkpoint.ts.powerHash).toBe(checkpoint.oracle.powerHash);
        expect(checkpoint.ts.powerStackXHash).toBe(checkpoint.oracle.powerStackXHash);
        expect(checkpoint.ts.powerStackYHash).toBe(checkpoint.oracle.powerStackYHash);
        expect(checkpoint.ts.scalarHash).toBe(checkpoint.oracle.scalarHash);
        expect(checkpoint.ts.combinedHash).toBe(checkpoint.oracle.combinedHash);
      }

      if (!hasCustomKnobs) {
        expect(result.replayHash).toBe(fixture.expectedReplayHash);
      }
    }
  });

  if (process.env.CITY_TEST_PARITY_REPLAY_HEAVY !== '1') {
    it.skip('set CITY_TEST_PARITY_REPLAY_HEAVY=1 to run the heavy replay matrix', () => {});
    return;
  }

  it('runs heavy replay parity matrix under env knob', () => {
    const manifest = readReplayFixtureManifest();
    const heavyTicks = parsePositiveEnvInt('CITY_TEST_PARITY_REPLAY_HEAVY_TICKS') ?? 64;
    const cadence = parseCadenceEnv('CITY_TEST_PARITY_REPLAY_HEAVY_CHECKPOINTS') ?? [1, 4, 16];

    for (const fixture of manifest.fixtures) {
      const result = runReplayFixture(fixture, heavyTicks, cadence);
      expect(result.checkpoints.length).toBeGreaterThan(0);
      for (const checkpoint of result.checkpoints) {
        expect(checkpoint.ts.combinedHash).toBe(checkpoint.oracle.combinedHash);
      }
    }
  });
});
