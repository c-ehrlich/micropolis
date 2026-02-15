import {
  SCENARIO_TABLE,
  type ScenarioDefinition,
} from '../../../../../packages/scenario-core/src/classic-scenarios.ts';
import {
  type BuiltinScenarioKey,
  scenarioKeyForId,
} from '../../../../../packages/sim-io/src/scenarios.ts';

/**
 * Scenario choice metadata shown in the playable route scenario selector.
 * Mirrors scenario rows from `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this is a 1:1 metadata projection over canonical scenario-core definitions.
 */
export interface PlayableScenarioChoice {
  scenarioKey: BuiltinScenarioKey;
  id: number;
  name: string;
  fileName: string;
  startYear: number;
}

/**
 * Scenario option table for route `/` gameplay selectors.
 * Mirrors `LoadScenario` switch-table labels/file ids from
 * `ref/micropolis/src/sim/s_fileio.c` (1:1 metadata) with canonical `snro.*` file ids.
 */
export const PLAYABLE_SCENARIO_CHOICES: readonly PlayableScenarioChoice[] = SCENARIO_TABLE.map(
  (scenario: ScenarioDefinition) => ({
    scenarioKey: scenarioKeyForId(scenario.id),
    id: scenario.id,
    name: scenario.name,
    fileName: scenario.fileName,
    startYear: scenario.startYear,
  }),
);
