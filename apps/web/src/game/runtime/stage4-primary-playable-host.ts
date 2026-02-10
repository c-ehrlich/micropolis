import {
  DemoMapHost,
  type DemoMapHostOptions,
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
 * Parity note: this is a 1:1 shape port of Stage 2 save payload fields, renamed
 * for Stage 4 route ownership.
 */
export interface Stage4CityExportPayload {
  fileName: string;
  cityName: string;
  cityBytes: Uint8Array;
}

/**
 * Stage 4 default-host configuration for the primary playable route.
 * Mirrors startup/runtime option intent in `ref/micropolis/src/sim/w_sim.c`,
 * where one command surface can be wired to different runtime conditions.
 * Parity note: this is a direct TypeScript alias of `DemoMapHost` options.
 */
export type Stage4PrimaryPlayableHostOptions = DemoMapHostOptions;

/**
 * Build the default Stage 4 playable route host.
 * Mirrors single command-surface ownership in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this still uses `DemoMapHost` as the authority adapter, but now
 * exposes options so default-path wiring and tests share one Stage 4 factory.
 */
export function createStage4PrimaryPlayableHost(
  options: Stage4PrimaryPlayableHostOptions = {},
): CoreHost {
  return new DemoMapHost(options);
}

/**
 * Read Stage 4 `save-city` browser export bytes from a patch payload.
 * Mirrors `SaveCityAs` export delivery in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this keeps Stage 2 parser behavior 1:1 while removing direct
 * route dependence on legacy `Demo*` parser naming.
 */
export function readStage4CityExportPayload(payload: unknown): Stage4CityExportPayload | null {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }

  const cityIo = (payload as { cityIo?: unknown }).cityIo;
  if (cityIo === null || typeof cityIo !== 'object') {
    return null;
  }

  const save = (cityIo as { save?: unknown }).save;
  if (save === null || typeof save !== 'object') {
    return null;
  }

  const candidate = save as Partial<Stage4CityExportPayload>;
  if (
    typeof candidate.fileName !== 'string' ||
    typeof candidate.cityName !== 'string' ||
    !(candidate.cityBytes instanceof Uint8Array)
  ) {
    return null;
  }

  return {
    fileName: candidate.fileName,
    cityName: candidate.cityName,
    cityBytes: candidate.cityBytes,
  };
}
