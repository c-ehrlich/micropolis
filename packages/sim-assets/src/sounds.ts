/**
 * Stable mapping between normalized sound token and wav asset filename.
 * Mirrors token-to-file behavior in `ref/micropolis/micropolisactivity.py`
 * (same normalized key concept represented in TypeScript).
 */
export interface SoundTokenEntry {
  readonly token: string;
  readonly fileName: string;
}

/**
 * Sound tokens explicitly called out by parity tests in this package plan.
 * Mirrors C/Tcl/Sugar call-site names from `ref/micropolis/src/sim` and
 * `ref/micropolis/micropolisactivity.py` (same token spellings captured for validation).
 */
export const REQUIRED_SOUND_TOKENS = [
  'Explosion-High',
  'Monster -speed ...',
  'HonkHonk-*',
  'Siren',
  'Sorry',
  'UhUh',
] as const;

/**
 * Normalize a Micropolis sound token using Sugar's first-token lowercase rule.
 * Mirrors normalization in `ref/micropolis/micropolisactivity.py`
 * (1:1 first-token-lowercasing behavior, including whitespace trimming).
 */
export function normalizeSoundToken(token: string): string {
  const firstToken = token.trim().split(/\s+/, 1)[0] ?? '';
  return firstToken.toLowerCase();
}
