import {
  DemoMapHost,
  PLAYABLE_SCENARIO_CHOICES as DEMO_PLAYABLE_SCENARIO_CHOICES,
  type PlayableScenarioChoice as DemoPlayableScenarioChoice,
} from './demo-map-host.ts';
import type { PlayableRuntimeHostOptions } from './playable-runtime-host-options.ts';
import type { CoreHost } from './protocol.ts';

export type { PlayableRuntimeHostOptions } from './playable-runtime-host-options.ts';

/**
 * Manual disaster button definitions for the playable route UI.
 * Mirrors Disasters menu entries in `ref/micropolis/res/whead.tcl`.
 * Parity note: this keeps the existing playable UI contract stable
 * (ids, labels, and order) while decoupling from `DemoMapHost`.
 */
export const PLAYABLE_DISASTER_CHOICES = [
  {
    id: 'tornado',
    label: 'Trigger Tornado',
  },
  {
    id: 'monster',
    label: 'Trigger Monster',
  },
  {
    id: 'fire',
    label: 'Trigger Fire',
  },
  {
    id: 'flood',
    label: 'Trigger Flood',
  },
  {
    id: 'meltdown',
    label: 'Trigger Meltdown',
  },
  {
    id: 'earthquake',
    label: 'Trigger Earthquake',
  },
] as const;

/**
 * Manual disaster id union for playable route UI controls.
 * Mirrors disaster command identities in `ref/micropolis/src/sim/s_disast.c`
 * and `ref/micropolis/src/sim/w_sprite.c`.
 */
export type PlayableDisasterChoiceId = (typeof PLAYABLE_DISASTER_CHOICES)[number]['id'];

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
 * Build the default Authoritative Runtime playable route host.
 * Mirrors single command-surface ownership in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this still uses `DemoMapHost` as the authority adapter, but now
 * exposes options so default-path wiring and tests share one Authoritative Runtime factory.
 */
export function createPlayableRuntimeHost(options: PlayableRuntimeHostOptions = {}): CoreHost {
  return new DemoMapHost(options);
}

/**
 * Host capability adapter for manual disaster triggers in playable route UI flows.
 * Mirrors Disasters menu entrypoint ownership in `ref/micropolis/res/whead.tcl`
 * with host-level runtime handlers in `ref/micropolis/src/sim/s_disast.c`
 * and `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: this is a structural TypeScript adapter; it preserves C-level
 * disaster ids while decoupling route helpers from concrete host classes.
 */
export interface PlayableRuntimeDisasterHostCapability {
  triggerManualRealtimeEvent(disasterId: PlayableDisasterChoiceId): boolean;
}

/**
 * Resolves manual-disaster host capability from a runtime host instance.
 * Mirrors Disasters menu entry intent in `ref/micropolis/res/whead.tcl`.
 * Difference: this is a structural adapter check, not class-instance coupling.
 */
export function asPlayableRuntimeDisasterHostCapability(
  host: CoreHost,
): PlayableRuntimeDisasterHostCapability | null {
  const candidate = host as Partial<PlayableRuntimeDisasterHostCapability>;
  if (typeof candidate.triggerManualRealtimeEvent !== 'function') {
    return null;
  }

  return candidate as PlayableRuntimeDisasterHostCapability;
}

/**
 * Triggers one manual disaster event on hosts that expose manual-disaster capability.
 * Mirrors Disasters menu entry intent in `ref/micropolis/res/whead.tcl`.
 * Difference: this helper is host-capability based and returns `false` for hosts
 * that do not expose manual-disaster entrypoints.
 */
export function triggerPlayableRuntimeDisaster(
  host: CoreHost,
  disasterId: PlayableDisasterChoiceId,
): boolean {
  const disasterHost = asPlayableRuntimeDisasterHostCapability(host);
  if (disasterHost === null) {
    return false;
  }

  return disasterHost.triggerManualRealtimeEvent(disasterId);
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
