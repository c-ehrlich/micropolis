import type { SequencedHostEnvelope } from '../runtime/protocol.ts';
import type { WebRuntimeReducerOutcome } from '../runtime/reducer.ts';

/**
 * Built-in gameplay sound playback policy modes for the web runtime.
 * Mirrors C `UserSoundOn` gating in `ref/micropolis/src/sim/w_sound.c`, while
 * adding an explicit bridge-side choice for reducer-outcome filtering.
 * Difference: Micropolis C has no reducer outcome concept; this mode selector
 * is a web replay/resync policy layer only.
 */
export type MicropolisGameplaySoundPlaybackMode = 'applied-only' | 'all-sequenced';

/**
 * Policy context for deciding whether one sequenced envelope's sound data should
 * be played by the browser runtime.
 * Mirrors `UserSoundOn` ownership in `ref/micropolis/src/sim/w_sound.c`.
 * Difference: includes reducer outcome metadata so replay/resync transport can
 * remain intact even when playback policy differs.
 */
export interface MicropolisGameplaySoundPlaybackPolicyContext {
  defaultShouldAttemptPlayback: boolean;
  reducerOutcome: WebRuntimeReducerOutcome;
  userSoundOn: boolean;
  envelopeKind: SequencedHostEnvelope['kind'];
}

/**
 * Runtime policy callback that decides if sequenced envelope sound deltas are
 * played for the current client context.
 * Mirrors C's sound gate (`UserSoundOn`) in `ref/micropolis/src/sim/w_sound.c`.
 * Difference: bridge runtime can layer reducer-outcome constraints for replay.
 */
export type MicropolisGameplaySoundPlaybackPolicy = (
  context: MicropolisGameplaySoundPlaybackPolicyContext,
) => boolean;

/**
 * Optional builder input for runtime gameplay sound playback policies.
 * Mirrors C `UserSoundOn` defaults from `ref/micropolis/src/sim/s_fileio.c` and
 * `ref/micropolis/src/sim/w_sound.c`.
 * Difference: policy mode is web-only and controls replay/resync playback only,
 * not envelope transport retention.
 */
export interface CreateMicropolisGameplaySoundPlaybackPolicyOptions {
  mode?: MicropolisGameplaySoundPlaybackMode;
}

/**
 * Creates one gameplay sound playback policy for sequenced envelope audio.
 * Mirrors Micropolis `UserSoundOn` gate in `ref/micropolis/src/sim/w_sound.c`.
 * Difference: `mode` allows explicit replay transport/playback separation:
 * transport keeps sound deltas on all sequenced envelopes, while playback can
 * remain `applied-only` (default) or opt into `all-sequenced`.
 */
export function createMicropolisGameplaySoundPlaybackPolicy(
  options: CreateMicropolisGameplaySoundPlaybackPolicyOptions = {},
): MicropolisGameplaySoundPlaybackPolicy {
  const mode = options.mode ?? 'applied-only';

  if (mode === 'all-sequenced') {
    return ({ userSoundOn }) => userSoundOn;
  }

  return ({ defaultShouldAttemptPlayback, userSoundOn }) => {
    return defaultShouldAttemptPlayback && userSoundOn;
  };
}
