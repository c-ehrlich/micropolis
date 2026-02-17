import {
  ClassicyButton,
  ClassicyCheckboxField,
  ClassicyMenuItemButton,
  ClassicyMessageSurface,
  ClassicyPanelChrome,
  ClassicyPanelTitle,
  ClassicyPopoverMenu,
  ClassicyToggleGroup,
  getAllThemes,
  getThemeVars,
} from '@city/classicyui';
import { Tile, TileFlag, TileMask } from '@city/sim-core';
import { type CSSProperties, useMemo, useReducer, useState } from 'react';

import { resolveSimUiToolIconAssetLookup } from '../../../../packages/sim-assets/src/sim-ui.ts';
import { PLAYABLE_TOOL_ICON_URL_BY_BASENAME } from '../../../web/src/features/playable-runtime/presentation/runtime-panel/runtime-panel-constants.ts';
import {
  getPlayableToolSpec,
  PLAYABLE_TOOL_SPECS,
  type PlayableToolName,
} from '../../../web/src/game/runtime/protocol.ts';
import {
  MapCanvas,
  type MapCanvasHoverPreviewSpec,
  type MapCanvasTileOverlayResolver,
  type MapCanvasTileOverlayStyle,
} from '../../../web/src/presentation/map/map-canvas.tsx';
import {
  getTileAtlasSourceByCanonicalIdentityKey,
  lookupTileSpriteRectByTileId,
  resolveRuntimeTilesetBaseAtlasCanonicalIdentityKey,
} from '../../../web/src/presentation/map/tile-sprite-atlas.ts';
import {
  getScenarioEditorMapNamedBaseTiles,
  getScenarioEditorMapZoneMaxLevel,
  getScenarioEditorMapZoneMaxValue,
  readScenarioEditorMapTileWord,
  type ScenarioEditorMapSpecialZoneKind,
  type ScenarioEditorMapZoneKind,
} from '../state/editor-map.ts';
import { createScenarioEditorRuntimeMapStateWithOptions } from '../state/editor-map-runtime.ts';
import { useScenarioEditorDispatch, useScenarioEditorState } from '../state/editor-state.tsx';
import { EditorField } from './-editor-ui.tsx';

const BASE_TILE_NAME_OPTIONS = getScenarioEditorMapNamedBaseTiles();

const SCENARIO_MAP_FINAL_ZONE_FAMILY_LABELS: Readonly<Record<ScenarioEditorMapZoneKind, string>> = {
  res: 'Residential',
  com: 'Commercial',
  ind: 'Industrial',
};
const SCENARIO_MAP_FINAL_ZONE_TOOL_BY_KIND: Readonly<
  Record<ScenarioEditorMapZoneKind, PlayableToolName>
> = {
  res: 'res',
  com: 'com',
  ind: 'ind',
};

/**
 * Resolve UI label text for per-zone value classes.
 * Not from Micropolis C: editor-only wording that reflects `GetCRVal` (R/C) vs
 * `Rand16() & 1` value handling in `DoIndustrial` (`ref/micropolis/src/sim/s_zone.c`).
 */
function getScenarioMapZoneValueClassLabel(zone: ScenarioEditorMapZoneKind): string {
  if (zone === 'ind') {
    return 'Industrial Class';
  }
  return 'Land Value Class';
}

type ScenarioMapFinalActiveBrushFamily = 'zones' | 'base' | 'tools';
type ScenarioMapFinalSidebarMode = 'creator' | 'all-tiles';
type ScenarioMapFinalSmartBaseBrushId = 'dirt' | 'water' | 'channel' | 'forest';
type ScenarioMapFinalToolId = PlayableToolName | 'house' | 'hospital' | 'church';
const SCENARIO_MAP_FINAL_EXCLUDED_TOOL_SET = new Set<PlayableToolName>([
  'res',
  'com',
  'ind',
  'query',
]);
const SCENARIO_MAP_FINAL_PLAYABLE_TOOL_SPECS = PLAYABLE_TOOL_SPECS.filter(
  (spec) => !SCENARIO_MAP_FINAL_EXCLUDED_TOOL_SET.has(spec.tool),
);
const SCENARIO_MAP_FINAL_PLAYABLE_TOOL_NAME_SET = new Set<PlayableToolName>(
  SCENARIO_MAP_FINAL_PLAYABLE_TOOL_SPECS.map((spec) => spec.tool),
);

interface ScenarioMapFinalToolSpec {
  readonly tool: ScenarioMapFinalToolId;
  readonly label: string;
  readonly size: number;
  readonly offset: number;
  readonly baseCost: number;
  readonly pendingColor: string;
  readonly previewTileId: number;
  readonly toolState: number | null;
}

const SCENARIO_MAP_FINAL_TOOL_SPECS: readonly ScenarioMapFinalToolSpec[] = [
  ...SCENARIO_MAP_FINAL_PLAYABLE_TOOL_SPECS.map((spec) => ({
    tool: spec.tool,
    label: spec.label,
    size: spec.size,
    offset: spec.offset,
    baseCost: spec.baseCost,
    pendingColor: spec.pendingColor,
    previewTileId:
      spec.tool === 'park'
        ? Tile.WOODS2
        : spec.tool === 'fire'
          ? Tile.FIRESTATION
          : spec.tool === 'police'
            ? Tile.POLICESTATION
            : spec.tool === 'road'
              ? Tile.ROADS
              : spec.tool === 'rail'
                ? Tile.HRAIL
                : spec.tool === 'wire'
                  ? Tile.HPOWER
                  : spec.tool === 'bulldoze'
                    ? Tile.RUBBLE
                    : spec.tool === 'stadium'
                      ? Tile.STADIUM
                      : spec.tool === 'seaport'
                        ? Tile.PORT
                        : spec.tool === 'coal'
                          ? Tile.POWERPLANT
                          : spec.tool === 'nuclear'
                            ? Tile.NUCLEAR
                            : Tile.AIRPORT,
    toolState: spec.toolState,
  })),
  {
    tool: 'house',
    label: 'House',
    size: 1,
    offset: 0,
    baseCost: 0,
    pendingColor: '#86efac',
    previewTileId: Tile.HOUSE,
    toolState: null,
  },
  {
    tool: 'hospital',
    label: 'Hospital',
    size: 3,
    offset: 1,
    baseCost: 0,
    pendingColor: '#fde68a',
    previewTileId: Tile.HOSPITAL,
    toolState: null,
  },
  {
    tool: 'church',
    label: 'Church',
    size: 3,
    offset: 1,
    baseCost: 0,
    pendingColor: '#ddd6fe',
    previewTileId: Tile.CHURCH,
    toolState: null,
  },
] as const;
const SCENARIO_MAP_FINAL_DERIVE_SIM_TICK_COUNT_DEFAULT = 16;
const { ANIMBIT, BLBNCNBIT, BULLBIT, BURNBIT } = TileFlag;

type ScenarioMapFinalParkBrushMode =
  | 'auto'
  | 'sprinkler'
  | 'woods2'
  | 'woods3'
  | 'woods4'
  | 'woods5';

const SCENARIO_MAP_FINAL_PARK_BRUSH_MODE_CHOICES: readonly {
  readonly id: ScenarioMapFinalParkBrushMode;
  readonly label: string;
  readonly tileId: number | null;
}[] = [
  { id: 'auto', label: 'Auto', tileId: null },
  { id: 'sprinkler', label: 'Sprinkler', tileId: Tile.FOUNTAIN },
  { id: 'woods2', label: 'Woods 2', tileId: Tile.WOODS2 },
  { id: 'woods3', label: 'Woods 3', tileId: Tile.WOODS3 },
  { id: 'woods4', label: 'Woods 4', tileId: Tile.WOODS4 },
  { id: 'woods5', label: 'Woods 5', tileId: Tile.WOODS5 },
] as const;

const SCENARIO_MAP_FINAL_HOUSE_BRUSH_CHOICES: readonly {
  readonly label: string;
  readonly tileId: number | null;
}[] = [
  { label: 'Auto', tileId: null },
  ...Array.from({ length: 12 }, (_, index) => ({
    label: `Land Value Class ${Math.floor(index / 3)} / Variant ${(index % 3) + 1}`,
    tileId: Tile.HOUSE + index,
  })),
] as const;

function isScenarioMapFinalPlayableToolId(tool: ScenarioMapFinalToolId): tool is PlayableToolName {
  return SCENARIO_MAP_FINAL_PLAYABLE_TOOL_NAME_SET.has(tool as PlayableToolName);
}

interface ScenarioMapFinalBrushSelectionState {
  readonly activeKind: ScenarioMapFinalActiveBrushFamily;
  readonly baseBrushId: ScenarioMapFinalSmartBaseBrushId;
  readonly zoneKind: ScenarioEditorMapZoneKind;
  readonly zoneOptionKey: string;
  readonly tool: ScenarioMapFinalToolId;
}

type ScenarioMapFinalBrushSelectionAction =
  | {
      readonly type: 'select-base-brush';
      readonly brushId: ScenarioMapFinalSmartBaseBrushId;
    }
  | {
      readonly type: 'select-zone-kind';
      readonly zoneKind: ScenarioEditorMapZoneKind;
    }
  | {
      readonly type: 'select-zone-option';
      readonly optionKey: string;
    }
  | {
      readonly type: 'select-tool';
      readonly tool: ScenarioMapFinalToolId;
    };

const SCENARIO_MAP_FINAL_DEFAULT_BRUSH_SELECTION_STATE: ScenarioMapFinalBrushSelectionState = {
  activeKind: 'zones',
  baseBrushId: 'dirt',
  zoneKind: 'res',
  zoneOptionKey: 'fresh',
  tool: 'road',
};

const CLASSICY_MAP_SIDEBAR_BUTTON_CLASS =
  '!m-0 !min-h-0 border-2 !border-[var(--color-window-border)] !bg-[var(--color-system-02)] p-[0.2rem] text-[var(--color-black)]';
const CLASSICY_MAP_SIDEBAR_BUTTON_ACTIVE_CLASS =
  '!border-[var(--color-theme-07)] !bg-[var(--color-theme-03)] [box-shadow:inset_0_0_0_1px_var(--color-theme-08)]';
const CLASSICY_MAP_SIDEBAR_ACTIVE_SURFACE_CLASS =
  '!border-[var(--color-theme-07)] [background:color-mix(in_srgb,var(--color-theme-03)_52%,var(--color-system-03))]';

/**
 * Reduce map-final sidebar brush selection to one globally active family.
 * Not from Micropolis C: editor-only UI selection state (active brush + remembered
 * per-family choices) for React rendering and interaction wiring.
 */
function reduceScenarioMapFinalBrushSelection(
  state: ScenarioMapFinalBrushSelectionState,
  action: ScenarioMapFinalBrushSelectionAction,
): ScenarioMapFinalBrushSelectionState {
  switch (action.type) {
    case 'select-base-brush':
      return {
        ...state,
        activeKind: 'base',
        baseBrushId: action.brushId,
      };
    case 'select-zone-kind':
      return {
        ...state,
        activeKind: 'zones',
        zoneKind: action.zoneKind,
        zoneOptionKey: 'fresh',
      };
    case 'select-zone-option':
      return {
        ...state,
        activeKind: 'zones',
        zoneOptionKey: action.optionKey,
      };
    case 'select-tool':
      return {
        ...state,
        activeKind: 'tools',
        tool: action.tool,
      };
    default:
      return state;
  }
}

/**
 * Deterministically derive one Micropolis park variant for editor auto mode.
 * Mirrors the 5-way variant domain from `putDownPark` in
 * `ref/micropolis/src/sim/w_tool.c` (`WOODS2..WOODS5` + `FOUNTAIN`), with an
 * editor-specific deterministic hash in place of mutable global `Rand(4)`.
 */
function resolveScenarioMapFinalAutoParkTileId(x: number, y: number): number {
  const hash = ((Math.imul(x + 1, 73_856_093) ^ Math.imul(y + 1, 19_349_663)) >>> 0) % 5;
  if (hash === 4) {
    return Tile.FOUNTAIN;
  }
  return Tile.WOODS2 + hash;
}

/**
 * Resolve one tile-word payload for park placement modes in map-final.
 * Mirrors `putDownPark` flags in `ref/micropolis/src/sim/w_tool.c`:
 * all variants set `BURNBIT|BULLBIT`, and fountain also sets `ANIMBIT`.
 */
function resolveScenarioMapFinalParkTileWord(
  mode: ScenarioMapFinalParkBrushMode,
  point: { x: number; y: number },
): number {
  const modeChoice = SCENARIO_MAP_FINAL_PARK_BRUSH_MODE_CHOICES.find(
    (choice) => choice.id === mode,
  );
  const tileId = modeChoice?.tileId ?? resolveScenarioMapFinalAutoParkTileId(point.x, point.y);
  if (tileId === Tile.FOUNTAIN) {
    return tileId | BURNBIT | BULLBIT | ANIMBIT;
  }
  return tileId | BURNBIT | BULLBIT;
}

/**
 * Deterministically derive one house tile variant for editor auto mode.
 * Mirrors the 12-way `BuildHouse` domain from `ref/micropolis/src/sim/s_zone.c`
 * (`HOUSE + Rand(2) + value * 3`) while using deterministic hashing for stable authoring.
 */
function resolveScenarioMapFinalAutoHouseTileId(x: number, y: number): number {
  const hash = ((Math.imul(x + 1, 1_103_515_245) ^ Math.imul(y + 1, 12_345)) >>> 0) % 12;
  return Tile.HOUSE + hash;
}

/**
 * Resolve one tile-word payload for map-final house placement.
 * Mirrors `BuildHouse` flags in `ref/micropolis/src/sim/s_zone.c`
 * (`BLBNCNBIT` over one `HOUSE..HOUSE+11` tile id).
 */
function resolveScenarioMapFinalHouseTileWord(
  tileId: number | null,
  point: { x: number; y: number },
): number {
  const resolvedTileId = tileId ?? resolveScenarioMapFinalAutoHouseTileId(point.x, point.y);
  return resolvedTileId | BLBNCNBIT;
}

/**
 * Test whether one tile id is in the residential house variant domain.
 * Mirrors `HOUSE + Rand(2) + value * 3` in `BuildHouse` from
 * `ref/micropolis/src/sim/s_zone.c` (12 variants across 4 land-value classes).
 */
function isScenarioMapFinalHouseTileId(tileId: number): boolean {
  return tileId >= Tile.HOUSE && tileId < Tile.HOUSE + 12;
}

/**
 * Resolve whether one map cell is a legal manual house paint target.
 * Mirrors `DoResOut`/`BuildHouse` occupancy ownership in `ref/micropolis/src/sim/s_zone.c`:
 * houses live inside the 3x3 `FREEZ` lot perimeter (excluding center) or replace an
 * existing house variant tile.
 */
function canScenarioMapFinalPaintHouseAt(
  bundle: { readonly map: { readonly width: number; readonly height: number } },
  point: { x: number; y: number },
  readTileWord: (point: { x: number; y: number }) => number | null,
): boolean {
  const tileIdAtPoint = (readTileWord(point) ?? 0) & TileMask.LOMASK;
  if (isScenarioMapFinalHouseTileId(tileIdAtPoint)) {
    return true;
  }
  if (tileIdAtPoint === Tile.FREEZ) {
    return false;
  }

  for (let x = point.x - 1; x <= point.x + 1; x += 1) {
    for (let y = point.y - 1; y <= point.y + 1; y += 1) {
      if (x < 0 || y < 0 || x >= bundle.map.width || y >= bundle.map.height) {
        continue;
      }
      const tileId = (readTileWord({ x, y }) ?? 0) & TileMask.LOMASK;
      if (tileId === Tile.FREEZ) {
        return true;
      }
    }
  }
  return false;
}

interface ScenarioMapFinalSmartBaseBrush {
  readonly id: ScenarioMapFinalSmartBaseBrushId;
  readonly label: string;
  readonly tileId: number;
  readonly pendingColor: string;
  readonly tooltip: string;
}

const SCENARIO_MAP_FINAL_SMART_BASE_BRUSHES: readonly ScenarioMapFinalSmartBaseBrush[] = [
  {
    id: 'dirt',
    label: 'Dirt',
    tileId: Tile.DIRT,
    pendingColor: '#9a6700',
    tooltip: 'Dirt terrain brush',
  },
  {
    id: 'water',
    label: 'Water',
    tileId: Tile.RIVER,
    pendingColor: '#1f6feb',
    tooltip: 'Water brush (auto smoothing derives shore variants)',
  },
  {
    id: 'channel',
    label: 'Channel',
    tileId: Tile.CHANNEL,
    pendingColor: '#218bff',
    tooltip: 'Channel brush (kept during water smoothing)',
  },
  {
    id: 'forest',
    label: 'Forest',
    tileId: Tile.WOODS,
    pendingColor: '#2da44e',
    tooltip: 'Forest brush (stamps a 2x2 cluster; auto smoothing derives tree-edge variants)',
  },
] as const;
const SCENARIO_MAP_FINAL_DEFAULT_SMART_BASE_BRUSH: ScenarioMapFinalSmartBaseBrush = {
  id: 'dirt',
  label: 'Dirt',
  tileId: Tile.DIRT,
  pendingColor: '#9a6700',
  tooltip: 'Dirt terrain brush',
};
const SCENARIO_MAP_FINAL_TREE_TILE_MAX_FOR_SMOOTHING = 39;
const SCENARIO_MAP_FINAL_EXACT_TILE_HOVER_PREVIEW: MapCanvasHoverPreviewSpec = {
  size: 1,
  offset: 0,
  pendingColor: '#6e7781',
};

interface ScenarioMapFinalExactTileBrushEntry {
  readonly tileId: number;
  readonly originalNames: readonly string[];
  readonly readableNames: readonly string[];
  readonly title: string;
  readonly searchText: string;
}

/**
 * Build one complete exact-tile palette for map-final authoring.
 * Mirrors the fixed Micropolis tile-id domain from `TILE_COUNT` in
 * `ref/micropolis/src/sim/headers/sim.h`; parity note: entries include
 * editor-readable aliases from the curated named-tile table when available.
 */
function buildScenarioMapFinalExactTileBrushEntries(): readonly ScenarioMapFinalExactTileBrushEntry[] {
  const namesByTileId = new Map<number, { names: string[]; labels: string[] }>();
  for (const namedTile of BASE_TILE_NAME_OPTIONS) {
    const bucket = namesByTileId.get(namedTile.tileId);
    if (bucket === undefined) {
      namesByTileId.set(namedTile.tileId, {
        names: [namedTile.name],
        labels: [namedTile.label],
      });
      continue;
    }
    if (!bucket.names.includes(namedTile.name)) {
      bucket.names.push(namedTile.name);
    }
    if (!bucket.labels.includes(namedTile.label)) {
      bucket.labels.push(namedTile.label);
    }
  }

  const entries: ScenarioMapFinalExactTileBrushEntry[] = [];
  for (let tileId = 0; tileId < Tile.TILE_COUNT; tileId += 1) {
    const namedBucket = namesByTileId.get(tileId);
    const originalNames = namedBucket?.names ?? [];
    const readableNames = namedBucket?.labels ?? [];
    const namesText = originalNames.join(' / ');
    const labelsText = readableNames.join(' / ');
    const title =
      namesText.length === 0
        ? `${tileId} (Unnamed tile)`
        : labelsText.length === 0
          ? `${tileId} (${namesText})`
          : `${tileId} (${namesText} / ${labelsText})`;
    entries.push({
      tileId,
      originalNames,
      readableNames,
      title,
      searchText: `${tileId} ${namesText} ${labelsText}`.toLowerCase(),
    });
  }
  return entries;
}

const SCENARIO_MAP_FINAL_EXACT_TILE_BRUSH_ENTRIES = buildScenarioMapFinalExactTileBrushEntries();

type ScenarioMapFinalZoneOption =
  | {
      readonly key: 'fresh';
      readonly kind: 'fresh';
      readonly landValueClass: null;
      readonly densityLevel: null;
      readonly tileId: number;
      readonly swatchTileIds: readonly number[];
      readonly tooltip: string;
    }
  | {
      readonly key: `level:${number}:value:${number}`;
      readonly kind: 'developed';
      readonly landValueClass: number;
      readonly densityLevel: number;
      readonly tileId: number;
      readonly swatchTileIds: readonly number[];
      readonly tooltip: string;
    };
type ScenarioMapFinalDevelopedZoneOption = Extract<
  ScenarioMapFinalZoneOption,
  { kind: 'developed' }
>;

/**
 * Resolve undeveloped-zone center tile id for one R/C/I family.
 * Mirrors zone clear-state constants from `ref/micropolis/src/sim/headers/sim.h`:
 * residential `FREEZ`, commercial `COMCLR`, industrial `INDCLR`.
 */
function getMapFinalZoneFreshCenterTileId(zone: ScenarioEditorMapZoneKind): number {
  if (zone === 'res') {
    return Tile.FREEZ;
  }
  if (zone === 'com') {
    return Tile.COMCLR;
  }
  return Tile.INDCLR;
}

/**
 * Resolve developed-zone center tile id for one R/C/I density/value selection.
 * Mirrors `ResPlop` / `ComPlop` / `IndPlop` center-tile formulas in
 * `ref/micropolis/src/sim/s_zone.c` (`base + 4` with `den` as 0-based density).
 */
function getMapFinalZoneDevelopedCenterTileId(
  zone: ScenarioEditorMapZoneKind,
  densityLevel: number,
  landValueClass: number,
): number {
  const den = densityLevel - 1;
  if (zone === 'res') {
    return (landValueClass * 4 + den) * 9 + Tile.RZB;
  }
  if (zone === 'com') {
    return (landValueClass * 5 + den) * 9 + Tile.CZB;
  }
  return (landValueClass * 4 + den) * 9 + Tile.IZB;
}

/**
 * Build the full 3x3 tile block for one zone variant from its center tile id.
 * Mirrors `ZonePlop` writes in `ref/micropolis/src/sim/s_zone.c` where a zone's
 * 3x3 block occupies `base..base+8` and the center is `base+4`.
 */
function getMapFinalZoneSwatchTileIds(centerTileId: number): readonly number[] {
  return [
    centerTileId - 4,
    centerTileId - 3,
    centerTileId - 2,
    centerTileId - 1,
    centerTileId,
    centerTileId + 1,
    centerTileId + 2,
    centerTileId + 3,
    centerTileId + 4,
  ];
}

/**
 * Resolve cursor preview footprint for one map-final smart base brush.
 * Mirrors the `toolSize`/`toolOffset` footprint box semantics from
 * `ref/micropolis/src/sim/w_editor.c` (`DrawCursor`), but for editor-only base brushes.
 */
function getScenarioMapFinalBaseHoverPreviewSpec(
  brush: ScenarioMapFinalSmartBaseBrush,
): MapCanvasHoverPreviewSpec {
  if (brush.id === 'forest') {
    return {
      size: 2,
      offset: 0,
      pendingColor: brush.pendingColor,
    };
  }
  return {
    size: 1,
    offset: 0,
    pendingColor: brush.pendingColor,
  };
}

/**
 * Resolve special-zone target kind for custom map-final tools.
 * Mirrors hospital/church special-zone families in `ref/micropolis/src/sim/s_zone.c`.
 */
function toScenarioMapFinalSpecialZoneKind(
  tool: ScenarioMapFinalToolId,
): ScenarioEditorMapSpecialZoneKind | null {
  if (tool === 'hospital') {
    return 'hospital';
  }
  if (tool === 'church') {
    return 'church';
  }
  return null;
}

/**
 * Resolve base-class visualization styling for one map tile.
 * Not from Micropolis C: editor-only readability overlay that helps distinguish
 * authored terrain classes (channel/water/forest) while preserving original art.
 */
function getScenarioMapFinalBaseClassOverlayStyle(
  tileWord: number,
): MapCanvasTileOverlayStyle | null {
  const tileId = tileWord & TileMask.LOMASK;
  if (tileId === Tile.CHANNEL) {
    return {
      fillColor: 'rgba(208, 74, 188, 0.32)',
      strokeColor: 'rgba(232, 121, 249, 0.95)',
      label: 'C',
      labelColor: '#4a044e',
    };
  }
  if (tileId === Tile.RIVER || (tileId >= Tile.FIRSTRIVEDGE && tileId <= Tile.LASTRIVEDGE)) {
    return {
      fillColor: 'rgba(30, 100, 228, 0.2)',
    };
  }
  if (
    (tileId >= Tile.TREEBASE && tileId <= SCENARIO_MAP_FINAL_TREE_TILE_MAX_FOR_SMOOTHING) ||
    (tileId >= Tile.WOODS && tileId <= Tile.WOODS5)
  ) {
    return {
      fillColor: 'rgba(46, 160, 67, 0.2)',
    };
  }
  return null;
}

/**
 * Full-screen map workbench shell for the final map-authoring workflow.
 * Reuses the runtime `MapCanvas` surface from `apps/web` while presenting an
 * editor-specific sidebar layout (not a direct Micropolis C UI port).
 * Difference: accepts optional right-sidebar overlay width so map panning can
 * reveal right-edge tiles even when external inspector chrome occludes the viewport.
 */
export function ScenarioMapFinalWorkbench(options: {
  readonly rightSidebarOverlayWidthPx?: number;
}) {
  const { rightSidebarOverlayWidthPx = 0 } = options;
  const { bundle, mapEditor } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const [brushSelection, dispatchBrushSelection] = useReducer(
    reduceScenarioMapFinalBrushSelection,
    SCENARIO_MAP_FINAL_DEFAULT_BRUSH_SELECTION_STATE,
  );
  const [sidebarMode, setSidebarMode] = useState<ScenarioMapFinalSidebarMode>('creator');
  const [exactTileSearchQuery, setExactTileSearchQuery] = useState('');
  const [exactTileNamedOnly, setExactTileNamedOnly] = useState(true);
  const [exactTileBrushTileId, setExactTileBrushTileId] = useState<number>(Tile.DIRT);
  const [parkBrushMode, setParkBrushMode] = useState<ScenarioMapFinalParkBrushMode>('auto');
  const [houseBrushTileId, setHouseBrushTileId] = useState<number | null>(null);
  const [deriveSimulationTicks, setDeriveSimulationTicks] = useState<number>(
    SCENARIO_MAP_FINAL_DERIVE_SIM_TICK_COUNT_DEFAULT,
  );
  const [toolVariantContextMenu, setToolVariantContextMenu] = useState<{
    readonly anchorPoint: { x: number; y: number } | null;
    readonly tool: 'park' | 'house' | null;
  }>({
    anchorPoint: null,
    tool: null,
  });
  const activeBrushFamily = brushSelection.activeKind;
  const activeZoneKind = brushSelection.zoneKind;
  const activeZoneOptionKey = brushSelection.zoneOptionKey;
  const activeTool = brushSelection.tool;
  const activeSmartBaseBrushId = brushSelection.baseBrushId;
  const isCreatorSidebarMode = sidebarMode === 'creator';
  const terrainRecomputeMode = mapEditor.autoSmoothingEnabled ? 'global' : 'off';
  const runtimeMapState = useMemo(
    () =>
      createScenarioEditorRuntimeMapStateWithOptions(bundle, {
        // Editor-only UX: show unpowered indicator continuously (no blink).
        blinkUnpoweredZoneCenter: true,
      }),
    [bundle],
  );
  const zoneAtlasCanonicalIdentityKey = useMemo(
    () => resolveRuntimeTilesetBaseAtlasCanonicalIdentityKey('classic'),
    [],
  );
  const zoneAtlasSource = useMemo(
    () => getTileAtlasSourceByCanonicalIdentityKey(zoneAtlasCanonicalIdentityKey),
    [zoneAtlasCanonicalIdentityKey],
  );
  const zoneValueClassLabel = useMemo(
    () => getScenarioMapZoneValueClassLabel(activeZoneKind),
    [activeZoneKind],
  );
  const activeToolSpec = useMemo(
    () => SCENARIO_MAP_FINAL_TOOL_SPECS.find((spec) => spec.tool === activeTool),
    [activeTool],
  );
  const activeMapFinalToolSpec =
    activeToolSpec ?? SCENARIO_MAP_FINAL_TOOL_SPECS[0] ?? getPlayableToolSpec('road');
  const zoneMaxValueClass = useMemo(
    () => getScenarioEditorMapZoneMaxValue(activeZoneKind),
    [activeZoneKind],
  );
  const activeSmartBaseBrush = useMemo(
    () =>
      SCENARIO_MAP_FINAL_SMART_BASE_BRUSHES.find((brush) => brush.id === activeSmartBaseBrushId) ??
      SCENARIO_MAP_FINAL_DEFAULT_SMART_BASE_BRUSH,
    [activeSmartBaseBrushId],
  );
  const activeSmartBaseHoverPreview = useMemo(
    () => getScenarioMapFinalBaseHoverPreviewSpec(activeSmartBaseBrush),
    [activeSmartBaseBrush],
  );
  const mapFinalBaseTileOverlayResolver = useMemo<MapCanvasTileOverlayResolver | undefined>(
    () =>
      mapEditor.showBaseTileClassesEnabled ? getScenarioMapFinalBaseClassOverlayStyle : undefined,
    [mapEditor.showBaseTileClassesEnabled],
  );
  const exactTileBrushEntries = useMemo(() => {
    const query = exactTileSearchQuery.trim().toLowerCase();
    return SCENARIO_MAP_FINAL_EXACT_TILE_BRUSH_ENTRIES.filter((entry) => {
      if (exactTileNamedOnly && entry.originalNames.length === 0) {
        return false;
      }
      if (query.length === 0) {
        return true;
      }
      return entry.searchText.includes(query);
    });
  }, [exactTileNamedOnly, exactTileSearchQuery]);
  const mapFinalRuntimeTheme = useMemo<CSSProperties>(() => {
    const theme = getAllThemes()[0];
    return theme === undefined ? {} : (getThemeVars(theme) as CSSProperties);
  }, []);
  const activeParkBrushModeLabel = useMemo(
    () =>
      SCENARIO_MAP_FINAL_PARK_BRUSH_MODE_CHOICES.find((choice) => choice.id === parkBrushMode)
        ?.label ?? 'Auto',
    [parkBrushMode],
  );
  const activeHouseBrushModeLabel = useMemo(
    () =>
      SCENARIO_MAP_FINAL_HOUSE_BRUSH_CHOICES.find((choice) => choice.tileId === houseBrushTileId)
        ?.label ?? 'Auto',
    [houseBrushTileId],
  );
  const isParkBrushContextMenuOpen =
    toolVariantContextMenu.anchorPoint !== null &&
    toolVariantContextMenu.tool === 'park' &&
    activeBrushFamily === 'tools' &&
    activeTool === 'park';
  const isHouseBrushContextMenuOpen =
    toolVariantContextMenu.anchorPoint !== null &&
    toolVariantContextMenu.tool === 'house' &&
    activeBrushFamily === 'tools' &&
    activeTool === 'house';
  const isToolVariantContextMenuOpen = isParkBrushContextMenuOpen || isHouseBrushContextMenuOpen;
  function closeToolVariantContextMenu(): void {
    setToolVariantContextMenu((current) =>
      current.anchorPoint !== null
        ? {
            ...current,
            anchorPoint: null,
            tool: null,
          }
        : current,
    );
  }

  const zoneOptions = useMemo<readonly ScenarioMapFinalZoneOption[]>(() => {
    const freshTileId = getMapFinalZoneFreshCenterTileId(activeZoneKind);
    const entries: ScenarioMapFinalZoneOption[] = [
      {
        key: 'fresh',
        kind: 'fresh',
        densityLevel: null,
        landValueClass: null,
        tileId: freshTileId,
        swatchTileIds: getMapFinalZoneSwatchTileIds(freshTileId),
        tooltip: `${SCENARIO_MAP_FINAL_ZONE_FAMILY_LABELS[activeZoneKind]} fresh zone (Density Level 0, ${zoneValueClassLabel} n/a)`,
      },
    ];

    for (let value = 0; value <= zoneMaxValueClass; value += 1) {
      for (let level = 1; level <= getScenarioEditorMapZoneMaxLevel(activeZoneKind); level += 1) {
        const tileId = getMapFinalZoneDevelopedCenterTileId(activeZoneKind, level, value);
        entries.push({
          key: `level:${level}:value:${value}`,
          kind: 'developed',
          densityLevel: level,
          landValueClass: value,
          tileId,
          swatchTileIds: getMapFinalZoneSwatchTileIds(tileId),
          tooltip: `Density Level ${level}, ${zoneValueClassLabel} ${value}`,
        });
      }
    }

    return entries;
  }, [activeZoneKind, zoneMaxValueClass, zoneValueClassLabel]);
  const zoneLevelColumnCount = useMemo(
    () => getScenarioEditorMapZoneMaxLevel(activeZoneKind),
    [activeZoneKind],
  );
  const zoneOptionRows = useMemo<readonly (readonly ScenarioMapFinalZoneOption[])[]>(() => {
    const rows: ScenarioMapFinalZoneOption[][] = [];
    const freshOption = zoneOptions.find((option) => option.kind === 'fresh');
    if (freshOption !== undefined) {
      rows.push([freshOption]);
    }
    for (let value = 0; value <= zoneMaxValueClass; value += 1) {
      const rowOptions = zoneOptions
        .filter(
          (option): option is ScenarioMapFinalDevelopedZoneOption =>
            option.kind === 'developed' && option.landValueClass === value,
        )
        .sort((left, right) => left.densityLevel - right.densityLevel);
      rows.push(rowOptions);
    }
    return rows;
  }, [zoneMaxValueClass, zoneOptions]);
  const activeZoneOption = useMemo(
    () => zoneOptions.find((option) => option.key === activeZoneOptionKey) ?? zoneOptions[0]!,
    [activeZoneOptionKey, zoneOptions],
  );

  return (
    <section
      className="grid h-full min-h-0 grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] overflow-hidden [background:color-mix(in_srgb,var(--color-system-03)_92%,var(--color-system-05))] text-[var(--color-black)] [font-family:var(--ui-font),sans-serif] [font-size:var(--ui-font-size)] max-[980px]:grid-cols-1 max-[980px]:grid-rows-[auto_minmax(0,1fr)]"
      aria-label="Scenario map final workbench"
      style={mapFinalRuntimeTheme}
    >
      <ClassicyPanelChrome
        aria-label="Scenario map authoring controls"
        className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden px-3 py-3 max-[980px]:max-h-[48vh]"
      >
        <ClassicyMessageSurface className="grid gap-[0.45rem] p-2">
          <div className="grid gap-[0.35rem]">
            <ClassicyCheckboxField
              checked={mapEditor.autoSmoothingEnabled}
              label="Enable auto smoothing"
              onChange={(event) => {
                dispatch({
                  type: 'set-map-auto-smoothing-enabled',
                  enabled: event.currentTarget.checked,
                });
              }}
            />
            <ClassicyCheckboxField
              checked={mapEditor.showBaseTileClassesEnabled}
              label="Show base tile classes"
              onChange={(event) => {
                dispatch({
                  type: 'set-map-show-base-tile-classes-enabled',
                  enabled: event.currentTarget.checked,
                });
              }}
            />
          </div>
          <ClassicyToggleGroup<ScenarioMapFinalSidebarMode>
            ariaLabel="Map final sidebar mode"
            options={[
              { value: 'creator', label: 'Creator' },
              { value: 'all-tiles', label: 'Advanced' },
            ]}
            onValueChange={(value) => {
              closeToolVariantContextMenu();
              setSidebarMode(value);
            }}
            value={sidebarMode}
          />
        </ClassicyMessageSurface>
        {isCreatorSidebarMode ? (
          <div className="grid min-h-0 content-start gap-3 overflow-y-auto pr-1">
            <ClassicyMessageSurface
              className={`grid gap-[0.65rem] p-2 ${
                activeBrushFamily === 'base' ? CLASSICY_MAP_SIDEBAR_ACTIVE_SURFACE_CLASS : ''
              }`}
            >
              <ClassicyPanelTitle className="m-0 [font-size:calc(var(--header-font-size)*0.85)]">
                Base
              </ClassicyPanelTitle>
              <div
                className="grid grid-cols-2 gap-[0.45rem]"
                role="list"
                aria-label="Smart base brushes"
              >
                {SCENARIO_MAP_FINAL_SMART_BASE_BRUSHES.map((brush) => (
                  <ClassicyButton
                    active={activeBrushFamily === 'base' && activeSmartBaseBrushId === brush.id}
                    activeClassName={CLASSICY_MAP_SIDEBAR_BUTTON_ACTIVE_CLASS}
                    aria-pressed={
                      activeBrushFamily === 'base' && activeSmartBaseBrushId === brush.id
                    }
                    className={`${CLASSICY_MAP_SIDEBAR_BUTTON_CLASS} grid justify-items-start gap-[0.3rem] rounded-lg px-[0.4rem] py-[0.35rem]`}
                    key={brush.id}
                    onClick={() => {
                      closeToolVariantContextMenu();
                      dispatchBrushSelection({
                        type: 'select-base-brush',
                        brushId: brush.id,
                      });
                    }}
                    role="listitem"
                    title={brush.tooltip}
                    type="button"
                  >
                    {zoneAtlasSource === undefined ? (
                      <span className="text-[0.8rem] font-semibold text-[var(--color-system-07)]">
                        {brush.tileId}
                      </span>
                    ) : (
                      <MapFinalSingleTileSprite
                        atlasCanonicalIdentityKey={zoneAtlasCanonicalIdentityKey}
                        atlasSpriteSheetUrl={zoneAtlasSource.spriteSheetUrl}
                        tileId={brush.tileId}
                      />
                    )}
                    <span>{brush.label}</span>
                  </ClassicyButton>
                ))}
              </div>

              <small className="text-sm text-[var(--color-system-07)]">
                Active smart brush: {activeSmartBaseBrush.label}. Terrain auto-smooths after edits.
              </small>
            </ClassicyMessageSurface>

            <ClassicyMessageSurface
              className={`grid gap-[0.65rem] p-2 ${
                activeBrushFamily === 'zones' ? CLASSICY_MAP_SIDEBAR_ACTIVE_SURFACE_CLASS : ''
              }`}
            >
              <ClassicyPanelTitle className="m-0 [font-size:calc(var(--header-font-size)*0.85)]">
                Zones
              </ClassicyPanelTitle>
              <ClassicyToggleGroup<ScenarioEditorMapZoneKind>
                ariaLabel="Zone family selector"
                options={[
                  { value: 'res', label: 'RES' },
                  { value: 'com', label: 'COM' },
                  { value: 'ind', label: 'IND' },
                ]}
                onValueChange={(zone) => {
                  closeToolVariantContextMenu();
                  dispatchBrushSelection({
                    type: 'select-zone-kind',
                    zoneKind: zone,
                  });
                }}
                value={activeZoneKind}
              />

              <div className="grid gap-[0.45rem]">
                {zoneOptionRows.map((rowOptions, rowIndex) => (
                  <div
                    className="grid gap-[0.45rem]"
                    key={`row:${rowIndex}`}
                    style={
                      {
                        gridTemplateColumns: `repeat(${zoneLevelColumnCount}, minmax(3.6rem, 1fr))`,
                      } satisfies CSSProperties
                    }
                  >
                    {rowOptions.map((option) => (
                      <ClassicyButton
                        active={activeBrushFamily === 'zones' && option.key === activeZoneOptionKey}
                        activeClassName={CLASSICY_MAP_SIDEBAR_BUTTON_ACTIVE_CLASS}
                        className={`${CLASSICY_MAP_SIDEBAR_BUTTON_CLASS} flex min-h-[3.4rem] items-center justify-center rounded-lg`}
                        key={option.key}
                        onClick={() => {
                          closeToolVariantContextMenu();
                          dispatchBrushSelection({
                            type: 'select-zone-option',
                            optionKey: option.key,
                          });
                        }}
                        aria-label={option.tooltip}
                        title={option.tooltip}
                        type="button"
                      >
                        {zoneAtlasSource === undefined ? (
                          <span className="text-[0.8rem] font-semibold text-[var(--color-system-07)]">
                            {option.tileId}
                          </span>
                        ) : (
                          <MapFinalZoneTileSprite
                            atlasCanonicalIdentityKey={zoneAtlasCanonicalIdentityKey}
                            atlasSpriteSheetUrl={zoneAtlasSource.spriteSheetUrl}
                            tileIds={option.swatchTileIds}
                          />
                        )}
                      </ClassicyButton>
                    ))}
                  </div>
                ))}
              </div>

              <small className="text-sm text-[var(--color-system-07)]">
                {activeZoneOption.kind === 'fresh'
                  ? `${SCENARIO_MAP_FINAL_ZONE_FAMILY_LABELS[activeZoneKind]} fresh zone`
                  : `Density Level ${activeZoneOption.densityLevel} / ${zoneValueClassLabel} ${activeZoneOption.landValueClass}`}
              </small>
            </ClassicyMessageSurface>

            <ClassicyMessageSurface
              className={`grid gap-[0.65rem] p-2 ${
                activeBrushFamily === 'tools' ? CLASSICY_MAP_SIDEBAR_ACTIVE_SURFACE_CLASS : ''
              }`}
            >
              <ClassicyPanelTitle className="m-0 [font-size:calc(var(--header-font-size)*0.85)]">
                Tools
              </ClassicyPanelTitle>
              <div
                className="grid grid-cols-4 gap-[0.45rem]"
                role="list"
                aria-label="Micropolis map tools"
              >
                {SCENARIO_MAP_FINAL_TOOL_SPECS.map((spec) => {
                  const active = activeBrushFamily === 'tools' && activeTool === spec.tool;
                  const iconLookup =
                    spec.toolState === null
                      ? undefined
                      : resolveSimUiToolIconAssetLookup(spec.toolState, {
                          highlighted: active,
                        });
                  const iconBasename = iconLookup?.derivedPngPath?.split('/').pop();
                  const iconUrl =
                    iconBasename === undefined
                      ? undefined
                      : PLAYABLE_TOOL_ICON_URL_BY_BASENAME.get(iconBasename);
                  return (
                    <ClassicyButton
                      active={active}
                      activeClassName={CLASSICY_MAP_SIDEBAR_BUTTON_ACTIVE_CLASS}
                      aria-label={spec.label}
                      aria-pressed={active}
                      className={`${CLASSICY_MAP_SIDEBAR_BUTTON_CLASS} grid h-[3.8rem] w-full place-items-center rounded-lg`}
                      key={spec.tool}
                      onClick={() => {
                        closeToolVariantContextMenu();
                        dispatchBrushSelection({
                          type: 'select-tool',
                          tool: spec.tool,
                        });
                      }}
                      onContextMenu={(event) => {
                        if (spec.tool !== 'park' && spec.tool !== 'house') {
                          return;
                        }
                        event.preventDefault();
                        dispatchBrushSelection({
                          type: 'select-tool',
                          tool: spec.tool,
                        });
                        setToolVariantContextMenu({
                          anchorPoint: {
                            x: event.clientX,
                            y: event.clientY,
                          },
                          tool: spec.tool,
                        });
                      }}
                      role="listitem"
                      title={
                        spec.tool === 'park'
                          ? `${spec.label} (${spec.size}x${spec.size}, base cost $${spec.baseCost}). Right click for variant menu.`
                          : spec.tool === 'house'
                            ? `${spec.label} (${spec.size}x${spec.size}, base cost $${spec.baseCost}). Right click for variant menu.`
                            : `${spec.label} (${spec.size}x${spec.size}, base cost $${spec.baseCost})`
                      }
                      type="button"
                    >
                      {iconUrl !== undefined ? (
                        <img
                          alt=""
                          aria-hidden="true"
                          className="block h-full w-full object-contain [image-rendering:pixelated]"
                          draggable={false}
                          src={iconUrl}
                        />
                      ) : zoneAtlasSource !== undefined ? (
                        <MapFinalSingleTileSprite
                          atlasCanonicalIdentityKey={zoneAtlasCanonicalIdentityKey}
                          atlasSpriteSheetUrl={zoneAtlasSource.spriteSheetUrl}
                          tileId={spec.previewTileId}
                        />
                      ) : (
                        <span className="text-[0.8rem] font-semibold text-[var(--color-system-07)]">
                          {spec.previewTileId}
                        </span>
                      )}
                    </ClassicyButton>
                  );
                })}
              </div>
              <small className="text-sm text-[var(--color-system-07)]">
                Park mode: {activeParkBrushModeLabel}. House mode: {activeHouseBrushModeLabel}.
                Right click Park/House to change.
              </small>
              <ClassicyPopoverMenu
                anchorPoint={toolVariantContextMenu.anchorPoint ?? undefined}
                className="grid max-h-[min(70vh,20rem)] w-[11rem] gap-0.5 overflow-auto p-1"
                offsetPx={2}
                onRequestClose={closeToolVariantContextMenu}
                open={isToolVariantContextMenuOpen}
                placement="bottom-start"
              >
                {isParkBrushContextMenuOpen
                  ? SCENARIO_MAP_FINAL_PARK_BRUSH_MODE_CHOICES.map((choice) => (
                      <ClassicyMenuItemButton
                        key={choice.id}
                        onClick={() => {
                          setParkBrushMode(choice.id);
                          closeToolVariantContextMenu();
                        }}
                        type="button"
                        title={
                          choice.tileId === null
                            ? 'Auto: choose any park variant'
                            : `Place ${choice.label} only (tile ${choice.tileId})`
                        }
                      >
                        {choice.id === parkBrushMode ? '● ' : ''}
                        {choice.label}
                      </ClassicyMenuItemButton>
                    ))
                  : SCENARIO_MAP_FINAL_HOUSE_BRUSH_CHOICES.map((choice) => (
                      <ClassicyMenuItemButton
                        key={choice.tileId === null ? 'auto' : choice.tileId}
                        onClick={() => {
                          setHouseBrushTileId(choice.tileId);
                          closeToolVariantContextMenu();
                        }}
                        type="button"
                        title={
                          choice.tileId === null
                            ? 'Auto: choose any house variant'
                            : `Place ${choice.label} only (tile ${choice.tileId})`
                        }
                      >
                        {choice.tileId === houseBrushTileId ? '● ' : ''}
                        {choice.label}
                      </ClassicyMenuItemButton>
                    ))}
              </ClassicyPopoverMenu>

              <ClassicyMessageSurface className="grid gap-[0.45rem] p-2">
                <div className="grid gap-[0.3rem]">
                  <EditorField className="gap-[0.2rem]">
                    <span className="text-sm font-semibold text-[var(--color-system-08)]">
                      Derive simulation ticks
                    </span>
                    <input
                      min={1}
                      onChange={(event) => {
                        const next = Number(event.currentTarget.value);
                        if (Number.isFinite(next)) {
                          setDeriveSimulationTicks(Math.max(1, Math.trunc(next)));
                        }
                      }}
                      step={1}
                      type="number"
                      value={deriveSimulationTicks}
                    />
                  </EditorField>
                </div>
                <ClassicyButton
                  className={`${CLASSICY_MAP_SIDEBAR_BUTTON_CLASS} rounded-lg px-[0.55rem] py-[0.4rem] font-semibold`}
                  onClick={() => {
                    closeToolVariantContextMenu();
                    dispatch({
                      type: 'derive-map-simulation',
                      ticks: deriveSimulationTicks,
                    });
                  }}
                  type="button"
                >
                  Derive simulation
                </ClassicyButton>
                <small className="text-sm text-[var(--color-system-07)]">
                  Recomputes derived states (power, traffic/road classes, bridges, smoke/radar)
                  without zone growth/disasters.
                </small>
              </ClassicyMessageSurface>
            </ClassicyMessageSurface>
          </div>
        ) : (
          <ClassicyMessageSurface className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-[0.65rem] p-2">
            <EditorField className="gap-[0.2rem]">
              <span className="text-sm font-semibold text-[var(--color-system-08)]">Find tile</span>
              <input
                onChange={(event) => {
                  setExactTileSearchQuery(event.currentTarget.value);
                }}
                placeholder="Filter by id, Micropolis name, or label"
                spellCheck={false}
                type="text"
                value={exactTileSearchQuery}
              />
            </EditorField>
            <ClassicyCheckboxField
              checked={exactTileNamedOnly}
              label="Named tiles only"
              onChange={(event) => {
                setExactTileNamedOnly(event.currentTarget.checked);
              }}
            />
            <ClassicyMessageSurface className="min-h-0 overflow-y-auto p-[0.35rem]">
              {exactTileBrushEntries.length === 0 ? (
                <p className="m-0 px-[0.35rem] py-[0.5rem] text-sm text-[var(--color-system-07)]">
                  No tiles match that filter.
                </p>
              ) : (
                <div
                  className="grid grid-cols-4 gap-[0.45rem]"
                  role="list"
                  aria-label="Exact tiles"
                >
                  {exactTileBrushEntries.map((entry) => {
                    const isActive = entry.tileId === exactTileBrushTileId;
                    const micropolisName = entry.originalNames[0] ?? 'UNNAMED';
                    return (
                      <ClassicyButton
                        active={isActive}
                        activeClassName={CLASSICY_MAP_SIDEBAR_BUTTON_ACTIVE_CLASS}
                        aria-label={entry.title}
                        aria-pressed={isActive}
                        className={`${CLASSICY_MAP_SIDEBAR_BUTTON_CLASS} grid h-[5.25rem] w-full justify-items-center rounded-lg px-[0.2rem] py-[0.25rem]`}
                        key={entry.tileId}
                        onClick={() => {
                          closeToolVariantContextMenu();
                          setExactTileBrushTileId(entry.tileId);
                        }}
                        role="listitem"
                        title={entry.title}
                        type="button"
                      >
                        {zoneAtlasSource === undefined ? (
                          <span className="text-[0.8rem] font-semibold text-[var(--color-system-07)]">
                            {entry.tileId}
                          </span>
                        ) : (
                          <MapFinalSingleTileSprite
                            atlasCanonicalIdentityKey={zoneAtlasCanonicalIdentityKey}
                            atlasSpriteSheetUrl={zoneAtlasSource.spriteSheetUrl}
                            scale={2}
                            tileId={entry.tileId}
                          />
                        )}
                        <span className="max-w-full truncate text-[0.66rem] font-semibold leading-none text-[var(--color-system-08)]">
                          {micropolisName}
                        </span>
                      </ClassicyButton>
                    );
                  })}
                </div>
              )}
            </ClassicyMessageSurface>
          </ClassicyMessageSurface>
        )}
      </ClassicyPanelChrome>

      <div className="min-h-0 bg-[#0b1020]">
        <MapCanvas
          cameraPanExtraMaxOffsetXPx={rightSidebarOverlayWidthPx}
          dragPlacementEnabled={
            sidebarMode === 'all-tiles' ||
            activeBrushFamily === 'base' ||
            (activeBrushFamily === 'tools' && activeMapFinalToolSpec.size === 1)
          }
          hoverPreview={
            sidebarMode === 'all-tiles'
              ? SCENARIO_MAP_FINAL_EXACT_TILE_HOVER_PREVIEW
              : activeBrushFamily === 'base'
                ? activeSmartBaseHoverPreview
                : activeBrushFamily === 'tools' && !isScenarioMapFinalPlayableToolId(activeTool)
                  ? {
                      size: activeMapFinalToolSpec.size,
                      offset: activeMapFinalToolSpec.offset,
                      pendingColor: activeMapFinalToolSpec.pendingColor,
                    }
                  : undefined
          }
          hoverTool={
            sidebarMode === 'all-tiles'
              ? undefined
              : activeBrushFamily === 'zones'
                ? activeZoneKind
                : activeBrushFamily === 'tools' && isScenarioMapFinalPlayableToolId(activeTool)
                  ? activeTool
                  : undefined
          }
          mapState={runtimeMapState}
          tileOverlayResolver={isCreatorSidebarMode ? mapFinalBaseTileOverlayResolver : undefined}
          onTileClick={(x, y) => {
            if (sidebarMode === 'all-tiles') {
              dispatch({
                type: 'paint-map-tile',
                x,
                y,
                tileWord: exactTileBrushTileId,
                terrainRecomputeMode,
              });
              return;
            }

            if (activeBrushFamily === 'base') {
              if (activeSmartBaseBrush.id === 'forest') {
                const forestPoints = getScenarioMapFinalForestBrushPoints(
                  { x, y },
                  {
                    width: bundle.map.width,
                    height: bundle.map.height,
                  },
                );
                const lastPointIndex = forestPoints.length - 1;
                for (const [pointIndex, point] of forestPoints.entries()) {
                  dispatch({
                    type: 'paint-map-base-tile',
                    x: point.x,
                    y: point.y,
                    baseTileId: activeSmartBaseBrush.tileId,
                    preserveFlags: false,
                    terrainRecomputeMode:
                      mapEditor.autoSmoothingEnabled && pointIndex === lastPointIndex
                        ? 'global'
                        : 'off',
                  });
                }
                return;
              }

              dispatch({
                type: 'paint-map-base-tile',
                x,
                y,
                baseTileId: activeSmartBaseBrush.tileId,
                preserveFlags: false,
                terrainRecomputeMode,
              });
              return;
            }

            if (activeBrushFamily === 'tools') {
              if (activeTool === 'park') {
                const currentTileWord = readScenarioEditorMapTileWord(bundle, { x, y });
                if (currentTileWord !== 0) {
                  return;
                }
                const parkTileWord = resolveScenarioMapFinalParkTileWord(parkBrushMode, { x, y });
                dispatch({
                  type: 'paint-map-tile',
                  x,
                  y,
                  tileWord: parkTileWord,
                  terrainRecomputeMode,
                });
                return;
              }

              if (activeTool === 'house') {
                const canPaintHouse = canScenarioMapFinalPaintHouseAt(bundle, { x, y }, (point) =>
                  readScenarioEditorMapTileWord(bundle, point),
                );
                if (!canPaintHouse) {
                  return;
                }
                const houseTileWord = resolveScenarioMapFinalHouseTileWord(houseBrushTileId, {
                  x,
                  y,
                });
                dispatch({
                  type: 'paint-map-tile',
                  x,
                  y,
                  tileWord: houseTileWord,
                  terrainRecomputeMode,
                });
                return;
              }

              const specialZoneKind = toScenarioMapFinalSpecialZoneKind(activeTool);
              if (specialZoneKind !== null) {
                dispatch({
                  type: 'apply-map-special-zone',
                  x,
                  y,
                  zone: specialZoneKind,
                  terrainRecomputeMode,
                });
                return;
              }

              if (isScenarioMapFinalPlayableToolId(activeTool)) {
                dispatch({
                  type: 'apply-map-tool',
                  tool: activeTool,
                  x,
                  y,
                  terrainRecomputeMode,
                });
              }
              return;
            }

            if (activeZoneOption.kind === 'fresh') {
              dispatch({
                type: 'apply-map-tool',
                tool: SCENARIO_MAP_FINAL_ZONE_TOOL_BY_KIND[activeZoneKind],
                x,
                y,
                terrainRecomputeMode,
              });
              return;
            }
            dispatch({
              type: 'apply-map-zone-level',
              x,
              y,
              zone: activeZoneKind,
              level: activeZoneOption.densityLevel,
              value: activeZoneOption.landValueClass,
              terrainRecomputeMode,
            });
          }}
          pendingTools={[]}
          realtimeObjects={[]}
          tileSize={16}
          tilesetName="classic"
        />
      </div>
    </section>
  );
}

/**
 * Resolve a bounded forest-stamp footprint around one click.
 * Not from Micropolis C: editor-only UX helper that writes a small tree cluster so
 * `SmoothTrees` in `ref/micropolis/src/sim/s_gen.c` keeps visible forest output.
 */
function getScenarioMapFinalForestBrushPoints(
  center: { x: number; y: number },
  options: { width: number; height: number },
): readonly { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const offsets = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ] as const;
  for (const offset of offsets) {
    const x = center.x + offset.x;
    const y = center.y + offset.y;
    if (x < 0 || x >= options.width || y < 0 || y >= options.height) {
      continue;
    }
    points.push({ x, y });
  }
  return points;
}

/**
 * Render one single-tile preview from the classic map tile atlas.
 * Mirrors tile-id sprite lookup from `MemDrawBeegMapRect` in
 * `ref/micropolis/src/sim/g_bigmap.c`; parity difference: sidebar swatch rendering.
 */
function MapFinalSingleTileSprite(options: {
  readonly atlasCanonicalIdentityKey: ReturnType<
    typeof resolveRuntimeTilesetBaseAtlasCanonicalIdentityKey
  >;
  readonly atlasSpriteSheetUrl: string;
  readonly tileId: number;
  readonly scale?: number;
}) {
  const { atlasCanonicalIdentityKey, atlasSpriteSheetUrl, tileId, scale = 1 } = options;
  const sprite = lookupTileSpriteRectByTileId(tileId, {
    atlasCanonicalIdentityKey,
  });

  return (
    <span
      className="relative block overflow-hidden"
      style={{
        width: `${sprite.sourceWidth * scale}px`,
        height: `${sprite.sourceHeight * scale}px`,
      }}
    >
      <span
        className="absolute left-0 top-0 block [image-rendering:pixelated] [image-rendering:crisp-edges]"
        style={{
          backgroundImage: `url("${atlasSpriteSheetUrl}")`,
          backgroundPosition: `${-sprite.sourceX}px ${-sprite.sourceY}px`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: `${sprite.sourceWidth}px`,
          height: `${sprite.sourceHeight}px`,
        }}
      />
    </span>
  );
}

/**
 * Render one zone-option tile preview from the classic map tile atlas.
 * Mirrors tile-id sprite lookup from `MemDrawBeegMapRect` in
 * `ref/micropolis/src/sim/g_bigmap.c`; parity difference: CSS sprite swatch in sidebar UI.
 */
function MapFinalZoneTileSprite(options: {
  readonly atlasCanonicalIdentityKey: ReturnType<
    typeof resolveRuntimeTilesetBaseAtlasCanonicalIdentityKey
  >;
  readonly atlasSpriteSheetUrl: string;
  readonly tileIds: readonly number[];
}) {
  const { atlasCanonicalIdentityKey, atlasSpriteSheetUrl, tileIds } = options;

  return (
    <span className="grid h-12 w-12 grid-cols-3 grid-rows-3 [image-rendering:pixelated] [image-rendering:crisp-edges]">
      {tileIds.map((tileId, index) => {
        const sprite = lookupTileSpriteRectByTileId(tileId, {
          atlasCanonicalIdentityKey,
        });
        return (
          <span
            className="block bg-no-repeat [image-rendering:pixelated] [image-rendering:crisp-edges]"
            key={`${tileId}:${index}`}
            style={{
              backgroundImage: `url("${atlasSpriteSheetUrl}")`,
              backgroundPosition: `${-sprite.sourceX}px ${-sprite.sourceY}px`,
              width: `${sprite.sourceWidth}px`,
              height: `${sprite.sourceHeight}px`,
            }}
          />
        );
      })}
    </span>
  );
}
