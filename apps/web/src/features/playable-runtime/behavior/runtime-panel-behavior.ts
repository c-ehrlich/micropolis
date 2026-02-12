import {
  type PlayableDisasterChoiceId,
  triggerPlayableRuntimeDisaster,
} from '../../../game/runtime/playable-runtime-host.ts';
import type { CoreHost } from '../../../game/runtime/protocol.ts';
import type { WebRuntimeState } from '../../../game/runtime/reducer.ts';

/**
 * Triggers one playable-route manual disaster control click and returns status text.
 * Mirrors Disasters menu entrypoint ownership in `ref/micropolis/res/whead.tcl`,
 * with runtime disaster handling in `ref/micropolis/src/sim/s_disast.c` and
 * `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: this keeps route `/` disaster controls host-agnostic by delegating
 * to the structural host capability adapter instead of concrete host classes.
 */
export function triggerRouteDisasterControl(
  host: CoreHost,
  disasterId: PlayableDisasterChoiceId,
  disasterLabel: string,
): string {
  if (triggerPlayableRuntimeDisaster(host, disasterId)) {
    return `${disasterLabel}.`;
  }

  return 'Disaster trigger is unavailable on this host.';
}

/**
 * Normalizes Save dialog file-name input to one classic `.cty` target.
 * Mirrors `SaveCityAs` naming flow in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: browser UI keeps user-entered names but appends `.cty`
 * when no extension is provided.
 */
export function normalizeCitySaveFileName(fileNameInput: string): string {
  const trimmedName = fileNameInput.trim();
  if (trimmedName === '') {
    return 'newcity.cty';
  }
  if (trimmedName.toLowerCase().endsWith('.cty')) {
    return trimmedName;
  }
  return `${trimmedName}.cty`;
}

/**
 * Triggers a browser download for exported `.cty` payload bytes.
 * Mirrors `SaveCityAs` user-selected output intent in `ref/micropolis/src/sim/s_fileio.c`.
 */
export function downloadCityBytes(fileName: string, cityBytes: Uint8Array): void {
  const blobBytes = new Uint8Array(cityBytes.byteLength);
  blobBytes.set(cityBytes);
  const blob = new Blob([blobBytes.buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';

  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Deterministically builds command ids for runtime command sends.
 * Mirrors `commandId`-based host correlation requirements from Stage plans.
 */
export function nextCommandId(counter: { current: number }, prefix: string): string {
  const nextValue = counter.current;
  counter.current = nextValue + 1;
  return `${prefix}-${nextValue}`;
}

/**
 * Runtime phase status text shown above Authoritative Runtime reconnect/resync controls.
 * Mirrors reconnect/resync lifecycle intent from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
export function formatRuntimePhaseStatus(phase: WebRuntimeState['phase']): string {
  if (phase === 'reconnecting') {
    return 'Reconnecting to host...';
  }
  if (phase === 'resyncing') {
    return 'Resyncing authoritative snapshot...';
  }
  if (phase === 'negotiating') {
    return 'Negotiating hello handshake...';
  }
  if (phase === 'connecting') {
    return 'Connecting to host...';
  }
  if (phase === 'failed') {
    return 'Connection failed. Reconnect to retry.';
  }
  if (phase === 'disconnected') {
    return 'Disconnected.';
  }
  return 'Connected.';
}
