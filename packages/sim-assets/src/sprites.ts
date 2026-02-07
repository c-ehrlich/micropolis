/**
 * Expected per-sprite frame counts for Micropolis object sprites.
 * Mirrors the hard-coded frame range mapping from `ref/micropolis/src/sim/g_setup.c`
 * (1:1 counts keyed by sprite id).
 */
export const SPRITE_FRAME_COUNTS = {
  1: 5,
  2: 8,
  3: 11,
  4: 8,
  5: 16,
  6: 3,
  7: 6,
  8: 4,
} as const;

/**
 * Typed sprite-manifest row for a Micropolis object id.
 * Mirrors object sprite iteration in `ref/micropolis/src/sim/g_setup.c`
 * (same id/frame-count pairing represented as immutable metadata).
 */
export interface SpriteManifestEntry {
  readonly spriteId: number;
  readonly frameCount: number;
}

/**
 * Build a stable, id-sorted sprite manifest from frame-count data.
 * Mirrors the object-sprite id traversal in `ref/micropolis/src/sim/g_setup.c`
 * (same ids/counts, with deterministic sorting for TypeScript consumers).
 */
export function createSpriteManifest(
  frameCounts: Readonly<Record<number, number>> = SPRITE_FRAME_COUNTS,
): readonly SpriteManifestEntry[] {
  return Object.entries(frameCounts)
    .map(([spriteId, frameCount]) => ({
      spriteId: Number(spriteId),
      frameCount,
    }))
    .sort((left, right) => left.spriteId - right.spriteId);
}
