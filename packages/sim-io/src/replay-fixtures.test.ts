import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  type CoreOracleState,
  runCoreOracleInitNewCity,
  runCoreOracleStepTick,
} from '../../micropolis-c-harness/src/core-parity.ts';
import {
  createClassicMapStore,
  createRng,
  createSimContext,
  createSimState,
  decROGMem,
  decTrafficMem,
  dispatchSimPhase,
  hashBytes,
  hashInt16,
  hashScalars,
  hashUint16,
  MAP_FLAGS,
  mixHashes,
  type SimContext,
  type SimMapFlag,
  type SimPhaseSystems,
  type SimState,
  Tile,
  TileFlag,
  TileMask,
  World,
} from '../../sim-core/src/index.ts';
import { doPowerScan, pushPowerStack, setZPowerAt } from '../../sim-core/src/systems/power.ts';
import {
  createLoadFileReplaySeed,
  createScenarioReplaySeed,
  type LoadReplaySeed,
} from './replay.ts';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(PACKAGE_ROOT, 'fixtures', 'load-replay', 'manifest.json');
const CITY_FIXTURE_DIR = path.join(PACKAGE_ROOT, '..', 'sim-core', 'fixtures', 'cities');
const SCENARIO_FIXTURE_DIR = path.join(PACKAGE_ROOT, '..', '..', 'ref', 'micropolis', 'res');

const { WORLD_X, WORLD_Y } = World;
const { LOMASK } = TileMask;

/**
 * One fixture row in `fixtures/load-replay/manifest.json`.
 */
interface LoadReplayFixtureRecord {
  name: string;
  kind: 'city' | 'scenario';
  file: string;
  scenarioId?: number;
  seed: number;
  expectedReplayHash: number;
}

/**
 * On-disk fixture manifest shape for load->simulate replay checkpoints.
 */
interface LoadReplayFixtureManifest {
  version: number;
  defaultTicks: number;
  defaultCheckpointCadence: number[];
  fixtures: LoadReplayFixtureRecord[];
}

/**
 * Compact digest for one replay checkpoint.
 */
interface ReplayCheckpointDigest {
  mapHash: number;
  trfHash: number;
  rogHash: number;
  powerHash: number;
  scalarHash: number;
  combinedHash: number;
}

/**
 * Recorded checkpoint pair for TS and oracle.
 */
interface ReplayCheckpointRecord {
  tick: number;
  ts: ReplayCheckpointDigest;
  oracle: ReplayCheckpointDigest;
}

/**
 * Read a binary fixture payload from disk.
 */
function readFixtureBytes(filePath: string): Uint8Array {
  return new Uint8Array(readFileSync(filePath));
}

/**
 * Read and minimally validate the load replay fixture manifest.
 */
function readManifest(): LoadReplayFixtureManifest {
  const parsed = JSON.parse(
    readFileSync(MANIFEST_PATH, 'utf8'),
  ) as Partial<LoadReplayFixtureManifest>;
  if (
    typeof parsed.version !== 'number' ||
    typeof parsed.defaultTicks !== 'number' ||
    !Array.isArray(parsed.defaultCheckpointCadence) ||
    !Array.isArray(parsed.fixtures)
  ) {
    throw new Error(`invalid load replay fixture manifest: ${MANIFEST_PATH}`);
  }
  return parsed as LoadReplayFixtureManifest;
}

/**
 * Resolve fixture bytes and load replay seed.
 */
function loadSeedForFixture(fixture: LoadReplayFixtureRecord): LoadReplaySeed {
  if (fixture.kind === 'city') {
    const filePath = path.join(CITY_FIXTURE_DIR, fixture.file);
    return createLoadFileReplaySeed(readFixtureBytes(filePath));
  }

  const filePath = path.join(SCENARIO_FIXTURE_DIR, fixture.file);
  return createScenarioReplaySeed(fixture.scenarioId ?? 1, readFixtureBytes(filePath)).seed;
}

/**
 * Disable scenario/disaster side effects that are outside this subset parity suite.
 *
 * This suite intentionally mirrors the same subset used by `core_oracle.c` parity tests:
 * map scan slices + decay + power scan. Scenario message/disaster scripting is validated in
 * dedicated systems tests and is not included in this load replay subset.
 */
function sanitizeSeedForSubsetParity(seed: LoadReplaySeed): LoadReplaySeed {
  return {
    ...seed,
    scenarioId: 0,
    scoreType: 0,
    scoreWait: 0,
    disasterEvent: 0,
    disasterWait: 0,
  };
}

/**
 * Build checkpoint tick ids from cadence values.
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
 * Minimal `MapScan` behavior aligned with the headless C oracle subset.
 * Mirrors the same subset model used in `packages/sim-core/src/sim/replay-parity.test.ts`.
 */
function mapScanOracleSubset(phase: number, state: SimState, context: SimContext): void {
  if (phase < 1 || phase > 8) {
    return;
  }

  const x1 = Math.floor(((phase - 1) * WORLD_X) / 8);
  const x2 = Math.floor((phase * WORLD_X) / 8);
  const map = context.store.getLayer('map') as Uint16Array;
  const power = context.store.getLayer('power') as Uint16Array;

  for (let x = x1; x < x2; x += 1) {
    const base = x * WORLD_Y;
    for (let y = 0; y < WORLD_Y; y += 1) {
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
        // Magic numbers from `MapScan` in `ref/micropolis/src/sim/s_sim.c`:
        // tiny explosion tiles become rubble + `(Rand16() & 3)` variation.
        const rubble = Tile.RUBBLE + (context.rng.next16() & 3) + TileFlag.BULLBIT;
        context.store.write('map', index, rubble);
      }
    }
  }
}

/**
 * Minimal `ClearCensus` behavior aligned with the headless C oracle subset.
 */
function clearCensusOracleSubset(state: SimState): void {
  state.PwrdZCnt = 0;
  state.unPwrdZCnt = 0;
  state.CoalPop = 0;
  state.NuclearPop = 0;
  state.PowerStackNum = 0;
}

/**
 * Write C-style map-dirty flags for phase 10/11.
 */
function markMapDirtyFlags(flags: ReadonlyArray<SimMapFlag>, state: SimState): void {
  for (const flag of flags) {
    state.NewMapFlags[MAP_FLAGS[flag]] = 1;
  }
}

/**
 * Build TS phase wiring that matches the oracle subset.
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
 */
function stepTsTick(state: SimState, context: SimContext, systems: SimPhaseSystems): void {
  for (let phase = 0; phase < 16; phase += 1) {
    dispatchSimPhase(phase, state, context, systems);
  }
}

/**
 * Apply load replay seed scalars to a C oracle snapshot.
 */
function applySeedToOracleState(state: CoreOracleState, seed: LoadReplaySeed): void {
  state.CityTime = seed.cityTime;
  state.CityTax = seed.cityTax;
  state.SimSpeed = seed.simSpeed;
  state.TotalFunds = seed.totalFunds;
  state.ScenarioID = seed.scenarioId;
  state.ScoreType = seed.scoreType;
  state.ScoreWait = seed.scoreWait;
  state.DisasterEvent = seed.disasterEvent;
  state.DisasterWait = seed.disasterWait;
  state.NoDisasters = 1;
  state.map.set(seed.map);
}

/**
 * Sync parity-critical scalar fields from oracle state into TS state.
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
 * Hash oracle scalar fields that are modeled in this subset suite.
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
 * Hash TS scalar fields that correspond to the oracle subset hash fields.
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
 * Build digest for one oracle checkpoint.
 */
function digestOracleCheckpoint(state: CoreOracleState): ReplayCheckpointDigest {
  const mapHash = hashUint16(state.map);
  const trfHash = hashBytes(state.trfDensity);
  const rogHash = hashInt16(state.rateOGMem);
  const powerHash = hashUint16(state.powerMap);
  const scalarHash = hashOracleScalars(state);
  const combinedHash = mixHashes(mapHash, trfHash, rogHash, powerHash, scalarHash);

  return { mapHash, trfHash, rogHash, powerHash, scalarHash, combinedHash };
}

/**
 * Build digest for one TS checkpoint.
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
  const scalarHash = hashTsScalars(state);
  const combinedHash = mixHashes(mapHash, trfHash, rogHash, powerHash, scalarHash);

  return { mapHash, trfHash, rogHash, powerHash, scalarHash, combinedHash };
}

/**
 * Fold checkpoint hashes into one stable replay-suite hash.
 */
function hashReplaySeries(checkpoints: readonly ReplayCheckpointRecord[]): number {
  const scalars: number[] = [];
  for (const checkpoint of checkpoints) {
    scalars.push(checkpoint.tick, checkpoint.ts.combinedHash);
  }
  return hashScalars(scalars);
}

/**
 * Run one fixture against TS subset systems and the C oracle.
 */
function runReplayFixture(
  fixture: LoadReplayFixtureRecord,
  ticks: number,
  checkpointCadence: readonly number[],
): { checkpoints: ReplayCheckpointRecord[]; replayHash: number } {
  const seed = sanitizeSeedForSubsetParity(loadSeedForFixture(fixture));

  let oracleState = runCoreOracleInitNewCity({
    seed: fixture.seed,
    cityTime: seed.cityTime,
    cityTax: seed.cityTax,
    simSpeed: seed.simSpeed,
  });
  applySeedToOracleState(oracleState, seed);

  const store = createClassicMapStore();
  const context = createSimContext({ store, rng: createRng(fixture.seed) });
  const state = createSimState();
  syncTsStateFromOracle(state, oracleState);

  store.beginTick();
  (store.getLayer('map') as Uint16Array).set(oracleState.map);
  (store.getLayer('trfDensity') as Uint8Array).set(oracleState.trfDensity);
  (store.getLayer('rateOGMem') as Int16Array).set(oracleState.rateOGMem);
  (store.getLayer('power') as Uint16Array).set(oracleState.powerMap);

  const checkpointsToCapture = buildCheckpointSet(ticks, checkpointCadence);
  const checkpoints: ReplayCheckpointRecord[] = [];
  const systems = createOracleSubsetSystems();

  for (let tick = 0; tick < ticks; tick += 1) {
    oracleState = runCoreOracleStepTick(oracleState);
    stepTsTick(state, context, systems);

    const tickNumber = tick + 1;
    if (!checkpointsToCapture.has(tickNumber)) {
      continue;
    }

    const oracleDigest = digestOracleCheckpoint(oracleState);
    const tsDigest = digestTsCheckpoint(state, context);
    checkpoints.push({ tick: tickNumber, ts: tsDigest, oracle: oracleDigest });
  }

  store.commitTick();

  return {
    checkpoints,
    replayHash: hashReplaySeries(checkpoints),
  };
}

describe('load replay fixtures', () => {
  const manifest = readManifest();

  it('produces stable suite hashes for default fixture checkpoints', () => {
    for (const fixture of manifest.fixtures) {
      const result = runReplayFixture(
        fixture,
        manifest.defaultTicks,
        manifest.defaultCheckpointCadence,
      );
      expect(result.replayHash).toBe(fixture.expectedReplayHash);
    }
  });

  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm --filter @city/sim-io test-parity` to enable C checkpoint parity checks', () => {});
    return;
  }

  it('matches C oracle checkpoint digests at default cadence', () => {
    for (const fixture of manifest.fixtures) {
      const result = runReplayFixture(
        fixture,
        manifest.defaultTicks,
        manifest.defaultCheckpointCadence,
      );

      expect(result.checkpoints.length).toBeGreaterThan(0);
      for (const checkpoint of result.checkpoints) {
        expect(checkpoint.ts.mapHash).toBe(checkpoint.oracle.mapHash);
        expect(checkpoint.ts.trfHash).toBe(checkpoint.oracle.trfHash);
        expect(checkpoint.ts.rogHash).toBe(checkpoint.oracle.rogHash);
        expect(checkpoint.ts.powerHash).toBe(checkpoint.oracle.powerHash);
        expect(checkpoint.ts.scalarHash).toBe(checkpoint.oracle.scalarHash);
        expect(checkpoint.ts.combinedHash).toBe(checkpoint.oracle.combinedHash);
      }
    }
  });
});
