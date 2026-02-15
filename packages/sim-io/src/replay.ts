import {
  getScenarioDefinition,
  type ScenarioDefinition,
} from '../../scenario-core/src/classic-scenarios.ts';
import { World } from '../../sim-core/src/core/constants.ts';
import {
  applyLoadNormalization,
  type CityFile,
  decodeCityFileForMap,
  readCityMeta,
} from '../../sim-core/src/io/cty.ts';
import { scenarioDisasterWaitForId, scenarioScoreWaitForId } from './scenarios.ts';

/**
 * Map-size selector for `.cty`/`snro.*` decoding.
 * Mirrors classic dimensions from `ref/micropolis/src/sim/headers/sim.h`.
 */
export interface ReplayMapSize {
  width: number;
  height: number;
}

/**
 * Scalar + map seed used by load-replay checkpoint tests.
 * This is a test-harness snapshot shape, derived from C load/scenario rules.
 */
export interface LoadReplaySeed {
  cityTime: number;
  cityTax: number;
  simSpeed: number;
  totalFunds: number;
  scenarioId: number;
  scoreType: number;
  scoreWait: number;
  disasterEvent: number;
  disasterWait: number;
  map: Uint16Array;
}

/**
 * Decoded scenario seed bundle.
 * Wraps the scenario table row plus the replay seed state derived from `snro.*` bytes.
 */
export interface ScenarioReplaySeed {
  scenario: ScenarioDefinition;
  seed: LoadReplaySeed;
}

/**
 * Classic 120x100 map dimensions.
 * Mirrors `WORLD_X/WORLD_Y` in `ref/micropolis/src/sim/headers/sim.h`.
 */
export const CLASSIC_REPLAY_MAP_SIZE: ReplayMapSize = Object.freeze({
  width: World.WORLD_X,
  height: World.WORLD_Y,
});

/**
 * Build a load replay seed from a decoded city file using C `loadFile` normalization rules.
 * Mirrors metadata normalization in `loadFile` in `ref/micropolis/src/sim/s_fileio.c`.
 */
function createLoadReplaySeedFromCity(city: CityFile): LoadReplaySeed {
  const normalizedMeta = applyLoadNormalization(readCityMeta(city.misc));

  return {
    cityTime: normalizedMeta.cityTime,
    cityTax: normalizedMeta.cityTax,
    simSpeed: normalizedMeta.simSpeed,
    totalFunds: normalizedMeta.totalFunds,
    scenarioId: 0,
    scoreType: 0,
    scoreWait: 0,
    disasterEvent: 0,
    disasterWait: 0,
    map: city.map.slice(),
  };
}

/**
 * Decode `.cty` bytes into a replay seed that mirrors `loadFile` metadata handling.
 * Ports the C load metadata semantics from `ref/micropolis/src/sim/s_fileio.c`.
 */
export function createLoadFileReplaySeed(
  cityBytes: Uint8Array,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): LoadReplaySeed {
  const city = decodeCityFileForMap(cityBytes, mapSize);
  return createLoadReplaySeedFromCity(city);
}

/**
 * Build a scenario replay seed from a decoded `snro.*` file and scenario id.
 * Mirrors scenario constants from `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c`
 * plus scenario timers initialized in `simLoadInit` (`ref/micropolis/src/sim/s_sim.c`).
 */
function createScenarioReplaySeedFromCity(city: CityFile, scenarioId: number): ScenarioReplaySeed {
  const scenario = getScenarioDefinition(scenarioId);

  return {
    scenario,
    seed: {
      cityTime: scenario.startCityTime,
      cityTax: 7,
      simSpeed: 3,
      totalFunds: scenario.startFunds,
      scenarioId: scenario.id,
      scoreType: scenario.id,
      scoreWait: scenarioScoreWaitForId(scenario.id),
      disasterEvent: scenario.id,
      disasterWait: scenarioDisasterWaitForId(scenario.id),
      map: city.map.slice(),
    },
  };
}

/**
 * Decode `snro.*` bytes into a replay seed for deterministic load->simulate checkpoints.
 * Mirrors the combined `LoadScenario` + `DoSimInit` scenario scalar setup from
 * `ref/micropolis/src/sim/s_fileio.c` and `ref/micropolis/src/sim/s_sim.c`.
 */
export function createScenarioReplaySeed(
  scenarioId: number,
  scenarioBytes: Uint8Array,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): ScenarioReplaySeed {
  const city = decodeCityFileForMap(scenarioBytes, mapSize);
  return createScenarioReplaySeedFromCity(city, scenarioId);
}
