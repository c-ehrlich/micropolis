import type { HelpDocCatalog } from './help-docs.ts';
import type { SoundTokenEntry } from './sounds.ts';
import type { SpriteManifestEntry } from './sprites.ts';
import type { StringTable } from './string-table.ts';
import type { BitmapReference } from './ui-bitmaps.ts';

/**
 * Aggregated metadata view across Micropolis resource domains.
 * Combines assets loaded from C/Tcl surfaces in `ref/micropolis/src/sim/*.c`,
 * `ref/micropolis/res/*.tcl`, and `ref/micropolis/micropolisactivity.py`
 * (TypeScript-only convenience shape; not a direct 1:1 C struct).
 */
export interface SimAssetsCatalog {
  readonly stringTables: readonly StringTable[];
  readonly sprites: readonly SpriteManifestEntry[];
  readonly bitmapReferences: readonly BitmapReference[];
  readonly sounds: readonly SoundTokenEntry[];
  readonly help: HelpDocCatalog;
}

/**
 * Inputs used to build a stable immutable `SimAssetsCatalog`.
 * Mirrors the same Micropolis source families as `SimAssetsCatalog`
 * (TypeScript-specific constructor input to centralize catalog assembly).
 */
export type SimAssetsCatalogInput = SimAssetsCatalog;

/**
 * Build an immutable catalog object for downstream consumers.
 * This is a packaging helper around Micropolis-derived metadata from
 * `ref/micropolis/src/sim`, `ref/micropolis/res`, and `micropolisactivity.py`
 * (TypeScript addition; no direct C analogue).
 */
export function createSimAssetsCatalog(input: SimAssetsCatalogInput): SimAssetsCatalog {
  return Object.freeze({
    stringTables: Object.freeze([...input.stringTables]),
    sprites: Object.freeze([...input.sprites]),
    bitmapReferences: Object.freeze([...input.bitmapReferences]),
    sounds: Object.freeze([...input.sounds]),
    help: Object.freeze({
      entries: Object.freeze([...input.help.entries]),
      missing: Object.freeze([...input.help.missing]),
      extra: Object.freeze([...input.help.extra]),
    }),
  });
}
