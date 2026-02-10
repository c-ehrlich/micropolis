import {
  type DemoCityExportPayload,
  DemoMapHost,
  readDemoCityExportPayload,
  STAGE2_SCENARIO_CHOICES,
  type Stage2ScenarioChoice,
} from './demo-map-host.ts';
import type { CoreHost } from './protocol.ts';

/**
 * Stage 4 scenario choice metadata used by the default playable route.
 * Mirrors `LoadScenario` table rows in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this is a naming/ownership wrapper over existing scenario metadata.
 */
export type Stage4ScenarioChoice = Stage2ScenarioChoice;

/**
 * Scenario choices for the primary Stage 4 gameplay route.
 * Mirrors `LoadScenario` metadata surfaced from `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this keeps route imports off legacy Stage 2 naming without changing behavior.
 */
export const STAGE4_SCENARIO_CHOICES: readonly Stage4ScenarioChoice[] = STAGE2_SCENARIO_CHOICES;

/**
 * Browser `.cty` export payload emitted by Stage 4 save-city patch updates.
 * Mirrors `SaveCityAs` output ownership in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this aliases existing payload shape while moving route usage off demo naming.
 */
export type Stage4CityExportPayload = DemoCityExportPayload;

/**
 * Build the default Stage 4 playable route host.
 * Mirrors single command-surface ownership in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this currently uses `DemoMapHost` as the authority adapter but hides
 * legacy demo naming from the user-facing route wiring.
 */
export function createStage4PrimaryPlayableHost(): CoreHost {
  return new DemoMapHost();
}

/**
 * Read Stage 4 `save-city` browser export bytes from a patch payload.
 * Mirrors `SaveCityAs` export delivery in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this preserves existing payload parsing behavior 1:1.
 */
export function readStage4CityExportPayload(payload: unknown): Stage4CityExportPayload | null {
  return readDemoCityExportPayload(payload);
}
