import { ASSETS_MANIFEST } from './generated/assets-manifest.ts';

const HELP_TCL_HELP_ID_REGEX = /^\s*Help\s+([^\s{]+)\s+\{/;

/**
 * Deterministic ASCII comparator for help/manual identifier sorting.
 * TypeScript-only utility used to stabilize metadata output ordering;
 * there is no direct C/Tcl analogue in `ref/micropolis`.
 */
const compareAscii = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

/**
 * De-duplicate IDs while preserving first-seen order.
 * Mirrors logical identity de-duplication of `Help` ids from
 * `ref/micropolis/res/help.tcl` (TypeScript adds explicit set semantics).
 */
const uniqueInInsertionOrder = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const uniqueValues: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    uniqueValues.push(value);
  }

  return uniqueValues;
};

/**
 * Single help-page mapping between `Help <id>` and manual HTML file presence.
 * Mirrors `Help` command ids in `ref/micropolis/res/help.tcl` and files under
 * `ref/micropolis/manual` (same id/file concept represented as typed metadata).
 */
export interface HelpDocEntry {
  readonly helpId: string;
  readonly htmlFileName: string;
  readonly exists: boolean;
}

/**
 * Summary sets for help-document parity analysis.
 * Mirrors `Help` id references in `ref/micropolis/res/help.tcl`
 * and available manual files in `ref/micropolis/manual` (TypeScript adds explicit sets).
 */
export interface HelpDocCatalog {
  readonly entries: readonly HelpDocEntry[];
  readonly missing: readonly string[];
  readonly extra: readonly string[];
}

/**
 * Deterministic inventory sets for help IDs and manual HTML IDs.
 * Mirrors `Help <id>` declarations in `ref/micropolis/res/help.tcl` and
 * `<id>.html` files loaded via `FormatHTML $ResourceDir/doc/$id.html` in
 * `ref/micropolis/res/micropolis.tcl`.
 * Parity notes: C/Tcl implicitly uses these sets via runtime lookup/open calls;
 * this TypeScript port makes both sets and their diffs explicit metadata.
 */
export interface HelpDocInventory {
  readonly helpIds: readonly string[];
  readonly manualHtmlIds: readonly string[];
  readonly missing: readonly string[];
  readonly extra: readonly string[];
}

/**
 * Convert a Micropolis help id to its expected manual HTML filename.
 * Mirrors `FormatHTML`-style help-id to path behavior in `ref/micropolis/res/help.tcl`
 * (same `<id>.html` mapping represented as a pure helper).
 */
export function formatHelpHtmlFileName(helpId: string): string {
  return `${helpId}.html`;
}

/**
 * Extract unique `Help <id>` values from `help.tcl` source text.
 * Mirrors the `Help` command registration surface in `ref/micropolis/res/help.tcl`
 * and `proc Help` message storage in `ref/micropolis/res/micropolis.tcl`.
 * Parity notes: duplicate IDs in Tcl are last-write in runtime message tables;
 * this inventory keeps the first-seen unique list for stable catalog identity.
 */
export function buildHelpDocHelpIds(helpTclSource: string): readonly string[] {
  const helpIds: string[] = [];
  const lines = helpTclSource.split('\n');

  for (const line of lines) {
    const match = HELP_TCL_HELP_ID_REGEX.exec(line);
    if (match === null) {
      continue;
    }

    const helpId = match[1];
    if (helpId === undefined) {
      throw new Error(`Unable to extract Help id from line: ${line}`);
    }
    helpIds.push(helpId);
  }

  return uniqueInInsertionOrder(helpIds);
}

/**
 * Build deterministic manual HTML IDs from canonical `manual/` file paths.
 * Mirrors help-page filename loading in `FormatHTML` from
 * `ref/micropolis/res/micropolis.tcl` (`$id.html` under manual/doc roots).
 * Parity notes: only top-level `.html` files are considered, matching current
 * manifest generation in `scripts/gen-assets-manifest.mjs`.
 */
export function buildManualHtmlIds(manualFilePaths: readonly string[]): readonly string[] {
  const ids = new Set<string>();

  for (const filePath of manualFilePaths) {
    if (filePath.includes('/')) {
      continue;
    }
    if (!filePath.endsWith('.html')) {
      continue;
    }
    ids.add(filePath.slice(0, -'.html'.length));
  }

  return [...ids].sort(compareAscii);
}

/**
 * Build help/manual inventory sets plus missing/extra parity diffs.
 * Mirrors Tcl runtime help lookups (`Messages($id)` and `FormatHTML .../$id.html`)
 * across `ref/micropolis/res/help.tcl` and `ref/micropolis/res/micropolis.tcl`.
 * Parity notes: missing and extra outputs are deterministic ASCII-sorted sets.
 */
export function buildHelpDocInventory(
  helpIds: readonly string[],
  manualHtmlIds: readonly string[],
): HelpDocInventory {
  const normalizedHelpIds = uniqueInInsertionOrder(helpIds);
  const normalizedManualHtmlIds = [...uniqueInInsertionOrder(manualHtmlIds)].sort(compareAscii);
  const helpIdSet = new Set(normalizedHelpIds);
  const manualHtmlIdSet = new Set(normalizedManualHtmlIds);

  const missing = [...normalizedHelpIds].filter((helpId) => !manualHtmlIdSet.has(helpId));
  const extra = [...normalizedManualHtmlIds].filter((manualId) => !helpIdSet.has(manualId));

  return {
    helpIds: normalizedHelpIds,
    manualHtmlIds: normalizedManualHtmlIds,
    missing,
    extra,
  };
}

/**
 * Build `HelpDocCatalog` rows from inventory sets.
 * Mirrors `Help <id>` to `$id.html` presence checks implied by
 * `UIShowHelpOn`/`FormatHTML` in `ref/micropolis/res/micropolis.tcl`.
 * Parity notes: entries are emitted in `help.tcl` declaration order with an
 * explicit `exists` flag (TypeScript metadata enhancement).
 */
export function createHelpDocCatalogFromInventory(inventory: HelpDocInventory): HelpDocCatalog {
  const missingSet = new Set(inventory.missing);
  const entries = inventory.helpIds.map((helpId) => ({
    helpId,
    htmlFileName: formatHelpHtmlFileName(helpId),
    exists: !missingSet.has(helpId),
  }));

  return {
    entries,
    missing: inventory.missing,
    extra: inventory.extra,
  };
}

/**
 * Build a `HelpDocCatalog` directly from help IDs and manual HTML IDs.
 * Mirrors help/manual id parity implied by `help.tcl` registrations and
 * `FormatHTML .../$id.html` loads in `ref/micropolis/res/micropolis.tcl`.
 */
export function createHelpDocCatalog(
  helpIds: readonly string[],
  manualHtmlIds: readonly string[],
): HelpDocCatalog {
  return createHelpDocCatalogFromInventory(buildHelpDocInventory(helpIds, manualHtmlIds));
}

/**
 * Build the canonical help-doc catalog from generated Micropolis asset parity data.
 * Source mapping:
 * - help IDs: `ref/micropolis/res/help.tcl`
 * - manual HTML IDs: `ref/micropolis/manual/*.html`
 * Parity notes: this is a deterministic metadata projection of canonical source
 * assets emitted by `scripts/gen-assets-manifest.mjs`.
 */
export function createCanonicalHelpDocCatalog(): HelpDocCatalog {
  return createHelpDocCatalog(ASSETS_MANIFEST.parity.helpIds, ASSETS_MANIFEST.parity.manualHtmlIds);
}
