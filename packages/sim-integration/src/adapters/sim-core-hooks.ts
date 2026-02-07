import type { IntegrationRuntimeHooks } from '../runtime.ts';

const DEFAULT_SOUND_CHANNEL = 'city';

/**
 * Sim-core-style realtime sound callbacks consumed by integration adapters.
 * Mirrors the sound hook shape used by `@city/sim-core` realtime wiring and
 * traces back to Micropolis `MakeSound(channel, id)` dispatch in
 * `ref/micropolis/src/sim/w_sound.c` and Tcl `EchoPlaySound` bridging in
 * `ref/micropolis/res/micropolis.tcl`.
 */
export interface SimCoreRealtimeSoundHooks {
  onSound?: (channel: string, id: string) => void;
}

/**
 * Optional configuration for the sim-core sound hook adapter.
 * Mirrors Micropolis city-scope sound usage where many simulation paths call
 * `MakeSound("city", ...)` (`ref/micropolis/src/sim/s_msg.c`,
 * `ref/micropolis/src/sim/w_sprite.c`), while allowing an intentional
 * TypeScript override for composition-time channel routing.
 */
export interface SimCoreSoundHookAdapterOptions {
  channel?: string;
}

/**
 * Default sound channel used when adapting `PlaySound` tokens to sim-core hooks.
 * Mirrors common Micropolis simulation-side channel usage
 * (`MakeSound("city", ...)`) in `ref/micropolis/src/sim/s_msg.c` and
 * `ref/micropolis/src/sim/w_sprite.c`.
 */
export const DEFAULT_SIM_CORE_SOUND_CHANNEL = DEFAULT_SOUND_CHANNEL;

/**
 * Adapter from sim-core-style sound hooks to integration runtime sound tokens.
 * Source mapping:
 * - Micropolis emits `PlaySound <token>` from Tcl (`EchoPlaySound`) in
 *   `ref/micropolis/res/micropolis.tcl`.
 * - Sugar process bridge consumes this in `_stdout_thread_function` and calls
 *   `play_sound(words[1])` in `ref/micropolis/micropolisactivity.py`.
 * - Simulation-side sound intent originates from `MakeSound(channel, id)` in
 *   `ref/micropolis/src/sim/w_sound.c`.
 * Parity note: this is intentionally not a 1:1 C port; it is a TypeScript
 * composition adapter that forwards integration `onSoundToken` values into the
 * sim-core callback shape (`onSound(channel, id)`).
 */
export function createSimCoreSoundHookAdapter(
  hooks: SimCoreRealtimeSoundHooks,
  options: SimCoreSoundHookAdapterOptions = {},
): Pick<IntegrationRuntimeHooks, 'onSoundToken'> {
  const channel = options.channel ?? DEFAULT_SOUND_CHANNEL;

  return {
    onSoundToken(soundName) {
      hooks.onSound?.(channel, soundName);
    },
  };
}
