import type { PlayableDisasterChoiceId } from './playable-disaster-choices.ts';
import type { PlayableRuntimeHostOptions } from './playable-runtime-host-options.ts';
import {
  PLAYABLE_SCENARIO_CHOICES as RUNTIME_PLAYABLE_SCENARIO_CHOICES,
  type PlayableScenarioChoice as RuntimePlayableScenarioChoice,
} from './playable-scenario-choices.ts';
import type { CoreHost } from './protocol.ts';
import { SimCoreEnvelopeHost } from './sim-core-envelope-host.ts';

export {
  PLAYABLE_DISASTER_CHOICES,
  type PlayableDisasterChoiceId,
} from './playable-disaster-choices.ts';
export type { PlayableRuntimeHostOptions } from './playable-runtime-host-options.ts';

/**
 * Authoritative Runtime scenario choice metadata used by the default playable route.
 * Mirrors `LoadScenario` table rows in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this is a naming/ownership alias over canonical runtime scenario metadata.
 */
export type PlayableScenarioChoice = RuntimePlayableScenarioChoice;

/**
 * Scenario choices for the primary Authoritative Runtime gameplay route.
 * Mirrors `LoadScenario` metadata surfaced from `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this keeps route imports off legacy Playable Runtime naming without changing behavior.
 */
export const PLAYABLE_SCENARIO_CHOICES: readonly PlayableScenarioChoice[] =
  RUNTIME_PLAYABLE_SCENARIO_CHOICES;

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
 * Validates `.cty` byte buffers from runtime patch payloads.
 * Mirrors `SaveCityAs` byte-array ownership in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: accepts both same-realm and cross-realm `Uint8Array` objects,
 * while continuing to reject non-`Uint8Array` typed arrays.
 */
function isCityExportByteArray(value: unknown): value is Uint8Array {
  if (value instanceof Uint8Array) {
    return true;
  }

  if (value === null || typeof value !== 'object' || !ArrayBuffer.isView(value)) {
    return false;
  }

  return Object.prototype.toString.call(value) === '[object Uint8Array]';
}

/**
 * Build the default Authoritative Runtime playable route host.
 * Mirrors single command-surface ownership in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this returns `SimCoreEnvelopeHost` as the authoritative host;
 * only scenario resource loading override wiring remains configurable.
 */
export function createPlayableRuntimeHost(options: PlayableRuntimeHostOptions = {}): CoreHost {
  return new SimCoreEnvelopeHost(options);
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
    !isCityExportByteArray(candidate.cityBytes)
  ) {
    return null;
  }

  return {
    fileName: candidate.fileName,
    cityName: candidate.cityName,
    cityBytes: candidate.cityBytes,
  };
}
