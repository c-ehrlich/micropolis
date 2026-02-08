import {
  type CanonicalImageIdentityKey,
  getDerivedImagePathManifestEntry,
  toCanonicalImageIdentityKey,
} from './derived-images.ts';
import { formatHelpHtmlFileName } from './help-docs.ts';
import { LEGACY_RESOURCE_TYPE_STRI } from './legacy.ts';
import { normalizeSoundToken } from './sounds.ts';

const SIM_UI_TOOL_ICON_PREFIX = 'ic';
const SIM_UI_TOOL_ICON_HIGHLIGHT_SUFFIX = 'hi';

interface SimUiToolPaletteSourceEntry {
  readonly iconImageName: string;
  readonly soundToken: string;
  readonly helpDocId: string;
}

const SIM_UI_TOOL_PALETTE_SOURCE: readonly SimUiToolPaletteSourceEntry[] = [
  { iconImageName: 'res', soundToken: 'Res', helpDocId: 'Editor.ToolRes' },
  { iconImageName: 'com', soundToken: 'Com', helpDocId: 'Editor.ToolCom' },
  { iconImageName: 'ind', soundToken: 'Ind', helpDocId: 'Editor.ToolInd' },
  { iconImageName: 'fire', soundToken: 'Fire', helpDocId: 'Editor.ToolFire' },
  { iconImageName: 'qry', soundToken: 'Query', helpDocId: 'Editor.ToolQuery' },
  { iconImageName: 'pol', soundToken: 'Police', helpDocId: 'Editor.ToolPolice' },
  { iconImageName: 'wire', soundToken: 'Wire', helpDocId: 'Editor.ToolWire' },
  { iconImageName: 'dozr', soundToken: 'Bulldozer', helpDocId: 'Editor.ToolBulldozer' },
  { iconImageName: 'rail', soundToken: 'Rail', helpDocId: 'Editor.ToolRail' },
  { iconImageName: 'road', soundToken: 'Road', helpDocId: 'Editor.ToolRoad' },
  { iconImageName: 'chlk', soundToken: 'Chalk', helpDocId: 'Editor.ToolChalk' },
  { iconImageName: 'ersr', soundToken: 'Eraser', helpDocId: 'Editor.ToolEraser' },
  { iconImageName: 'stad', soundToken: 'Stadium', helpDocId: 'Editor.ToolStadium' },
  { iconImageName: 'park', soundToken: 'Park', helpDocId: 'Editor.ToolPark' },
  { iconImageName: 'seap', soundToken: 'Seaport', helpDocId: 'Editor.ToolSeaport' },
  { iconImageName: 'coal', soundToken: 'Coal', helpDocId: 'Editor.ToolCoal' },
  { iconImageName: 'nuc', soundToken: 'Nuclear', helpDocId: 'Editor.ToolNuclear' },
  { iconImageName: 'airp', soundToken: 'Airport', helpDocId: 'Editor.ToolAirport' },
] as const;

/**
 * Canonical `stri` table id for editor tool labels.
 * Source mapping: `ref/micropolis/res/stri.356`.
 * Parity notes: this table contains one-based tool label rows for tool states
 * `0..17`; `networkState` (`18` in `ref/micropolis/src/sim/headers/sim.h`) is
 * intentionally not part of the visible editor icon palette.
 */
export const SIM_UI_TOOL_STRING_TABLE_ID = 356 as const;

/**
 * Count of tool icons available in the editor palette.
 * Mirrors 18 entries in `EditorPalletImages` / `EditorPalletSounds` from
 * `ref/micropolis/res/micropolis.tcl` (1:1 count and ordering).
 */
export const SIM_UI_TOOL_COUNT = SIM_UI_TOOL_PALETTE_SOURCE.length;

/**
 * `GetResource("stri", id)` reference for a one-based string lookup.
 * Mirrors resource identity in `ref/micropolis/src/sim/w_resrc.c`, with the
 * one-based row index convention used by Micropolis string tables.
 */
export interface SimUiStringResourceReference {
  readonly type: typeof LEGACY_RESOURCE_TYPE_STRI;
  readonly id: typeof SIM_UI_TOOL_STRING_TABLE_ID;
  readonly oneBasedIndex: number;
}

/**
 * Aggregated asset helper row for one editor palette tool state.
 * Source mapping:
 * - icon/sound order: `EditorPalletImages` / `EditorPalletSounds` in
 *   `ref/micropolis/res/micropolis.tcl`
 * - help ids: `Help Editor.Tool*` declarations in `ref/micropolis/res/help.tcl`
 * - sound normalization: `play_sound(name.lower() + ".wav")` in
 *   `ref/micropolis/micropolisactivity.py`.
 * Parity notes: this is a typed projection of Tcl/Python metadata; it keeps
 * the same ordering and names while surfacing resolved bitmap/sound/html names.
 */
export interface SimUiToolAssetHelper {
  readonly toolState: number;
  readonly iconBitmapName: string;
  readonly highlightedIconBitmapName: string;
  readonly stringResource: SimUiStringResourceReference;
  readonly soundToken: string;
  readonly normalizedSoundToken: string;
  readonly soundFileName: string;
  readonly helpDocId: string;
  readonly helpHtmlFileName: string;
}

/**
 * Resolved image-key metadata for one editor tool icon bitmap.
 * Source mapping: icon names come from `EditorPalletImages` and are loaded as
 * `@images/ic${name}.xpm` / `@images/ic${name}hi.xpm` by `ExclusivePallet` in
 * `ref/micropolis/res/micropolis.tcl`.
 * Parity notes: canonical `.xpm` identity is always returned (C/Tcl parity);
 * derived PNG path is an optional TypeScript-only overlay.
 */
export interface SimUiToolIconAssetLookup {
  readonly toolState: number;
  readonly highlighted: boolean;
  readonly iconBitmapName: string;
  readonly canonicalAssetKey: CanonicalImageIdentityKey;
  readonly derivedPngPath?: string;
}

/**
 * Optional lookup configuration for tool icon asset resolution.
 * Mirrors Micropolis icon identity from `micropolis.tcl` while allowing
 * TypeScript callers to opt into/out of derived PNG overlay metadata.
 */
export interface SimUiToolIconAssetLookupOptions {
  readonly highlighted?: boolean;
  readonly includeDerivedPngPathLookup?: boolean;
}

const SIM_UI_TOOL_ASSET_HELPERS: readonly SimUiToolAssetHelper[] = Object.freeze(
  SIM_UI_TOOL_PALETTE_SOURCE.map((entry, toolState) => {
    const normalizedSoundToken = normalizeSoundToken(entry.soundToken);
    const helper: SimUiToolAssetHelper = {
      toolState,
      iconBitmapName: `${SIM_UI_TOOL_ICON_PREFIX}${entry.iconImageName}`,
      highlightedIconBitmapName: `${SIM_UI_TOOL_ICON_PREFIX}${entry.iconImageName}${SIM_UI_TOOL_ICON_HIGHLIGHT_SUFFIX}`,
      stringResource: {
        type: LEGACY_RESOURCE_TYPE_STRI,
        id: SIM_UI_TOOL_STRING_TABLE_ID,
        oneBasedIndex: toolState + 1,
      },
      soundToken: entry.soundToken,
      normalizedSoundToken,
      soundFileName: `${normalizedSoundToken}.wav`,
      helpDocId: entry.helpDocId,
      helpHtmlFileName: formatHelpHtmlFileName(entry.helpDocId),
    };

    return Object.freeze(helper);
  }),
);

/**
 * Return the canonical editor tool helper rows in palette order.
 * Mirrors `EditorPalletImages` / `EditorPalletSounds` ordering in
 * `ref/micropolis/res/micropolis.tcl` (1:1 row order, TypeScript typed metadata).
 */
export function listSimUiToolAssetHelpers(): readonly SimUiToolAssetHelper[] {
  return SIM_UI_TOOL_ASSET_HELPERS;
}

/**
 * Resolve one editor tool helper row by numeric tool state.
 * Mirrors tool-state indexing from `ref/micropolis/src/sim/headers/sim.h`
 * and editor palette selection in `ref/micropolis/res/micropolis.tcl`.
 * Parity notes: returns `undefined` for out-of-range states, including
 * `networkState` (`18`) which has no icon-palette entry in Tcl.
 */
export function resolveSimUiToolAssetHelper(toolState: number): SimUiToolAssetHelper | undefined {
  if (!Number.isInteger(toolState) || toolState < 0 || toolState >= SIM_UI_TOOL_COUNT) {
    return undefined;
  }

  return SIM_UI_TOOL_ASSET_HELPERS[toolState];
}

/**
 * Resolve the canonical tool icon bitmap basename for a tool state.
 * Mirrors `ExclusivePallet ... ic $EditorPalletImages` bitmap naming in
 * `ref/micropolis/res/micropolis.tcl`, which toggles `${name}` vs `${name}hi`.
 */
export function resolveSimUiToolIconBitmapName(
  toolState: number,
  highlighted = false,
): string | undefined {
  const helper = resolveSimUiToolAssetHelper(toolState);
  if (helper === undefined) {
    return undefined;
  }

  return highlighted ? helper.highlightedIconBitmapName : helper.iconBitmapName;
}

/**
 * Resolve canonical image identity for a tool icon with optional PNG overlay.
 * Source mapping:
 * - icon naming: `ExclusivePallet ... ic $EditorPalletImages` in
 *   `ref/micropolis/res/micropolis.tcl`
 * - canonical image identity: `@images/*.xpm` lookups in Micropolis Tcl/C
 *   (`micropolis.tcl`, `ref/micropolis/src/sim/g_setup.c`).
 * Parity notes: C/Tcl uses canonical XPM identity only; this helper keeps that
 * canonical key and optionally attaches a derived PNG path for TypeScript
 * runtime ergonomics.
 */
export function resolveSimUiToolIconAssetLookup(
  toolState: number,
  options: SimUiToolIconAssetLookupOptions = {},
): SimUiToolIconAssetLookup | undefined {
  const highlighted = options.highlighted ?? false;
  const includeDerivedPngPathLookup = options.includeDerivedPngPathLookup ?? true;
  const iconBitmapName = resolveSimUiToolIconBitmapName(toolState, highlighted);
  if (iconBitmapName === undefined) {
    return undefined;
  }

  const canonicalAssetKey = toCanonicalImageIdentityKey(
    `ref/micropolis/images/${iconBitmapName}.xpm`,
  );
  const lookup: SimUiToolIconAssetLookup = {
    toolState,
    highlighted,
    iconBitmapName,
    canonicalAssetKey,
  };

  if (!includeDerivedPngPathLookup) {
    return lookup;
  }

  const derivedPngPath = getDerivedImagePathManifestEntry(canonicalAssetKey)?.derivedPngPath;
  if (derivedPngPath === undefined) {
    return lookup;
  }

  return {
    ...lookup,
    derivedPngPath,
  };
}

/**
 * Resolve the `stri` string resource reference for a tool state label.
 * Source mapping: tool labels from `ref/micropolis/res/stri.356` and
 * one-based table access semantics from `GetResource("stri", id)` users in
 * `ref/micropolis/src/sim/w_resrc.c`.
 */
export function resolveSimUiToolStringResource(
  toolState: number,
): SimUiStringResourceReference | undefined {
  return resolveSimUiToolAssetHelper(toolState)?.stringResource;
}

/**
 * Resolve the editor-palette sound token for a tool state.
 * Mirrors `EditorPalletSounds` in `ref/micropolis/res/micropolis.tcl`.
 */
export function resolveSimUiToolSoundToken(toolState: number): string | undefined {
  return resolveSimUiToolAssetHelper(toolState)?.soundToken;
}

/**
 * Resolve the normalized sound token key (`lower(first token)`) for a tool.
 * Mirrors token normalization in `play_sound` integration flow from
 * `ref/micropolis/micropolisactivity.py`.
 */
export function resolveSimUiToolNormalizedSoundToken(toolState: number): string | undefined {
  return resolveSimUiToolAssetHelper(toolState)?.normalizedSoundToken;
}

/**
 * Resolve the expected `.wav` file basename for a tool-state sound token.
 * Mirrors `name.lower() + ".wav"` lookup in `ref/micropolis/micropolisactivity.py`.
 */
export function resolveSimUiToolSoundFileName(toolState: number): string | undefined {
  return resolveSimUiToolAssetHelper(toolState)?.soundFileName;
}

/**
 * Resolve the help id for a tool icon.
 * Mirrors `Help Editor.Tool* ...` declarations in `ref/micropolis/res/help.tcl`
 * for each tool icon shown in the editor palette.
 */
export function resolveSimUiToolHelpDocId(toolState: number): string | undefined {
  return resolveSimUiToolAssetHelper(toolState)?.helpDocId;
}

/**
 * Resolve the manual HTML filename expected for a tool help id.
 * Mirrors help-id to `<id>.html` conversion used by `FormatHTML`-style lookups
 * in `ref/micropolis/res/micropolis.tcl`.
 */
export function resolveSimUiToolHelpHtmlFileName(toolState: number): string | undefined {
  return resolveSimUiToolAssetHelper(toolState)?.helpHtmlFileName;
}
