/**
 * Manual disaster button definitions for the playable route UI.
 * Mirrors Disasters menu entries in `ref/micropolis/res/whead.tcl`.
 * Parity note: this keeps the existing playable UI contract stable
 * (ids, labels, and order) unless parity requires a contract change.
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
