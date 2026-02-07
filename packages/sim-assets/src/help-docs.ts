/**
 * Single help-page mapping between `Help <id>` and manual HTML file presence.
 * Mirrors `Help` command ids in `ref/micropolis/res/help.tcl` and files under
 * `ref/micropolis/res/manual` (same id/file concept represented as typed metadata).
 */
export interface HelpDocEntry {
  readonly helpId: string;
  readonly htmlFileName: string;
  readonly exists: boolean;
}

/**
 * Summary sets for help-document parity analysis.
 * Mirrors `Help` id references in `ref/micropolis/res/help.tcl`
 * and available manual files in `ref/micropolis/res/manual` (TypeScript adds explicit sets).
 */
export interface HelpDocCatalog {
  readonly entries: readonly HelpDocEntry[];
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
