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
 * Resolve one tool-command reject reason to the Micropolis sound token.
 * Mirrors `DoTool` / `ToolDown` error-sound behavior in
 * `ref/micropolis/src/sim/w_tool.c`:
 * - `-1` out-of-bounds -> `UhUh`
 * - `-2` no-funds -> `Sorry`
 * Parity note: unknown reject reasons intentionally resolve to `null`.
 */
export function resolveMicropolisSoundTokenForToolRejectReason(reason: string): string | null {
  if (reason === 'no-funds') {
    return 'Sorry';
  }
  if (reason === 'out-of-bounds' || reason === 'invalid-placement') {
    return 'UhUh';
  }
  return null;
}

/**
 * Resolve one acknowledged playable tool command to a one-shot sound token.
 * Mirrors `UIDidTool*` callbacks in `ref/micropolis/res/micropolis.tcl`.
 * Difference: browser route currently ships only a small subset of WAV assets,
 * so this helper maps only tool sounds guaranteed by `public/sounds`.
 */
export function resolveMicropolisSoundTokenForToolAck(tool: string): string | null {
  if (tool === 'bulldoze') {
    return 'Bulldozer';
  }
  return null;
}

const MESSAGE_SOUND_TOKENS: Readonly<Record<number, readonly string[]>> = Object.freeze({
  // `s_msg.c doMessage` first-time message sound switch:
  // 11/20/22/23/24/25/26/27/44 -> Siren
  11: ['Siren'],
  20: ['Siren'],
  22: ['Siren'],
  23: ['Siren'],
  24: ['Siren'],
  25: ['Siren'],
  26: ['Siren'],
  27: ['Siren'],
  44: ['Siren'],
  // `s_msg.c doMessage`: 21 -> Monster token.
  21: ['Monster -speed [MonsterSpeed]'],
  // `s_msg.c doMessage`: 12 randomly picks honk variants.
  // Difference: this route uses the available low-honk asset.
  12: ['HonkHonk-Low -speed 80'],
  // `s_msg.c doMessage`: 30 plays Explosion-Low + Siren.
  // Difference: this route currently ships Siren but not Explosion-Low.
  30: ['Siren'],
  // `s_msg.c doMessage`: 43 plays Explosion-High + Explosion-Low + Siren.
  // Difference: this route currently ships Explosion-High + Siren.
  43: ['Explosion-High', 'Siren'],
});

/**
 * Resolve `SendMes`/`SendMesAt` message ids to one or more sound tokens.
 * Mirrors first-display sound selection in `doMessage` from
 * `ref/micropolis/src/sim/s_msg.c`.
 * Parity note: ids not in the C sound switch intentionally return no tokens.
 */
export function resolveMicropolisSoundTokensForMessageId(id: number): readonly string[] {
  const normalizedId = id < 0 ? -id : id;
  return MESSAGE_SOUND_TOKENS[normalizedId] ?? [];
}

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
