import { type HostEnvelope, isSequencedHostEnvelope } from '../runtime/protocol.ts';
import type { WebRuntimeReducerOutcome } from '../runtime/reducer.ts';
import type { MicropolisGameplayAudioConsumer } from './micropolis-gameplay-audio-consumer.ts';
import type { MicropolisGameplaySoundPlaybackPolicy } from './micropolis-gameplay-sound-playback-policy.ts';

/**
 * Inputs for routing one runtime envelope's authoritative gameplay sound data.
 * Mirrors Micropolis `MakeSound` / `MakeSoundOn` ownership in
 * `ref/micropolis/src/sim/w_sound.c`, with bridge sequencing from
 * `ref/micropolis/src/sim/w_update.c`.
 * Difference: browser playback policy is explicit and injected rather than being
 * hardwired to Tcl/UI state.
 */
export interface RouteMicropolisGameplaySoundDeltasContext {
  envelope: HostEnvelope;
  reducerOutcome: WebRuntimeReducerOutcome;
  userSoundOn: boolean;
  gameplayAudioConsumer: MicropolisGameplayAudioConsumer;
  gameplaySoundPlaybackPolicy: MicropolisGameplaySoundPlaybackPolicy;
}

/**
 * Routes authoritative gameplay sound playback for one runtime envelope.
 * Mirrors C sound dispatch boundaries (`w_sound.c`) by consuming only emitted
 * sound intents, not UI-side reject/message heuristics.
 * Difference: this helper never infers sound from `reject.reason` or
 * `patch.payload.messageDeltas`; it only plays `soundDeltas`.
 */
export function routeMicropolisGameplaySoundDeltas(
  context: RouteMicropolisGameplaySoundDeltasContext,
): void {
  const runtimeEnvelope = context.envelope;
  if (!isSequencedHostEnvelope(runtimeEnvelope)) {
    return;
  }

  const shouldAttemptEnvelopePlayback = context.reducerOutcome === 'applied';
  const shouldPlaySoundDeltas = context.gameplaySoundPlaybackPolicy({
    defaultShouldAttemptPlayback: shouldAttemptEnvelopePlayback,
    reducerOutcome: context.reducerOutcome,
    userSoundOn: context.userSoundOn,
    envelopeKind: runtimeEnvelope.kind,
  });
  if (!shouldPlaySoundDeltas) {
    return;
  }

  for (const soundDelta of runtimeEnvelope.soundDeltas ?? []) {
    void context.gameplayAudioConsumer.playSoundSpec(soundDelta.soundSpec).catch(() => undefined);
  }
}
