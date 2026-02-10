import {
  DemoMapHost,
  type DemoMapHostOptions,
  PLAYABLE_SCENARIO_CHOICES as DEMO_PLAYABLE_SCENARIO_CHOICES,
  type PlayableScenarioChoice as DemoPlayableScenarioChoice,
} from './demo-map-host.ts';
import type { CoreHost } from './protocol.ts';

/**
 * Authoritative Runtime scenario choice metadata used by the default playable route.
 * Mirrors `LoadScenario` table rows in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this is a naming/ownership wrapper over existing scenario metadata.
 */
export type PlayableScenarioChoice = DemoPlayableScenarioChoice;

/**
 * Scenario choices for the primary Authoritative Runtime gameplay route.
 * Mirrors `LoadScenario` metadata surfaced from `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this keeps route imports off legacy Playable Runtime naming without changing behavior.
 */
export const PLAYABLE_SCENARIO_CHOICES: readonly PlayableScenarioChoice[] =
  DEMO_PLAYABLE_SCENARIO_CHOICES;

/**
 * Browser `.cty` export payload emitted by Authoritative Runtime save-city patch updates.
 * Mirrors `SaveCityAs` output ownership in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this is a 1:1 shape port of Playable Runtime save payload fields, renamed
 * for Authoritative Runtime route ownership.
 */
export interface CityExportPayload {
  fileName: string;
  cityName: string;
  cityBytes: Uint8Array;
}

/**
 * Authoritative Runtime default-host configuration for the primary playable route.
 * Mirrors startup/runtime option intent in `ref/micropolis/src/sim/w_sim.c`,
 * where one command surface can be wired to different runtime conditions.
 * Parity note: this is a direct TypeScript alias of `DemoMapHost` options.
 */
export type PlayableRuntimeHostOptions = DemoMapHostOptions;

/**
 * Build the default Authoritative Runtime playable route host.
 * Mirrors single command-surface ownership in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this still uses `DemoMapHost` as the authority adapter, but now
 * exposes options so default-path wiring and tests share one Authoritative Runtime factory.
 */
export function createPlayableRuntimeHost(options: PlayableRuntimeHostOptions = {}): CoreHost {
  return new DemoMapHost(options);
}

/**
 * Read Authoritative Runtime `save-city` browser export bytes from a patch payload.
 * Mirrors `SaveCityAs` export delivery in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this keeps Playable Runtime parser behavior 1:1 while removing direct
 * route dependence on legacy `Demo*` parser naming.
 */
export function readCityExportPayload(payload: unknown): CityExportPayload | null {
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

  const candidate = save as Partial<CityExportPayload>;
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
