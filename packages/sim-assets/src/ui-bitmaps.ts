/**
 * Classification for bitmap names referenced from Micropolis Tcl UI scripts.
 * Mirrors bitmap references in `ref/micropolis/res/micropolis.tcl` and `help.tcl`
 * (TypeScript adds explicit status labels for catalog consumers).
 */
export type BitmapReferenceStatus = 'required' | 'legacy' | 'missing-in-ref';

/**
 * Known Tcl bitmap names referenced but not provided in reference assets.
 * Mirrors missing image references from `ref/micropolis/res/micropolis.tcl` (1:1 names).
 */
export const KNOWN_MISSING_BITMAPS = ['micropolisl', 'splashscreen'] as const;

/**
 * Typed row for a single Tcl bitmap reference.
 * Mirrors bitmap-name lookups from `ref/micropolis/res/micropolis.tcl`
 * (same name/status concept represented as immutable metadata).
 */
export interface BitmapReference {
  readonly name: string;
  readonly status: BitmapReferenceStatus;
}

/**
 * Apply initial classification rules to a Tcl bitmap basename.
 * Mirrors reference discovery from `ref/micropolis/res/micropolis.tcl` and `help.tcl`
 * (TypeScript extension: explicit status assignment for downstream validation).
 */
export function classifyBitmapReference(name: string): BitmapReference {
  if ((KNOWN_MISSING_BITMAPS as readonly string[]).includes(name)) {
    return { name, status: 'missing-in-ref' };
  }

  return { name, status: 'required' };
}
