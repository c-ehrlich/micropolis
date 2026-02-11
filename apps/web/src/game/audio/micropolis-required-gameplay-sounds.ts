/**
 * Normalized gameplay sound token stems that must resolve to browser
 * `/sounds/*.wav` assets for current authoritative runtime parity.
 * Mirrors currently reachable C gameplay sound pathways routed through
 * `MakeSound` / `MakeSoundOn` in:
 * - `ref/micropolis/src/sim/w_tool.c` (tool success/reject)
 * - `ref/micropolis/src/sim/s_msg.c` (first-display message sounds)
 * - `ref/micropolis/src/sim/w_sprite.c` (realtime sprite sounds)
 * Difference: this list stores Sugar-style normalized token stems (`first token`
 * + lowercase) used for `<token>.wav` lookup in
 * `ref/micropolis/micropolisactivity.py`.
 */
export const REQUIRED_GAMEPLAY_SOUND_TOKENS = [
  'a',
  'e',
  'explosion-high',
  'explosion-low',
  'heavytraffic',
  'honkhonk-high',
  'honkhonk-low',
  'honkhonk-med',
  'monster',
  'o',
  'rumble',
  'siren',
  'sorry',
  'uhuh',
] as const;
