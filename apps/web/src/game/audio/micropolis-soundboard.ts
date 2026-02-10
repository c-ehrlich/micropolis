/**
 * Manual sound-preview button spec for the Authoritative Runtime browser UI.
 * Mirrors playable sound IDs used by `UIMakeSound` and `EchoPlaySound` in
 * `ref/micropolis/res/micropolis.tcl`, surfaced here as explicit test buttons.
 */
export interface SoundPreviewSpec {
  readonly label: string;
  readonly token: string;
}

/**
 * Small curated Authoritative Runtime sound set for manual browser verification.
 * Mirrors common Micropolis sound tokens emitted through
 * `ref/micropolis/res/micropolis.tcl` and consumed by
 * `ref/micropolis/micropolisactivity.py`.
 */
export const SOUND_PREVIEW_SPECS = [
  { label: 'Bulldozer', token: 'Bulldozer' },
  { label: 'Siren', token: 'Siren' },
  { label: 'Explosion (High)', token: 'Explosion-High' },
  { label: 'Traffic Honk', token: 'HonkHonk-Low -speed 80' },
  { label: 'Monster', token: 'Monster -speed 120' },
  { label: 'No Funds', token: 'Sorry' },
  { label: 'Invalid Tool', token: 'UhUh' },
] as const satisfies readonly SoundPreviewSpec[];

/**
 * Convert one Micropolis sound token to the Sugar WAV file stem.
 * Mirrors the Tcl+Python path:
 * - `EchoPlaySound` takes the first list element (`lindex $soundspec 0`) in
 *   `ref/micropolis/res/micropolis.tcl`.
 * - `play_sound` lowercases that name before `<name>.wav` lookup in
 *   `ref/micropolis/micropolisactivity.py`.
 */
export function normalizeMicropolisSoundTokenForWav(token: string): string {
  const firstToken = token.trim().split(/\s+/, 1)[0] ?? '';
  return firstToken.toLowerCase();
}

/**
 * Build the public browser path for one Micropolis WAV preview file.
 * Mirrors Sugar runtime lookup of `res/sounds/<name>.wav` in
 * `ref/micropolis/micropolisactivity.py`, adapted to Vite `public/` serving.
 */
export function toMicropolisSoundPreviewWavPath(token: string): string {
  return `/sounds/${normalizeMicropolisSoundTokenForWav(token)}.wav`;
}
