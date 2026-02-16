import {
  ClassicyMenuItemButton,
  ClassicyMenuPanel,
  getAllThemes,
  getThemeVars,
} from '@city/classicyui';
import { Tile, TileFlag, TileMask } from '@city/sim-core';
import { type CSSProperties, useEffect, useMemo, useReducer, useRef, useState } from 'react';

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
  findScenarioEditorMapNamedBaseTileById,
  findScenarioEditorMapNamedBaseTileByName,
  getScenarioEditorMapNamedBaseTiles,
  getScenarioEditorMapTileWords,
  getScenarioEditorMapZoneMaxLevel,
  getScenarioEditorMapZoneMaxValue,
  isScenarioEditorMapTool,
  isScenarioEditorMapZoneKind,
  normalizeScenarioEditorBaseTileId,
  normalizeScenarioEditorMapZoneLevel,
  normalizeScenarioEditorMapZoneValue,
  normalizeScenarioEditorTileWord,
  readScenarioEditorMapTileWord,
  type ScenarioEditorMapSpecialZoneKind,
  type ScenarioEditorMapZoneKind,
} from '../state/editor-map.ts';
import { createScenarioEditorRuntimeMapStateWithOptions } from '../state/editor-map-runtime.ts';
import { useScenarioEditorDispatch, useScenarioEditorState } from '../state/editor-state.tsx';
import { EditorCard, EditorStatsGrid } from './-editor-ui.tsx';

const BASE_TILE_PRESETS = [
  { label: 'DIRT', source: 'DIRT=0', tileId: Tile.DIRT },
  { label: 'RIVER', source: 'RIVER=2', tileId: Tile.RIVER },
  { label: 'REDGE', source: 'REDGE=3', tileId: Tile.REDGE },
  { label: 'CHANNEL', source: 'CHANNEL=4', tileId: Tile.CHANNEL },
  { label: 'FOREST', source: 'WOODS=37', tileId: Tile.WOODS },
] as const;
const BASE_TILE_NAME_OPTIONS = getScenarioEditorMapNamedBaseTiles();
const TILE_WORD_NAME_OPTIONS = [...BASE_TILE_NAME_OPTIONS].sort(
  (left, right) => left.tileId - right.tileId,
);

const SCENARIO_EDITOR_MAP_BRUSH_MODES = ['tool', 'zone-level', 'base-tile', 'tile-word'] as const;
type ScenarioEditorMapBrushMode = (typeof SCENARIO_EDITOR_MAP_BRUSH_MODES)[number];

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
    label: `Class ${Math.floor(index / 3)} / Variant ${index % 3}`,
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
const SCENARIO_EDITOR_BASE_TILE_HOVER_PREVIEW: MapCanvasHoverPreviewSpec = {
  size: 1,
  offset: 0,
  pendingColor: '#6e7781',
};
const SCENARIO_MAP_FINAL_TREE_TILE_MAX_FOR_SMOOTHING = 39;
const SCENARIO_MAP_FINAL_CONTEXT_MENU_VIEWPORT_MARGIN_PX = 8;
const SCENARIO_MAP_FINAL_PARK_CONTEXT_MENU_WIDTH_PX = 176;
const SCENARIO_MAP_FINAL_PARK_CONTEXT_MENU_HEIGHT_PX = 210;
const SCENARIO_MAP_FINAL_HOUSE_CONTEXT_MENU_WIDTH_PX = 196;
const SCENARIO_MAP_FINAL_HOUSE_CONTEXT_MENU_HEIGHT_PX = 360;

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
 */
export function ScenarioMapFinalWorkbench() {
  const { bundle } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const [brushSelection, dispatchBrushSelection] = useReducer(
    reduceScenarioMapFinalBrushSelection,
    SCENARIO_MAP_FINAL_DEFAULT_BRUSH_SELECTION_STATE,
  );
  const [showBaseClassOverlay, setShowBaseClassOverlay] = useState(true);
  const [parkBrushMode, setParkBrushMode] = useState<ScenarioMapFinalParkBrushMode>('auto');
  const [houseBrushTileId, setHouseBrushTileId] = useState<number | null>(null);
  const [deriveSimulationTicks, setDeriveSimulationTicks] = useState<number>(
    SCENARIO_MAP_FINAL_DERIVE_SIM_TICK_COUNT_DEFAULT,
  );
  const [toolVariantContextMenu, setToolVariantContextMenu] = useState<{
    readonly open: boolean;
    readonly tool: 'park' | 'house' | null;
    readonly x: number;
    readonly y: number;
  }>({
    open: false,
    tool: null,
    x: 0,
    y: 0,
  });
  const toolVariantContextMenuRef = useRef<HTMLDivElement | null>(null);
  const activeBrushFamily = brushSelection.activeKind;
  const activeZoneKind = brushSelection.zoneKind;
  const activeZoneOptionKey = brushSelection.zoneOptionKey;
  const activeTool = brushSelection.tool;
  const activeSmartBaseBrushId = brushSelection.baseBrushId;
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
    () => (showBaseClassOverlay ? getScenarioMapFinalBaseClassOverlayStyle : undefined),
    [showBaseClassOverlay],
  );
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
    toolVariantContextMenu.open &&
    toolVariantContextMenu.tool === 'park' &&
    activeBrushFamily === 'tools' &&
    activeTool === 'park';
  const isHouseBrushContextMenuOpen =
    toolVariantContextMenu.open &&
    toolVariantContextMenu.tool === 'house' &&
    activeBrushFamily === 'tools' &&
    activeTool === 'house';
  const isToolVariantContextMenuOpen = isParkBrushContextMenuOpen || isHouseBrushContextMenuOpen;
  function closeToolVariantContextMenu(): void {
    setToolVariantContextMenu((current) =>
      current.open
        ? {
            ...current,
            open: false,
            tool: null,
          }
        : current,
    );
  }

  useEffect(() => {
    if (!isToolVariantContextMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) {
        closeToolVariantContextMenu();
        return;
      }
      if (toolVariantContextMenuRef.current?.contains(target)) {
        return;
      }
      closeToolVariantContextMenu();
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') {
        return;
      }
      closeToolVariantContextMenu();
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', closeToolVariantContextMenu);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', closeToolVariantContextMenu);
    };
  }, [isToolVariantContextMenuOpen]);

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
      className="grid h-full min-h-0 grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] overflow-hidden bg-gray-300 text-[var(--color-black)] [font-family:var(--ui-font),sans-serif] [font-size:var(--ui-font-size)] max-[980px]:grid-cols-1 max-[980px]:grid-rows-[auto_minmax(0,1fr)]"
      aria-label="Scenario map final workbench"
      style={mapFinalRuntimeTheme}
    >
      <aside className="grid min-h-0 content-start gap-4 overflow-y-auto border-r border-[#b6bcc6] bg-gray-200 p-4 max-[980px]:max-h-[48vh] max-[980px]:border-b max-[980px]:border-r-0">
        <section
          className={`grid gap-[0.65rem] rounded-[10px] border border-transparent p-[0.45rem] ${
            activeBrushFamily === 'base' ? 'border-[#0969da] bg-[rgba(221,244,255,0.5)]' : ''
          }`}
        >
          <h2 className="m-0 text-[1.4rem] font-semibold">Base</h2>
          <div
            className="grid grid-cols-2 gap-[0.45rem]"
            role="list"
            aria-label="Smart base brushes"
          >
            {SCENARIO_MAP_FINAL_SMART_BASE_BRUSHES.map((brush) => (
              <button
                aria-pressed={activeBrushFamily === 'base' && activeSmartBaseBrushId === brush.id}
                className={`grid cursor-pointer justify-items-start gap-[0.3rem] rounded-lg border border-slate-500 bg-linear-to-b from-slate-100 to-[#e8ecef] px-[0.4rem] py-[0.35rem] text-inherit ${
                  activeBrushFamily === 'base' && activeSmartBaseBrushId === brush.id
                    ? 'border-blue-600 bg-sky-100 shadow-[inset_0_0_0_1px_#0969da]'
                    : ''
                }`}
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
                  <span className="text-[0.8rem] font-semibold text-slate-600">{brush.tileId}</span>
                ) : (
                  <MapFinalSingleTileSprite
                    atlasCanonicalIdentityKey={zoneAtlasCanonicalIdentityKey}
                    atlasSpriteSheetUrl={zoneAtlasSource.spriteSheetUrl}
                    tileId={brush.tileId}
                  />
                )}
                <span>{brush.label}</span>
              </button>
            ))}
          </div>

          <label className="flex items-center gap-[0.45rem] text-slate-600">
            <input
              className="m-0"
              checked={showBaseClassOverlay}
              onChange={(event) => {
                setShowBaseClassOverlay(event.currentTarget.checked);
              }}
              type="checkbox"
            />
            <span>Show base tile classes</span>
          </label>

          <small className="text-sm text-slate-600">
            Active smart brush: {activeSmartBaseBrush.label}. Terrain auto-smooths after edits.
          </small>
        </section>

        <section
          className={`grid gap-[0.65rem] rounded-[10px] border border-transparent p-[0.45rem] ${
            activeBrushFamily === 'zones' ? 'border-[#0969da] bg-[rgba(221,244,255,0.5)]' : ''
          }`}
        >
          <h2 className="m-0 text-[1.4rem] font-semibold">Zones</h2>
          <div
            aria-label="Zone family selector"
            className="grid grid-cols-3 overflow-hidden rounded-[10px] border border-slate-500"
            role="tablist"
          >
            {(['res', 'com', 'ind'] as const).map((zone) => (
              <button
                aria-selected={activeBrushFamily === 'zones' && zone === activeZoneKind}
                className={`cursor-pointer border-r border-slate-500 bg-slate-100 px-[0.4rem] py-2 font-semibold last:border-r-0 ${
                  activeBrushFamily === 'zones' && zone === activeZoneKind ? 'bg-sky-200' : ''
                }`}
                key={zone}
                onClick={() => {
                  closeToolVariantContextMenu();
                  dispatchBrushSelection({
                    type: 'select-zone-kind',
                    zoneKind: zone,
                  });
                }}
                role="tab"
                type="button"
              >
                {zone.toUpperCase()}
              </button>
            ))}
          </div>

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
                  <button
                    className={`flex min-h-[3.4rem] cursor-pointer items-center justify-center rounded-lg border border-slate-500 bg-linear-to-b from-slate-100 to-[#e8ecef] p-[0.2rem] text-inherit ${
                      activeBrushFamily === 'zones' && option.key === activeZoneOptionKey
                        ? 'border-blue-600 bg-sky-100 shadow-[inset_0_0_0_1px_#0969da]'
                        : ''
                    }`}
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
                      <span className="text-[0.8rem] font-semibold text-slate-600">
                        {option.tileId}
                      </span>
                    ) : (
                      <MapFinalZoneTileSprite
                        atlasCanonicalIdentityKey={zoneAtlasCanonicalIdentityKey}
                        atlasSpriteSheetUrl={zoneAtlasSource.spriteSheetUrl}
                        tileIds={option.swatchTileIds}
                      />
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <small className="text-sm text-slate-600">
            {activeZoneOption.kind === 'fresh'
              ? `${SCENARIO_MAP_FINAL_ZONE_FAMILY_LABELS[activeZoneKind]} fresh zone`
              : `Density Level ${activeZoneOption.densityLevel} / ${zoneValueClassLabel} ${activeZoneOption.landValueClass}`}
          </small>
        </section>

        <section
          className={`grid gap-[0.65rem] rounded-[10px] border border-transparent p-[0.45rem] ${
            activeBrushFamily === 'tools' ? 'border-[#0969da] bg-[rgba(221,244,255,0.5)]' : ''
          }`}
        >
          <h2 className="m-0 text-[1.4rem] font-semibold">Tools</h2>
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
                <button
                  aria-label={spec.label}
                  aria-pressed={active}
                  className={`grid h-[3.8rem] w-full cursor-pointer place-items-center rounded-lg border border-slate-500 bg-linear-to-b from-slate-100 to-[#e8ecef] p-[0.2rem] text-inherit ${
                    active ? 'border-blue-600 bg-sky-100 shadow-[inset_0_0_0_1px_#0969da]' : ''
                  }`}
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
                    const menuSize =
                      spec.tool === 'park'
                        ? {
                            width: SCENARIO_MAP_FINAL_PARK_CONTEXT_MENU_WIDTH_PX,
                            height: SCENARIO_MAP_FINAL_PARK_CONTEXT_MENU_HEIGHT_PX,
                          }
                        : {
                            width: SCENARIO_MAP_FINAL_HOUSE_CONTEXT_MENU_WIDTH_PX,
                            height: SCENARIO_MAP_FINAL_HOUSE_CONTEXT_MENU_HEIGHT_PX,
                          };
                    const position = resolveScenarioMapFinalContextMenuPosition(
                      {
                        x: event.clientX,
                        y: event.clientY,
                      },
                      menuSize,
                      {
                        width: window.innerWidth,
                        height: window.innerHeight,
                      },
                    );
                    dispatchBrushSelection({
                      type: 'select-tool',
                      tool: spec.tool,
                    });
                    setToolVariantContextMenu({
                      open: true,
                      tool: spec.tool,
                      x: position.x,
                      y: position.y,
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
                    <span className="text-[0.8rem] font-semibold text-slate-600">
                      {spec.previewTileId}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <small className="text-sm text-slate-600">
            Park mode: {activeParkBrushModeLabel}. House mode: {activeHouseBrushModeLabel}. Right
            click Park/House to change.
          </small>
          {isToolVariantContextMenuOpen ? (
            <div
              className="fixed z-50"
              ref={toolVariantContextMenuRef}
              style={{
                left: `${toolVariantContextMenu.x}px`,
                top: `${toolVariantContextMenu.y}px`,
              }}
            >
              <ClassicyMenuPanel className="grid max-h-[min(70vh,20rem)] w-[11rem] gap-0.5 overflow-auto p-1">
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
              </ClassicyMenuPanel>
            </div>
          ) : null}

          <div className="grid gap-[0.45rem] rounded-lg border border-slate-400 bg-slate-100 p-[0.45rem]">
            <div className="grid gap-[0.3rem]">
              <label className="grid gap-[0.2rem]">
                <span className="text-sm font-semibold text-slate-700">
                  Derive simulation ticks
                </span>
                <input
                  className="rounded border border-slate-500 px-[0.45rem] py-[0.25rem]"
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
              </label>
            </div>
            <button
              className="cursor-pointer rounded border border-slate-500 bg-linear-to-b from-slate-100 to-[#e8ecef] px-[0.55rem] py-[0.4rem] font-semibold text-inherit"
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
            </button>
            <small className="text-sm text-slate-600">
              Recomputes derived states (power, traffic/road classes, bridges, smoke/radar) without
              zone growth/disasters.
            </small>
          </div>
        </section>
      </aside>

      <div className="min-h-0 bg-[#0b1020]">
        <MapCanvas
          dragPlacementEnabled={
            activeBrushFamily === 'base' ||
            (activeBrushFamily === 'tools' && activeMapFinalToolSpec.size === 1)
          }
          hoverPreview={
            activeBrushFamily === 'base'
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
            activeBrushFamily === 'zones'
              ? activeZoneKind
              : activeBrushFamily === 'tools' && isScenarioMapFinalPlayableToolId(activeTool)
                ? activeTool
                : undefined
          }
          mapState={runtimeMapState}
          tileOverlayResolver={mapFinalBaseTileOverlayResolver}
          onTileClick={(x, y) => {
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
                    terrainRecomputeMode: pointIndex === lastPointIndex ? 'global' : 'off',
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
                terrainRecomputeMode: 'global',
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
                  terrainRecomputeMode: 'global',
                });
                return;
              }

              if (activeTool === 'house') {
                const houseTileWord = resolveScenarioMapFinalHouseTileWord(houseBrushTileId, {
                  x,
                  y,
                });
                dispatch({
                  type: 'paint-map-tile',
                  x,
                  y,
                  tileWord: houseTileWord,
                  terrainRecomputeMode: 'global',
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
                });
                return;
              }

              if (isScenarioMapFinalPlayableToolId(activeTool)) {
                dispatch({
                  type: 'apply-map-tool',
                  tool: activeTool,
                  x,
                  y,
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
 * Clamp one context-menu anchor to remain fully visible in the viewport.
 * Not from Micropolis C: editor-only browser layout helper for fixed-position menus.
 */
function resolveScenarioMapFinalContextMenuPosition(
  anchor: { x: number; y: number },
  menuSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
): { x: number; y: number } {
  const maxX = Math.max(
    SCENARIO_MAP_FINAL_CONTEXT_MENU_VIEWPORT_MARGIN_PX,
    viewportSize.width - menuSize.width - SCENARIO_MAP_FINAL_CONTEXT_MENU_VIEWPORT_MARGIN_PX,
  );
  const maxY = Math.max(
    SCENARIO_MAP_FINAL_CONTEXT_MENU_VIEWPORT_MARGIN_PX,
    viewportSize.height - menuSize.height - SCENARIO_MAP_FINAL_CONTEXT_MENU_VIEWPORT_MARGIN_PX,
  );
  return {
    x: Math.min(Math.max(anchor.x, SCENARIO_MAP_FINAL_CONTEXT_MENU_VIEWPORT_MARGIN_PX), maxX),
    y: Math.min(Math.max(anchor.y, SCENARIO_MAP_FINAL_CONTEXT_MENU_VIEWPORT_MARGIN_PX), maxY),
  };
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
}) {
  const { atlasCanonicalIdentityKey, atlasSpriteSheetUrl, tileId } = options;
  const sprite = lookupTileSpriteRectByTileId(tileId, {
    atlasCanonicalIdentityKey,
  });

  return (
    <span
      className="block [image-rendering:pixelated] [image-rendering:crisp-edges]"
      style={{
        backgroundImage: `url("${atlasSpriteSheetUrl}")`,
        backgroundPosition: `${-sprite.sourceX}px ${-sprite.sourceY}px`,
        width: `${sprite.sourceWidth}px`,
        height: `${sprite.sourceHeight}px`,
      }}
    />
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

/**
 * Scenario map-editing card with Micropolis map-canvas rendering and C-parity tool placement.
 * Reuses web `MapCanvas` sprite/camera input from `apps/web` and mirrors tile mutation paths from
 * `DoTool`/`do_tool` plus `SimCmdTile`/`SimCmdFill` in `ref/micropolis/src/sim/w_tool.c` and
 * `ref/micropolis/src/sim/w_sim.c`.
 */
export function ScenarioMapEditorCard() {
  const { bundle, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const [brushMode, setBrushMode] = useState<ScenarioEditorMapBrushMode>('tool');
  const [activeTool, setActiveTool] = useState<PlayableToolName>('road');
  const [activeZoneKind, setActiveZoneKind] = useState<ScenarioEditorMapZoneKind>('res');
  const [activeZoneLevel, setActiveZoneLevel] = useState<number>(1);
  const [activeZoneValue, setActiveZoneValue] = useState<number>(0);
  const [activeBaseTileId, setActiveBaseTileId] = useState<number>(Tile.DIRT);
  const [preserveBaseTileFlags, setPreserveBaseTileFlags] = useState(true);
  const [activeTileWord, setActiveTileWord] = useState<number>(0);
  const activeBaseTileName = useMemo(
    () => findScenarioEditorMapNamedBaseTileById(activeBaseTileId)?.name ?? '',
    [activeBaseTileId],
  );
  const tileWords = useMemo(() => getScenarioEditorMapTileWords(bundle), [bundle]);
  const runtimeMapState = useMemo(
    () =>
      createScenarioEditorRuntimeMapStateWithOptions(bundle, {
        // Editor-only UX: show unpowered indicator continuously (no blink).
        blinkUnpoweredZoneCenter: true,
      }),
    [bundle],
  );
  const activeToolSpec = useMemo(() => getPlayableToolSpec(activeTool), [activeTool]);
  const activeZoneMaxLevel = useMemo(
    () => getScenarioEditorMapZoneMaxLevel(activeZoneKind),
    [activeZoneKind],
  );
  const activeZoneMaxValue = useMemo(
    () => getScenarioEditorMapZoneMaxValue(activeZoneKind),
    [activeZoneKind],
  );
  const activeZoneValueClassLabel = useMemo(
    () => getScenarioMapZoneValueClassLabel(activeZoneKind),
    [activeZoneKind],
  );
  const dragPlacementEnabled =
    brushMode === 'base-tile' ||
    brushMode === 'tile-word' ||
    (brushMode === 'tool' && activeToolSpec.size === 1);

  const fillLabel =
    brushMode === 'base-tile'
      ? 'Fill Map With Base Tile'
      : brushMode === 'tile-word'
        ? 'Fill Map With Tile Word'
        : brushMode === 'zone-level'
          ? 'Fill Disabled in Zone Level Mode'
          : 'Fill Disabled in Tool Mode';
  const fillDisabled = brushMode === 'tool' || brushMode === 'zone-level';

  return (
    <EditorCard aria-label="Scenario map editor" className="max-w-[64rem]">
      <h1>Scenario Map</h1>
      <p>
        Reuses the runtime map canvas (sprite art, zoom/pan, and tool footprints) while allowing
        direct scenario authoring: full Micropolis tools, zone-level placement, and base-tile
        painting (dirt/water/forest/etc.). Terrain smoothing recomputes after each map edit.
      </p>

      <div className="mb-4 grid gap-3">
        <label className="grid gap-[0.3rem] [&_input:not([type=checkbox])]:rounded [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-slate-500 [&_input:not([type=checkbox])]:px-[0.55rem] [&_input:not([type=checkbox])]:py-[0.45rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem]">
          <span>Brush Mode</span>
          <select
            onChange={(event) => {
              const selectedMode = event.currentTarget.value as ScenarioEditorMapBrushMode;
              if (SCENARIO_EDITOR_MAP_BRUSH_MODES.includes(selectedMode)) {
                setBrushMode(selectedMode);
              }
            }}
            value={brushMode}
          >
            <option value="tool">Micropolis Tool</option>
            <option value="zone-level">Zone Level Brush</option>
            <option value="base-tile">Base Tile Brush</option>
            <option value="tile-word">Raw Tile Word Brush</option>
          </select>
        </label>

        {brushMode === 'tool' ? (
          <div className="grid gap-[0.6rem]">
            <label className="grid gap-[0.3rem] [&_input:not([type=checkbox])]:rounded [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-slate-500 [&_input:not([type=checkbox])]:px-[0.55rem] [&_input:not([type=checkbox])]:py-[0.45rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem]">
              <span>Active Tool</span>
              <select
                onChange={(event) => {
                  const selectedTool = event.currentTarget.value;
                  if (isScenarioEditorMapTool(selectedTool)) {
                    setActiveTool(selectedTool);
                  }
                }}
                value={activeTool}
              >
                {PLAYABLE_TOOL_SPECS.map((spec) => (
                  <option key={spec.tool} value={spec.tool}>
                    {spec.label}
                  </option>
                ))}
              </select>
              <small className="text-sm text-slate-600">
                Tool footprint {activeToolSpec.size}x{activeToolSpec.size}, base cost $
                {activeToolSpec.baseCost}.
              </small>
            </label>

            <div
              className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-[0.45rem]"
              role="list"
              aria-label="Micropolis map tools"
            >
              {PLAYABLE_TOOL_SPECS.map((spec) => (
                <button
                  aria-pressed={activeTool === spec.tool}
                  className={`cursor-pointer rounded border border-slate-500 bg-slate-100 px-[0.55rem] py-[0.35rem] text-left ${
                    activeTool === spec.tool ? 'border-blue-600 bg-sky-100' : ''
                  }`}
                  key={spec.tool}
                  onClick={() => {
                    setActiveTool(spec.tool);
                  }}
                  role="listitem"
                  type="button"
                >
                  {spec.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {brushMode === 'zone-level' ? (
          <div className="grid gap-[0.6rem]">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3 [&_label]:grid [&_label]:gap-[0.3rem]">
              <label className="grid gap-[0.3rem] [&_input:not([type=checkbox])]:rounded [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-slate-500 [&_input:not([type=checkbox])]:px-[0.55rem] [&_input:not([type=checkbox])]:py-[0.45rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem]">
                <span>Zone Type</span>
                <select
                  onChange={(event) => {
                    const zone = event.currentTarget.value;
                    if (!isScenarioEditorMapZoneKind(zone)) {
                      return;
                    }
                    setActiveZoneKind(zone);
                    setActiveZoneLevel((currentLevel) =>
                      normalizeScenarioEditorMapZoneLevel(zone, currentLevel),
                    );
                    setActiveZoneValue((currentValue) =>
                      normalizeScenarioEditorMapZoneValue(zone, currentValue),
                    );
                  }}
                  value={activeZoneKind}
                >
                  <option value="res">Residential</option>
                  <option value="com">Commercial</option>
                  <option value="ind">Industrial</option>
                </select>
              </label>

              <label className="grid gap-[0.3rem] [&_input:not([type=checkbox])]:rounded [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-slate-500 [&_input:not([type=checkbox])]:px-[0.55rem] [&_input:not([type=checkbox])]:py-[0.45rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem]">
                <span>Density Level</span>
                <input
                  max={activeZoneMaxLevel}
                  min={1}
                  onChange={(event) => {
                    setActiveZoneLevel(
                      normalizeScenarioEditorMapZoneLevel(
                        activeZoneKind,
                        Number(event.currentTarget.value),
                      ),
                    );
                  }}
                  type="number"
                  value={activeZoneLevel}
                />
              </label>

              <label className="grid gap-[0.3rem] [&_input:not([type=checkbox])]:rounded [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-slate-500 [&_input:not([type=checkbox])]:px-[0.55rem] [&_input:not([type=checkbox])]:py-[0.45rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem]">
                <span>{activeZoneValueClassLabel}</span>
                <input
                  max={activeZoneMaxValue}
                  min={0}
                  onChange={(event) => {
                    setActiveZoneValue(
                      normalizeScenarioEditorMapZoneValue(
                        activeZoneKind,
                        Number(event.currentTarget.value),
                      ),
                    );
                  }}
                  type="number"
                  value={activeZoneValue}
                />
              </label>
            </div>
            <small className="text-sm text-slate-600">
              {`Places direct zone variants using ResPlop/ComPlop/IndPlop formulas (1-based level, value 0..${activeZoneMaxValue} for ${activeZoneKind.toUpperCase()}).`}
            </small>
          </div>
        ) : null}

        {brushMode === 'base-tile' ? (
          <>
            <label className="grid gap-[0.3rem] [&_input:not([type=checkbox])]:rounded [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-slate-500 [&_input:not([type=checkbox])]:px-[0.55rem] [&_input:not([type=checkbox])]:py-[0.45rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem]">
              <span>Named Base Tile</span>
              <select
                onChange={(event) => {
                  const namedTile = findScenarioEditorMapNamedBaseTileByName(
                    event.currentTarget.value,
                  );
                  if (namedTile === undefined) {
                    return;
                  }
                  setActiveBaseTileId(namedTile.tileId);
                }}
                value={activeBaseTileName}
              >
                {activeBaseTileName === '' ? (
                  <option value="">Custom ID ({activeBaseTileId})</option>
                ) : null}
                {BASE_TILE_NAME_OPTIONS.map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.label} ({entry.name}={entry.tileId})
                  </option>
                ))}
              </select>
              <small className="text-sm text-slate-600">
                Full tile-name list from classic `sim.h` tile-id constants.
              </small>
            </label>

            <label className="grid gap-[0.3rem] [&_input:not([type=checkbox])]:rounded [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-slate-500 [&_input:not([type=checkbox])]:px-[0.55rem] [&_input:not([type=checkbox])]:py-[0.45rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem]">
              <span>Base Tile ID</span>
              <input
                max={1023}
                min={0}
                onChange={(event) => {
                  setActiveBaseTileId(
                    normalizeScenarioEditorBaseTileId(Number(event.currentTarget.value)),
                  );
                }}
                type="number"
                value={activeBaseTileId}
              />
              <small className="text-sm text-slate-600">
                Writes low tile-id bits (`LOMASK=1023`).
              </small>
            </label>

            <div className="flex flex-wrap gap-2">
              {BASE_TILE_PRESETS.map((preset) => (
                <button
                  className="cursor-pointer rounded border border-slate-500 bg-slate-100 px-[0.6rem] py-[0.35rem] text-inherit disabled:cursor-not-allowed disabled:opacity-65"
                  key={preset.label}
                  onClick={() => {
                    setActiveBaseTileId(preset.tileId);
                  }}
                  type="button"
                >
                  {preset.label} ({preset.source})
                </button>
              ))}
            </div>

            <label className="grid gap-[0.3rem] [&_input:not([type=checkbox])]:rounded [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-slate-500 [&_input:not([type=checkbox])]:px-[0.55rem] [&_input:not([type=checkbox])]:py-[0.45rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem]">
              <span>Preserve Existing Flags</span>
              <input
                className="justify-self-start"
                checked={preserveBaseTileFlags}
                onChange={(event) => {
                  setPreserveBaseTileFlags(event.currentTarget.checked);
                }}
                type="checkbox"
              />
              <small className="text-sm text-slate-600">
                Keep tile status bits (zone/power/bulldoze flags) while replacing base tile id.
              </small>
            </label>
          </>
        ) : null}

        {brushMode === 'tile-word' ? (
          <label className="grid gap-[0.3rem] [&_input:not([type=checkbox])]:rounded [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-slate-500 [&_input:not([type=checkbox])]:px-[0.55rem] [&_input:not([type=checkbox])]:py-[0.45rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem]">
            <span>Active Tile Word</span>
            <select
              onChange={(event) => {
                setActiveTileWord(
                  normalizeScenarioEditorTileWord(Number(event.currentTarget.value)),
                );
              }}
              value={activeTileWord}
            >
              {TILE_WORD_NAME_OPTIONS.map((entry) => (
                <option key={entry.name} value={entry.tileId}>
                  {entry.tileId} ({entry.name} / {entry.label})
                </option>
              ))}
            </select>
            <small className="text-sm text-slate-600">
              Stored as unsigned 16-bit map words; this picker uses named base tile words.
            </small>
          </label>
        ) : null}

        <label className="grid gap-[0.3rem] [&_input:not([type=checkbox])]:rounded [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-slate-500 [&_input:not([type=checkbox])]:px-[0.55rem] [&_input:not([type=checkbox])]:py-[0.45rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem]">
          <span>Map Navigation</span>
          <small className="text-sm text-slate-600">
            Left click paints/places. Mouse wheel pans. `Ctrl`/`Cmd` + wheel zooms. Middle-button
            drag also pans.
          </small>
        </label>

        <button
          className="cursor-pointer rounded border border-slate-500 bg-slate-100 px-[0.6rem] py-[0.35rem] text-inherit disabled:cursor-not-allowed disabled:opacity-65 justify-self-start"
          disabled={fillDisabled}
          onClick={() => {
            if (brushMode === 'base-tile') {
              dispatch({
                type: 'fill-map-base-tile',
                baseTileId: activeBaseTileId,
                preserveFlags: preserveBaseTileFlags,
              });
              return;
            }
            if (brushMode === 'tile-word') {
              dispatch({ type: 'fill-map', tileWord: activeTileWord });
            }
          }}
          type="button"
        >
          {fillLabel}
        </button>
      </div>

      <div className="mb-4 h-[min(75vh,46rem)] w-[min(100%,72rem)] overflow-hidden rounded-md border border-slate-300 bg-[#0b1020]">
        <MapCanvas
          dragPlacementEnabled={dragPlacementEnabled}
          hoverPreview={
            brushMode === 'base-tile' ? SCENARIO_EDITOR_BASE_TILE_HOVER_PREVIEW : undefined
          }
          hoverTool={
            brushMode === 'tool'
              ? activeTool
              : brushMode === 'zone-level'
                ? activeZoneKind
                : undefined
          }
          mapState={runtimeMapState}
          onTileClick={(x, y) => {
            if (brushMode === 'tool') {
              dispatch({ type: 'apply-map-tool', tool: activeTool, x, y });
              return;
            }
            if (brushMode === 'zone-level') {
              dispatch({
                type: 'apply-map-zone-level',
                x,
                y,
                zone: activeZoneKind,
                level: activeZoneLevel,
                value: activeZoneValue,
              });
              return;
            }
            if (brushMode === 'base-tile') {
              dispatch({
                type: 'paint-map-base-tile',
                x,
                y,
                baseTileId: activeBaseTileId,
                preserveFlags: preserveBaseTileFlags,
              });
              return;
            }
            dispatch({
              type: 'paint-map-tile',
              x,
              y,
              tileWord: activeTileWord,
            });
          }}
          pendingTools={[]}
          realtimeObjects={[]}
          tileSize={16}
          tilesetName="classic"
        />
      </div>

      <EditorStatsGrid>
        <dt>Map Size</dt>
        <dd>
          {runtimeMapState.width} x {runtimeMapState.height}
        </dd>
        <dt>Tile Count</dt>
        <dd>{tileWords.length}</dd>
        <dt>Brush Mode</dt>
        <dd>{brushMode}</dd>
        <dt>Active Brush</dt>
        <dd>
          {brushMode === 'tool'
            ? activeTool
            : brushMode === 'zone-level'
              ? `${activeZoneKind}:level-${activeZoneLevel}:value-${activeZoneValue}`
              : brushMode === 'base-tile'
                ? `base-tile:${activeBaseTileId}`
                : `tile-word:${activeTileWord}`}
        </dd>
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
      </EditorStatsGrid>
    </EditorCard>
  );
}
