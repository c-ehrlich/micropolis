import { Tile, TileMask } from '@city/sim-core';
import { createFileRoute } from '@tanstack/react-router';
import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  useMemo,
  useRef,
  useState,
} from 'react';

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
  getScenarioEditorBehaviorValidationIssue,
  isScenarioEditorBehaviorProfileKey,
  SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS,
} from '../state/editor-behavior.ts';
import {
  buildScenarioEditorStrictExport,
  getScenarioEditorExportFileName,
  type ScenarioEditorStrictExportResult,
} from '../state/editor-export.ts';
import {
  parseScenarioEditorBundleImportJson,
  type ScenarioEditorBundleImportIssue,
} from '../state/editor-import.ts';
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
  type ScenarioEditorMapZoneKind,
} from '../state/editor-map.ts';
import { createScenarioEditorRuntimeMapState } from '../state/editor-map-runtime.ts';
import {
  appendScenarioObjectiveChildPredicate,
  coerceScenarioObjectivePredicateKind,
  getScenarioEditorObjectiveValidationIssues,
  removeScenarioObjectiveChildPredicate,
  replaceScenarioObjectiveChildPredicate,
  replaceScenarioObjectiveNotChildPredicate,
  SCENARIO_EDITOR_OBJECTIVE_COMPARISONS,
  SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS,
  SCENARIO_EDITOR_OBJECTIVE_PREDICATE_KINDS,
  type ScenarioEditorObjectivePredicate,
} from '../state/editor-objective.ts';
import {
  appendScenarioEditorScriptAction,
  appendScenarioEditorScriptEvent,
  coerceScenarioEditorScriptActionKind,
  coerceScenarioEditorScriptTriggerKind,
  getScenarioEditorScriptTriggerKind,
  getScenarioEditorScriptValidationIssues,
  removeScenarioEditorScriptAction,
  removeScenarioEditorScriptEvent,
  replaceScenarioEditorAtTickTrigger,
  replaceScenarioEditorEveryTicksTrigger,
  replaceScenarioEditorScriptAction,
  replaceScenarioEditorScriptEvent,
  replaceScenarioEditorSendMessageId,
  SCENARIO_EDITOR_SCRIPT_ACTION_KINDS,
  SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS,
  type ScenarioEditorScriptAction,
  type ScenarioEditorScriptEvent,
} from '../state/editor-script.ts';
import {
  getScenarioEditorMetadataValidationIssues,
  parseScenarioEditorTagsInput,
  useScenarioEditorDispatch,
  useScenarioEditorState,
} from '../state/editor-state.tsx';

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

type ScenarioEditorOpenResult =
  | {
      readonly fileName: string;
      readonly ok: true;
    }
  | {
      readonly fileName: string;
      readonly issues: readonly ScenarioEditorBundleImportIssue[];
      readonly ok: false;
    };

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

const EDITOR_CARD_CLASSNAME =
  'max-w-[52rem] rounded-md border border-slate-300 bg-white p-4 [&>h1]:mb-3 [&>h1]:mt-0 [&>p]:mb-4 [&>p]:mt-0';
const EDITOR_MAP_CARD_CLASSNAME = `${EDITOR_CARD_CLASSNAME} max-w-[64rem]`;
const EDITOR_OBJECTIVE_CARD_CLASSNAME = `${EDITOR_CARD_CLASSNAME} max-w-[64rem]`;
const EDITOR_SCRIPT_CARD_CLASSNAME = `${EDITOR_CARD_CLASSNAME} max-w-[68rem]`;
const EDITOR_BEHAVIOR_CARD_CLASSNAME = `${EDITOR_CARD_CLASSNAME} max-w-[64rem]`;
const EDITOR_FORM_CLASSNAME = 'mb-4 grid gap-[0.9rem]';
const EDITOR_FIELD_CLASSNAME =
  'grid gap-[0.3rem] [&_input:not([type=checkbox])]:rounded [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-slate-500 [&_input:not([type=checkbox])]:px-[0.55rem] [&_input:not([type=checkbox])]:py-[0.45rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem]';
const EDITOR_FIELD_INLINE_CLASSNAME =
  'grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3 [&_label]:grid [&_label]:gap-[0.3rem]';
const EDITOR_HELP_TEXT_CLASSNAME = 'text-sm text-slate-600';
const EDITOR_ERROR_TEXT_CLASSNAME = 'text-sm text-red-700';
const EDITOR_STATS_GRID_CLASSNAME =
  'm-0 grid grid-cols-[12rem_1fr] gap-x-4 gap-y-2 [&_dt]:text-slate-600';
const EDITOR_ISSUES_PANEL_CLASSNAME =
  'mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 [&>h2]:mb-2 [&>h2]:mt-0 [&>h2]:text-base [&_ul]:m-0 [&_ul]:pl-5';
const EDITOR_PREVIEW_PANEL_CLASSNAME =
  'mt-4 [&>h2]:mb-2 [&>h2]:mt-0 [&>h2]:text-base [&_textarea]:w-full [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem] [&_textarea]:font-mono [&_textarea]:text-xs [&_textarea]:leading-[1.4]';
const EDITOR_BUTTON_CLASSNAME =
  'cursor-pointer rounded border border-slate-500 bg-slate-100 px-[0.6rem] py-[0.35rem] text-inherit disabled:cursor-not-allowed disabled:opacity-65';
const EDITOR_BUTTON_ACTIVE_CLASSNAME = 'border-blue-600 bg-sky-100';
const EDITOR_EXPORT_ACTIONS_CLASSNAME = 'mb-4 grid justify-items-start gap-2';
const EDITOR_OPEN_BUTTON_CLASSNAME =
  'cursor-pointer rounded border border-slate-500 bg-slate-100 px-3 py-[0.45rem]';
const EDITOR_EXPORT_BUTTON_CLASSNAME =
  'cursor-pointer rounded border border-blue-600 bg-sky-100 px-3 py-[0.45rem] text-[#0c2d6b]';
const SCENARIO_MAP_FINAL_WORKBENCH_CLASSNAME =
  'grid h-full min-h-0 grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] bg-gray-300 max-[980px]:grid-cols-1 max-[980px]:grid-rows-[auto_minmax(0,1fr)]';
const SCENARIO_MAP_FINAL_SIDEBAR_CLASSNAME =
  'grid content-start gap-4 overflow-auto border-r border-[#b6bcc6] bg-gray-200 p-4 max-[980px]:max-h-[48vh] max-[980px]:border-b max-[980px]:border-r-0';
const SCENARIO_MAP_FINAL_PANEL_CLASSNAME =
  'grid gap-[0.65rem] rounded-[10px] border border-transparent p-[0.45rem]';
const SCENARIO_MAP_FINAL_ACTIVE_PANEL_CLASSNAME = 'border-[#0969da] bg-[rgba(221,244,255,0.5)]';
const SCENARIO_MAP_FINAL_PANEL_TITLE_CLASSNAME = 'm-0 text-[1.4rem] font-semibold';
const SCENARIO_MAP_FINAL_BASE_OPTION_GRID_CLASSNAME = 'grid grid-cols-2 gap-[0.45rem]';
const SCENARIO_MAP_FINAL_BASE_OPTION_BUTTON_CLASSNAME =
  'grid cursor-pointer justify-items-start gap-[0.3rem] rounded-lg border border-slate-500 bg-linear-to-b from-slate-100 to-[#e8ecef] px-[0.4rem] py-[0.35rem] text-inherit';
const SCENARIO_MAP_FINAL_BASE_OPTION_BUTTON_ACTIVE_CLASSNAME =
  'border-blue-600 bg-sky-100 shadow-[inset_0_0_0_1px_#0969da]';
const SCENARIO_MAP_FINAL_OPTION_FALLBACK_CLASSNAME = 'text-[0.8rem] font-semibold text-slate-600';
const SCENARIO_MAP_FINAL_CHECKBOX_ROW_CLASSNAME = 'flex items-center gap-[0.45rem] text-slate-600';
const SCENARIO_MAP_FINAL_ZONE_TABS_CLASSNAME =
  'grid grid-cols-3 overflow-hidden rounded-[10px] border border-slate-500';
const SCENARIO_MAP_FINAL_ZONE_TAB_BUTTON_CLASSNAME =
  'cursor-pointer border-r border-slate-500 bg-slate-100 px-[0.4rem] py-2 font-semibold last:border-r-0';
const SCENARIO_MAP_FINAL_ZONE_TAB_BUTTON_ACTIVE_CLASSNAME = 'bg-sky-200';
const SCENARIO_MAP_FINAL_ZONE_OPTION_ROWS_CLASSNAME = 'grid gap-[0.45rem]';
const SCENARIO_MAP_FINAL_ZONE_OPTION_ROW_CLASSNAME = 'grid gap-[0.45rem]';
const SCENARIO_MAP_FINAL_ZONE_OPTION_BUTTON_CLASSNAME =
  'flex min-h-[3.4rem] cursor-pointer items-center justify-center rounded-lg border border-slate-500 bg-linear-to-b from-slate-100 to-[#e8ecef] p-[0.2rem] text-inherit';
const SCENARIO_MAP_FINAL_ZONE_OPTION_BUTTON_ACTIVE_CLASSNAME =
  'border-blue-600 bg-sky-100 shadow-[inset_0_0_0_1px_#0969da]';
const SCENARIO_MAP_FINAL_PLACEHOLDER_CLASSNAME =
  'flex min-h-[7.5rem] items-center justify-center rounded-[10px] border-2 border-dashed border-[#7d8590] bg-white/35 p-4 text-center text-slate-600';
const SCENARIO_MAP_FINAL_CANVAS_SHELL_CLASSNAME = 'min-h-0 bg-[#0b1020]';
const SCENARIO_MAP_CONTROLS_CLASSNAME = 'mb-4 grid gap-3';
const SCENARIO_MAP_TOOL_CONTROLS_CLASSNAME = 'grid gap-[0.6rem]';
const SCENARIO_MAP_TOOL_GRID_CLASSNAME =
  'grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-[0.45rem]';
const SCENARIO_MAP_TOOL_BUTTON_CLASSNAME =
  'cursor-pointer rounded border border-slate-500 bg-slate-100 px-[0.55rem] py-[0.35rem] text-left';
const SCENARIO_MAP_PRESET_ROW_CLASSNAME = 'flex flex-wrap gap-2';
const SCENARIO_MAP_FILL_BUTTON_CLASSNAME = `${EDITOR_BUTTON_CLASSNAME} justify-self-start`;
const SCENARIO_MAP_CANVAS_SHELL_CLASSNAME =
  'mb-4 h-[min(75vh,46rem)] w-[min(100%,72rem)] overflow-hidden rounded-md border border-slate-300 bg-[#0b1020]';
const SCENARIO_OBJECTIVE_NODE_CLASSNAME =
  'my-3 rounded-md border border-slate-300 p-3 [&>legend]:px-[0.4rem] [&>legend]:text-slate-600';
const SCENARIO_OBJECTIVE_METRIC_GRID_CLASSNAME =
  'grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3';
const SCENARIO_OBJECTIVE_CHILDREN_CLASSNAME = 'grid gap-3';
const SCENARIO_OBJECTIVE_CHILD_ROW_CLASSNAME = 'grid gap-2';
const SCENARIO_EDITOR_ACTION_BUTTON_CLASSNAME = `${EDITOR_BUTTON_CLASSNAME} justify-self-start`;
const SCENARIO_SCRIPT_EVENTS_CLASSNAME = 'grid gap-[0.85rem]';
const SCENARIO_SCRIPT_EVENT_CLASSNAME =
  'm-0 rounded-md border border-slate-300 p-[0.8rem] [&>legend]:px-[0.4rem] [&>legend]:text-slate-600';
const SCENARIO_SCRIPT_EVENT_GRID_CLASSNAME =
  'grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3';
const SCENARIO_SCRIPT_ACTIONS_CLASSNAME = 'mt-[0.8rem] grid gap-2 [&>h3]:m-0 [&>h3]:text-[0.95rem]';
const SCENARIO_SCRIPT_ACTION_ROW_CLASSNAME =
  'grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] items-end gap-x-3 gap-y-2';

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
const SCENARIO_MAP_FINAL_LOCAL_TERRAIN_RECOMPUTE_RADIUS = 6;

type ScenarioMapFinalActiveBrushFamily = 'zones' | 'base';
type ScenarioMapFinalSmartBaseBrushId = 'dirt' | 'water' | 'channel' | 'forest';

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

export const Route = createFileRoute('/')({
  component: ScenarioEditorHomeRoute,
});

/**
 * Stage 4 workbench route with metadata/map editing plus objective and script authoring.
 * Parity note: objective metric leaves map to `DoScenarioScore` checks in
 * `ref/micropolis/src/sim/s_msg.c`, while logical composition forms are declarative
 * runtime extensions from `packages/scenario-runtime`; script events map to
 * `ScenarioDisaster` trigger/action domains in `ref/micropolis/src/sim/s_disast.c`; behavior
 * profile assignment maps closed `DoShipSprite` variants from `ref/micropolis/src/sim/w_sprite.c`.
 */
function ScenarioEditorHomeRoute() {
  const { activeView } = useScenarioEditorState();

  if (activeView === 'metadata') {
    return <ScenarioMetadataEditorCard />;
  }
  if (activeView === 'map') {
    return <ScenarioMapEditorCard />;
  }
  if (activeView === 'map-final') {
    return <ScenarioMapFinalWorkbench />;
  }
  if (activeView === 'objective') {
    return <ScenarioObjectiveEditorCard />;
  }
  if (activeView === 'script') {
    return <ScenarioScriptEditorCard />;
  }
  if (activeView === 'behavior') {
    return <ScenarioBehaviorProfileEditorCard />;
  }

  return <ScenarioExportCard />;
}

/**
 * Metadata editing card for scenario bundle fields required by Stage 3.2.
 * Reuses `scenario-core` schema constraints; this has no direct 1:1 C editor equivalent.
 */
function ScenarioMetadataEditorCard() {
  const { bundle, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const issues = getScenarioEditorMetadataValidationIssues(bundle);
  const hasIssues =
    issues.key !== undefined ||
    issues.name !== undefined ||
    issues.description !== undefined ||
    issues.tags !== undefined ||
    issues.startYear !== undefined ||
    issues.startFunds !== undefined;

  return (
    <section className={EDITOR_CARD_CLASSNAME} aria-label="Scenario metadata editor">
      <h1>Scenario Metadata</h1>
      <p>
        Edit canonical bundle metadata fields for key identity, player-facing labels, and scenario
        start parameters.
      </p>
      <form className={EDITOR_FORM_CLASSNAME} onSubmit={preventFormSubmit}>
        <label className={EDITOR_FIELD_CLASSNAME}>
          <span>Scenario Key</span>
          <input
            aria-invalid={issues.key !== undefined}
            onChange={(event) => {
              dispatch({ type: 'update-metadata', metadata: { key: event.currentTarget.value } });
            }}
            type="text"
            value={bundle.key}
          />
          <small className={EDITOR_HELP_TEXT_CLASSNAME}>
            Must use `builtin/*` or `user/*` namespace.
          </small>
          {issues.key !== undefined ? (
            <small className={EDITOR_ERROR_TEXT_CLASSNAME}>{issues.key}</small>
          ) : null}
        </label>

        <label className={EDITOR_FIELD_CLASSNAME}>
          <span>Name</span>
          <input
            aria-invalid={issues.name !== undefined}
            onChange={(event) => {
              dispatch({ type: 'update-metadata', metadata: { name: event.currentTarget.value } });
            }}
            type="text"
            value={bundle.name}
          />
          {issues.name !== undefined ? (
            <small className={EDITOR_ERROR_TEXT_CLASSNAME}>{issues.name}</small>
          ) : null}
        </label>

        <label className={EDITOR_FIELD_CLASSNAME}>
          <span>Description</span>
          <textarea
            aria-invalid={issues.description !== undefined}
            onChange={(event) => {
              dispatch({
                type: 'update-metadata',
                metadata: { description: event.currentTarget.value },
              });
            }}
            rows={4}
            value={bundle.description}
          />
          {issues.description !== undefined ? (
            <small className={EDITOR_ERROR_TEXT_CLASSNAME}>{issues.description}</small>
          ) : null}
        </label>

        <label className={EDITOR_FIELD_CLASSNAME}>
          <span>Tags</span>
          <textarea
            aria-invalid={issues.tags !== undefined}
            onChange={(event) => {
              dispatch({
                type: 'update-metadata',
                metadata: { tags: parseScenarioEditorTagsInput(event.currentTarget.value) },
              });
            }}
            placeholder="classic, tutorial"
            rows={3}
            value={bundle.tags.join(', ')}
          />
          <small className={EDITOR_HELP_TEXT_CLASSNAME}>Comma or newline separated.</small>
          {issues.tags !== undefined ? (
            <small className={EDITOR_ERROR_TEXT_CLASSNAME}>{issues.tags}</small>
          ) : null}
        </label>

        <div className={`${EDITOR_FIELD_CLASSNAME} ${EDITOR_FIELD_INLINE_CLASSNAME}`}>
          <label>
            <span>Start Year</span>
            <input
              aria-invalid={issues.startYear !== undefined}
              onChange={(event) => {
                dispatch({
                  type: 'update-metadata',
                  metadata: {
                    start: {
                      startYear: parseIntegerInput(
                        event.currentTarget.value,
                        bundle.start.startYear,
                      ),
                    },
                  },
                });
              }}
              type="number"
              value={bundle.start.startYear}
            />
            {issues.startYear !== undefined ? (
              <small className={EDITOR_ERROR_TEXT_CLASSNAME}>{issues.startYear}</small>
            ) : null}
          </label>

          <label>
            <span>Start Funds</span>
            <input
              aria-invalid={issues.startFunds !== undefined}
              min={0}
              onChange={(event) => {
                dispatch({
                  type: 'update-metadata',
                  metadata: {
                    start: {
                      startFunds: parseIntegerInput(
                        event.currentTarget.value,
                        bundle.start.startFunds,
                      ),
                    },
                  },
                });
              }}
              type="number"
              value={bundle.start.startFunds}
            />
            {issues.startFunds !== undefined ? (
              <small className={EDITOR_ERROR_TEXT_CLASSNAME}>{issues.startFunds}</small>
            ) : null}
          </label>
        </div>
      </form>

      <dl className={EDITOR_STATS_GRID_CLASSNAME}>
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Validation</dt>
        <dd>{hasIssues ? 'invalid metadata' : 'metadata valid'}</dd>
      </dl>
    </section>
  );
}

/**
 * Full-screen map workbench shell for the final map-authoring workflow.
 * Reuses the runtime `MapCanvas` surface from `apps/web` while presenting an
 * editor-specific sidebar layout (not a direct Micropolis C UI port).
 */
function ScenarioMapFinalWorkbench() {
  const { bundle } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const [activeBrushFamily, setActiveBrushFamily] =
    useState<ScenarioMapFinalActiveBrushFamily>('zones');
  const [activeZoneKind, setActiveZoneKind] = useState<ScenarioEditorMapZoneKind>('res');
  const [activeZoneOptionKey, setActiveZoneOptionKey] = useState<string>('fresh');
  const [activeSmartBaseBrushId, setActiveSmartBaseBrushId] =
    useState<ScenarioMapFinalSmartBaseBrushId>('dirt');
  const [showBaseClassOverlay, setShowBaseClassOverlay] = useState(false);
  const runtimeMapState = useMemo(() => createScenarioEditorRuntimeMapState(bundle), [bundle]);
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
      className={SCENARIO_MAP_FINAL_WORKBENCH_CLASSNAME}
      aria-label="Scenario map final workbench"
    >
      <aside className={SCENARIO_MAP_FINAL_SIDEBAR_CLASSNAME}>
        <section
          className={`${SCENARIO_MAP_FINAL_PANEL_CLASSNAME} ${
            activeBrushFamily === 'base' ? SCENARIO_MAP_FINAL_ACTIVE_PANEL_CLASSNAME : ''
          }`}
        >
          <h2 className={SCENARIO_MAP_FINAL_PANEL_TITLE_CLASSNAME}>Base</h2>
          <div
            className={SCENARIO_MAP_FINAL_BASE_OPTION_GRID_CLASSNAME}
            role="list"
            aria-label="Smart base brushes"
          >
            {SCENARIO_MAP_FINAL_SMART_BASE_BRUSHES.map((brush) => (
              <button
                aria-pressed={activeSmartBaseBrushId === brush.id}
                className={`${SCENARIO_MAP_FINAL_BASE_OPTION_BUTTON_CLASSNAME} ${
                  activeSmartBaseBrushId === brush.id
                    ? SCENARIO_MAP_FINAL_BASE_OPTION_BUTTON_ACTIVE_CLASSNAME
                    : ''
                }`}
                key={brush.id}
                onClick={() => {
                  setActiveSmartBaseBrushId(brush.id);
                  if (brush.id === 'channel') {
                    setShowBaseClassOverlay(true);
                  }
                  setActiveBrushFamily('base');
                }}
                role="listitem"
                title={brush.tooltip}
                type="button"
              >
                {zoneAtlasSource === undefined ? (
                  <span className={SCENARIO_MAP_FINAL_OPTION_FALLBACK_CLASSNAME}>
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
              </button>
            ))}
          </div>

          <label className={SCENARIO_MAP_FINAL_CHECKBOX_ROW_CLASSNAME}>
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

          <small className={EDITOR_HELP_TEXT_CLASSNAME}>
            Active smart brush: {activeSmartBaseBrush.label}. Terrain auto-smooths after edits.
          </small>
        </section>

        <section
          className={`${SCENARIO_MAP_FINAL_PANEL_CLASSNAME} ${
            activeBrushFamily === 'zones' ? SCENARIO_MAP_FINAL_ACTIVE_PANEL_CLASSNAME : ''
          }`}
        >
          <h2 className={SCENARIO_MAP_FINAL_PANEL_TITLE_CLASSNAME}>Zones</h2>
          <div
            aria-label="Zone family selector"
            className={SCENARIO_MAP_FINAL_ZONE_TABS_CLASSNAME}
            role="tablist"
          >
            {(['res', 'com', 'ind'] as const).map((zone) => (
              <button
                aria-selected={zone === activeZoneKind}
                className={`${SCENARIO_MAP_FINAL_ZONE_TAB_BUTTON_CLASSNAME} ${
                  zone === activeZoneKind ? SCENARIO_MAP_FINAL_ZONE_TAB_BUTTON_ACTIVE_CLASSNAME : ''
                }`}
                key={zone}
                onClick={() => {
                  setActiveZoneKind(zone);
                  setActiveZoneOptionKey('fresh');
                  setActiveBrushFamily('zones');
                }}
                role="tab"
                type="button"
              >
                {zone.toUpperCase()}
              </button>
            ))}
          </div>

          <div className={SCENARIO_MAP_FINAL_ZONE_OPTION_ROWS_CLASSNAME}>
            {zoneOptionRows.map((rowOptions, rowIndex) => (
              <div
                className={SCENARIO_MAP_FINAL_ZONE_OPTION_ROW_CLASSNAME}
                key={`row:${rowIndex}`}
                style={
                  {
                    gridTemplateColumns: `repeat(${zoneLevelColumnCount}, minmax(3.6rem, 1fr))`,
                  } satisfies CSSProperties
                }
              >
                {rowOptions.map((option) => (
                  <button
                    className={`${SCENARIO_MAP_FINAL_ZONE_OPTION_BUTTON_CLASSNAME} ${
                      option.key === activeZoneOptionKey
                        ? SCENARIO_MAP_FINAL_ZONE_OPTION_BUTTON_ACTIVE_CLASSNAME
                        : ''
                    }`}
                    key={option.key}
                    onClick={() => {
                      setActiveZoneOptionKey(option.key);
                      setActiveBrushFamily('zones');
                    }}
                    aria-label={option.tooltip}
                    title={option.tooltip}
                    type="button"
                  >
                    {zoneAtlasSource === undefined ? (
                      <span className={SCENARIO_MAP_FINAL_OPTION_FALLBACK_CLASSNAME}>
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

          <small className={EDITOR_HELP_TEXT_CLASSNAME}>
            {activeZoneOption.kind === 'fresh'
              ? `${SCENARIO_MAP_FINAL_ZONE_FAMILY_LABELS[activeZoneKind]} fresh zone`
              : `Density Level ${activeZoneOption.densityLevel} / ${zoneValueClassLabel} ${activeZoneOption.landValueClass}`}
          </small>
        </section>

        <section className={SCENARIO_MAP_FINAL_PANEL_CLASSNAME}>
          <h2 className={SCENARIO_MAP_FINAL_PANEL_TITLE_CLASSNAME}>Tools</h2>
          <div className={SCENARIO_MAP_FINAL_PLACEHOLDER_CLASSNAME}>TODO: tool picker</div>
        </section>
      </aside>

      <div className={SCENARIO_MAP_FINAL_CANVAS_SHELL_CLASSNAME}>
        <MapCanvas
          dragPlacementEnabled={activeBrushFamily === 'base'}
          hoverPreview={activeBrushFamily === 'base' ? activeSmartBaseHoverPreview : undefined}
          hoverTool={activeBrushFamily === 'zones' ? activeZoneKind : undefined}
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
                for (const [index, point] of forestPoints.entries()) {
                  const isLastPoint = index === forestPoints.length - 1;
                  dispatch({
                    type: 'paint-map-base-tile',
                    x: point.x,
                    y: point.y,
                    baseTileId: activeSmartBaseBrush.tileId,
                    preserveFlags: false,
                    terrainRecomputeMode: isLastPoint ? 'local' : 'off',
                    terrainRecomputeRadius: SCENARIO_MAP_FINAL_LOCAL_TERRAIN_RECOMPUTE_RADIUS,
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
                terrainRecomputeMode: 'local',
                terrainRecomputeRadius: SCENARIO_MAP_FINAL_LOCAL_TERRAIN_RECOMPUTE_RADIUS,
              });
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
function ScenarioMapEditorCard() {
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
  const runtimeMapState = useMemo(() => createScenarioEditorRuntimeMapState(bundle), [bundle]);
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
    <section className={EDITOR_MAP_CARD_CLASSNAME} aria-label="Scenario map editor">
      <h1>Scenario Map</h1>
      <p>
        Reuses the runtime map canvas (sprite art, zoom/pan, and tool footprints) while allowing
        direct scenario authoring: full Micropolis tools, zone-level placement, and base-tile
        painting (dirt/water/forest/etc.). Terrain smoothing recomputes after each map edit.
      </p>

      <div className={SCENARIO_MAP_CONTROLS_CLASSNAME}>
        <label className={EDITOR_FIELD_CLASSNAME}>
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
          <div className={SCENARIO_MAP_TOOL_CONTROLS_CLASSNAME}>
            <label className={EDITOR_FIELD_CLASSNAME}>
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
              <small className={EDITOR_HELP_TEXT_CLASSNAME}>
                Tool footprint {activeToolSpec.size}x{activeToolSpec.size}, base cost $
                {activeToolSpec.baseCost}.
              </small>
            </label>

            <div
              className={SCENARIO_MAP_TOOL_GRID_CLASSNAME}
              role="list"
              aria-label="Micropolis map tools"
            >
              {PLAYABLE_TOOL_SPECS.map((spec) => (
                <button
                  aria-pressed={activeTool === spec.tool}
                  className={`${SCENARIO_MAP_TOOL_BUTTON_CLASSNAME} ${
                    activeTool === spec.tool ? EDITOR_BUTTON_ACTIVE_CLASSNAME : ''
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
          <div className={SCENARIO_MAP_TOOL_CONTROLS_CLASSNAME}>
            <div className={EDITOR_FIELD_INLINE_CLASSNAME}>
              <label className={EDITOR_FIELD_CLASSNAME}>
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

              <label className={EDITOR_FIELD_CLASSNAME}>
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

              <label className={EDITOR_FIELD_CLASSNAME}>
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
            <small className={EDITOR_HELP_TEXT_CLASSNAME}>
              {`Places direct zone variants using ResPlop/ComPlop/IndPlop formulas (1-based level, value 0..${activeZoneMaxValue} for ${activeZoneKind.toUpperCase()}).`}
            </small>
          </div>
        ) : null}

        {brushMode === 'base-tile' ? (
          <>
            <label className={EDITOR_FIELD_CLASSNAME}>
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
              <small className={EDITOR_HELP_TEXT_CLASSNAME}>
                Full tile-name list from classic `sim.h` tile-id constants.
              </small>
            </label>

            <label className={EDITOR_FIELD_CLASSNAME}>
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
              <small className={EDITOR_HELP_TEXT_CLASSNAME}>
                Writes low tile-id bits (`LOMASK=1023`).
              </small>
            </label>

            <div className={SCENARIO_MAP_PRESET_ROW_CLASSNAME}>
              {BASE_TILE_PRESETS.map((preset) => (
                <button
                  className={EDITOR_BUTTON_CLASSNAME}
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

            <label className={EDITOR_FIELD_CLASSNAME}>
              <span>Preserve Existing Flags</span>
              <input
                className="justify-self-start"
                checked={preserveBaseTileFlags}
                onChange={(event) => {
                  setPreserveBaseTileFlags(event.currentTarget.checked);
                }}
                type="checkbox"
              />
              <small className={EDITOR_HELP_TEXT_CLASSNAME}>
                Keep tile status bits (zone/power/bulldoze flags) while replacing base tile id.
              </small>
            </label>
          </>
        ) : null}

        {brushMode === 'tile-word' ? (
          <label className={EDITOR_FIELD_CLASSNAME}>
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
            <small className={EDITOR_HELP_TEXT_CLASSNAME}>
              Stored as unsigned 16-bit map words; this picker uses named base tile words.
            </small>
          </label>
        ) : null}

        <label className={EDITOR_FIELD_CLASSNAME}>
          <span>Map Navigation</span>
          <small className={EDITOR_HELP_TEXT_CLASSNAME}>
            Left click paints/places. Mouse wheel pans. `Ctrl`/`Cmd` + wheel zooms. Middle-button
            drag also pans.
          </small>
        </label>

        <button
          className={SCENARIO_MAP_FILL_BUTTON_CLASSNAME}
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

      <div className={SCENARIO_MAP_CANVAS_SHELL_CLASSNAME}>
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

      <dl className={EDITOR_STATS_GRID_CLASSNAME}>
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
      </dl>
    </section>
  );
}

/**
 * Objective authoring card for Stage 4.1 predicate DSL editing.
 * Parity note: metric leaves mirror `DoScenarioScore` checks in
 * `ref/micropolis/src/sim/s_msg.c`; logical nodes (`all`/`any`/`not`) are
 * declarative extensions supported by `packages/scenario-runtime`.
 */
function ScenarioObjectiveEditorCard() {
  const { objective, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const validationIssues = useMemo(
    () => getScenarioEditorObjectiveValidationIssues(objective),
    [objective],
  );
  const objectiveJson = useMemo(
    () => JSON.stringify(objective.enabled ? objective.predicate : null, null, 2),
    [objective.enabled, objective.predicate],
  );

  return (
    <section className={EDITOR_OBJECTIVE_CARD_CLASSNAME} aria-label="Scenario objective editor">
      <h1>Scenario Objective</h1>
      <p>
        Author objective predicates using the Stage 4 DSL. Metric comparisons track classic
        `DoScenarioScore` fields, while `all`/`any`/`not` allow composed checks.
      </p>

      <label className={EDITOR_FIELD_CLASSNAME}>
        <span>Objective Enabled</span>
        <input
          className="justify-self-start"
          checked={objective.enabled}
          onChange={(event) => {
            dispatch({ type: 'set-objective-enabled', enabled: event.currentTarget.checked });
          }}
          type="checkbox"
        />
        <small className={EDITOR_HELP_TEXT_CLASSNAME}>
          Objective predicate drafts are included in strict export when objective authoring is
          enabled.
        </small>
      </label>

      {objective.enabled ? (
        <ScenarioObjectivePredicateEditor
          depth={0}
          onChange={(predicate) => {
            dispatch({ type: 'replace-objective-predicate', predicate });
          }}
          predicate={objective.predicate}
        />
      ) : (
        <p className={EDITOR_HELP_TEXT_CLASSNAME}>Objective checks are disabled for this draft.</p>
      )}

      <dl className={EDITOR_STATS_GRID_CLASSNAME}>
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Objective Enabled</dt>
        <dd>{objective.enabled ? 'yes' : 'no'}</dd>
        <dt>Root Predicate</dt>
        <dd>{objective.enabled ? objective.predicate.kind : 'none'}</dd>
        <dt>Validation</dt>
        <dd>
          {!objective.enabled
            ? 'disabled'
            : validationIssues.length === 0
              ? 'valid'
              : `invalid (${validationIssues.length} issue${
                  validationIssues.length === 1 ? '' : 's'
                })`}
        </dd>
      </dl>

      {objective.enabled && validationIssues.length > 0 ? (
        <section aria-label="Objective semantic issues" className={EDITOR_ISSUES_PANEL_CLASSNAME}>
          <h2>Objective Semantic Issues</h2>
          <ul>
            {validationIssues.map((issue, index) => (
              <li key={`${issue.path}:${issue.message}:${index}`}>
                <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={EDITOR_PREVIEW_PANEL_CLASSNAME} aria-label="Objective predicate preview">
        <h2>Objective Predicate JSON</h2>
        <textarea readOnly rows={10} value={objectiveJson} />
      </section>
    </section>
  );
}

/**
 * Recursive node editor for one objective predicate subtree.
 * Not from Micropolis C: this is React authoring UI over runtime predicate data.
 */
function ScenarioObjectivePredicateEditor(options: {
  depth: number;
  onChange: (predicate: ScenarioEditorObjectivePredicate) => void;
  predicate: ScenarioEditorObjectivePredicate;
}) {
  const { depth, onChange, predicate } = options;
  const nodeLabel = `Predicate depth ${depth}`;

  return (
    <fieldset className={SCENARIO_OBJECTIVE_NODE_CLASSNAME}>
      <legend>{nodeLabel}</legend>
      <label className={EDITOR_FIELD_CLASSNAME}>
        <span>Kind</span>
        <select
          onChange={(event) => {
            onChange(
              coerceScenarioObjectivePredicateKind(
                predicate,
                event.currentTarget.value as ScenarioEditorObjectivePredicate['kind'],
              ),
            );
          }}
          value={predicate.kind}
        >
          {SCENARIO_EDITOR_OBJECTIVE_PREDICATE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {getScenarioObjectivePredicateKindLabel(kind)}
            </option>
          ))}
        </select>
      </label>

      {predicate.kind === 'metric' ? (
        <div className={SCENARIO_OBJECTIVE_METRIC_GRID_CLASSNAME}>
          <label className={EDITOR_FIELD_CLASSNAME}>
            <span>Metric</span>
            <select
              onChange={(event) => {
                onChange({
                  ...predicate,
                  metric: event.currentTarget
                    .value as (typeof SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS)[number],
                });
              }}
              value={predicate.metric}
            >
              {SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS.map((metric) => (
                <option key={metric} value={metric}>
                  {getScenarioObjectiveMetricLabel(metric)}
                </option>
              ))}
            </select>
          </label>

          <label className={EDITOR_FIELD_CLASSNAME}>
            <span>Operator</span>
            <select
              onChange={(event) => {
                onChange({
                  ...predicate,
                  op: event.currentTarget
                    .value as (typeof SCENARIO_EDITOR_OBJECTIVE_COMPARISONS)[number],
                });
              }}
              value={predicate.op}
            >
              {SCENARIO_EDITOR_OBJECTIVE_COMPARISONS.map((comparison) => (
                <option key={comparison} value={comparison}>
                  {getScenarioObjectiveComparisonLabel(comparison)}
                </option>
              ))}
            </select>
          </label>

          <label className={EDITOR_FIELD_CLASSNAME}>
            <span>Value</span>
            <input
              onChange={(event) => {
                onChange({
                  ...predicate,
                  value: parseIntegerInput(event.currentTarget.value, predicate.value),
                });
              }}
              type="number"
              value={predicate.value}
            />
          </label>
        </div>
      ) : null}

      {predicate.kind === 'all' || predicate.kind === 'any' ? (
        <div className={SCENARIO_OBJECTIVE_CHILDREN_CLASSNAME}>
          {predicate.predicates.map((childPredicate, index) => (
            <div className={SCENARIO_OBJECTIVE_CHILD_ROW_CLASSNAME} key={index}>
              <ScenarioObjectivePredicateEditor
                depth={depth + 1}
                onChange={(child) => {
                  onChange(replaceScenarioObjectiveChildPredicate(predicate, index, child));
                }}
                predicate={childPredicate}
              />
              <button
                className={SCENARIO_EDITOR_ACTION_BUTTON_CLASSNAME}
                onClick={() => {
                  onChange(removeScenarioObjectiveChildPredicate(predicate, index));
                }}
                type="button"
              >
                Remove Child
              </button>
            </div>
          ))}
          <button
            className={SCENARIO_EDITOR_ACTION_BUTTON_CLASSNAME}
            onClick={() => {
              onChange(appendScenarioObjectiveChildPredicate(predicate));
            }}
            type="button"
          >
            Add Child Predicate
          </button>
        </div>
      ) : null}

      {predicate.kind === 'not' ? (
        <div className={SCENARIO_OBJECTIVE_CHILDREN_CLASSNAME}>
          <ScenarioObjectivePredicateEditor
            depth={depth + 1}
            onChange={(child) => {
              onChange(replaceScenarioObjectiveNotChildPredicate(predicate, child));
            }}
            predicate={predicate.predicate}
          />
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * Event/action authoring card for Stage 4.2 declarative script editing.
 * Parity note: trigger patterns (`atTick`, `everyTicks`) mirror `ScenarioDisaster`
 * timing checks in `ref/micropolis/src/sim/s_disast.c`, while this React form is
 * editor-only UI over `scenario-runtime` action unions.
 */
function ScenarioScriptEditorCard() {
  const { script, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const validationIssues = useMemo(() => getScenarioEditorScriptValidationIssues(script), [script]);
  const scriptJson = useMemo(
    () => JSON.stringify(script.enabled ? script.events : [], null, 2),
    [script.enabled, script.events],
  );

  const replaceEvents = (events: readonly ScenarioEditorScriptEvent[]) => {
    dispatch({ type: 'replace-script-events', events });
  };

  return (
    <section className={EDITOR_SCRIPT_CARD_CLASSNAME} aria-label="Scenario script editor">
      <h1>Scenario Scripts</h1>
      <p>
        Author declarative event scripts with one-shot (`atTick`) and interval (`everyTicks`)
        triggers plus runtime action unions for disasters/messages.
      </p>

      <label className={EDITOR_FIELD_CLASSNAME}>
        <span>Scripts Enabled</span>
        <input
          className="justify-self-start"
          checked={script.enabled}
          onChange={(event) => {
            dispatch({ type: 'set-script-enabled', enabled: event.currentTarget.checked });
          }}
          type="checkbox"
        />
        <small className={EDITOR_HELP_TEXT_CLASSNAME}>
          Script event/action drafts are included in strict export when script authoring is enabled.
        </small>
      </label>

      {script.enabled ? (
        <div className={SCENARIO_SCRIPT_EVENTS_CLASSNAME}>
          {script.events.map((event, eventIndex) => (
            <ScenarioScriptEventEditor
              event={event}
              index={eventIndex}
              key={eventIndex}
              onChange={(nextEvent) => {
                replaceEvents(
                  replaceScenarioEditorScriptEvent(script.events, eventIndex, nextEvent),
                );
              }}
              onRemove={() => {
                replaceEvents(removeScenarioEditorScriptEvent(script.events, eventIndex));
              }}
            />
          ))}
          <button
            className={SCENARIO_EDITOR_ACTION_BUTTON_CLASSNAME}
            onClick={() => {
              replaceEvents(appendScenarioEditorScriptEvent(script.events));
            }}
            type="button"
          >
            Add Script Event
          </button>
        </div>
      ) : (
        <p className={EDITOR_HELP_TEXT_CLASSNAME}>
          Scripted event actions are disabled for this draft.
        </p>
      )}

      <dl className={EDITOR_STATS_GRID_CLASSNAME}>
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Scripts Enabled</dt>
        <dd>{script.enabled ? 'yes' : 'no'}</dd>
        <dt>Event Rows</dt>
        <dd>{script.events.length}</dd>
        <dt>Validation</dt>
        <dd>
          {!script.enabled
            ? 'disabled'
            : validationIssues.length === 0
              ? 'valid'
              : `invalid (${validationIssues.length} issue${
                  validationIssues.length === 1 ? '' : 's'
                })`}
        </dd>
      </dl>

      {script.enabled && validationIssues.length > 0 ? (
        <section aria-label="Script semantic issues" className={EDITOR_ISSUES_PANEL_CLASSNAME}>
          <h2>Script Semantic Issues</h2>
          <ul>
            {validationIssues.map((issue, index) => (
              <li key={`${issue.path}:${issue.message}:${index}`}>
                <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={EDITOR_PREVIEW_PANEL_CLASSNAME} aria-label="Script event preview">
        <h2>Script Event JSON</h2>
        <textarea readOnly rows={12} value={scriptJson} />
      </section>
    </section>
  );
}

/**
 * One event row editor for Stage 4.2 script authoring.
 * Not from Micropolis C: this is React form wiring around declarative runtime event drafts.
 */
function ScenarioScriptEventEditor(options: {
  event: ScenarioEditorScriptEvent;
  index: number;
  onChange: (event: ScenarioEditorScriptEvent) => void;
  onRemove: () => void;
}) {
  const { event, index, onChange, onRemove } = options;
  const triggerKind = getScenarioEditorScriptTriggerKind(event.trigger);

  return (
    <fieldset className={SCENARIO_SCRIPT_EVENT_CLASSNAME}>
      <legend>{`Event ${index + 1}`}</legend>
      <div className={SCENARIO_SCRIPT_EVENT_GRID_CLASSNAME}>
        <label className={EDITOR_FIELD_CLASSNAME}>
          <span>Trigger</span>
          <select
            onChange={(changeEvent) => {
              onChange(
                coerceScenarioEditorScriptTriggerKind(
                  event,
                  changeEvent.currentTarget
                    .value as (typeof SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS)[number],
                ),
              );
            }}
            value={triggerKind}
          >
            {SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {getScenarioScriptTriggerKindLabel(kind)}
              </option>
            ))}
          </select>
        </label>

        {triggerKind === 'atTick' ? (
          <label className={EDITOR_FIELD_CLASSNAME}>
            <span>atTick</span>
            <input
              min={0}
              onChange={(changeEvent) => {
                onChange(
                  replaceScenarioEditorAtTickTrigger(
                    event,
                    parseIntegerInput(
                      changeEvent.currentTarget.value,
                      'atTick' in event.trigger ? event.trigger.atTick : 0,
                    ),
                  ),
                );
              }}
              type="number"
              value={'atTick' in event.trigger ? event.trigger.atTick : 0}
            />
          </label>
        ) : (
          <label className={EDITOR_FIELD_CLASSNAME}>
            <span>everyTicks</span>
            <input
              min={1}
              onChange={(changeEvent) => {
                onChange(
                  replaceScenarioEditorEveryTicksTrigger(
                    event,
                    parseIntegerInput(
                      changeEvent.currentTarget.value,
                      'everyTicks' in event.trigger ? event.trigger.everyTicks : 1,
                    ),
                  ),
                );
              }}
              type="number"
              value={'everyTicks' in event.trigger ? event.trigger.everyTicks : 1}
            />
          </label>
        )}
      </div>

      <div className={SCENARIO_SCRIPT_ACTIONS_CLASSNAME}>
        <h3>Actions</h3>
        {event.actions.map((action, actionIndex) => (
          <div className={SCENARIO_SCRIPT_ACTION_ROW_CLASSNAME} key={`${index}:${actionIndex}`}>
            <label className={EDITOR_FIELD_CLASSNAME}>
              <span>Action</span>
              <select
                onChange={(changeEvent) => {
                  onChange(
                    replaceScenarioEditorScriptAction(
                      event,
                      actionIndex,
                      coerceScenarioEditorScriptActionKind(
                        action,
                        changeEvent.currentTarget.value as ScenarioEditorScriptAction['kind'],
                      ),
                    ),
                  );
                }}
                value={action.kind}
              >
                {SCENARIO_EDITOR_SCRIPT_ACTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {getScenarioScriptActionKindLabel(kind)}
                  </option>
                ))}
              </select>
            </label>

            {action.kind === 'send-message' ? (
              <label className={EDITOR_FIELD_CLASSNAME}>
                <span>messageId</span>
                <input
                  onChange={(changeEvent) => {
                    onChange(
                      replaceScenarioEditorScriptAction(
                        event,
                        actionIndex,
                        replaceScenarioEditorSendMessageId(
                          action,
                          parseIntegerInput(changeEvent.currentTarget.value, action.messageId),
                        ),
                      ),
                    );
                  }}
                  type="number"
                  value={action.messageId}
                />
              </label>
            ) : null}

            <button
              className={SCENARIO_EDITOR_ACTION_BUTTON_CLASSNAME}
              onClick={() => {
                onChange(removeScenarioEditorScriptAction(event, actionIndex));
              }}
              type="button"
            >
              Remove Action
            </button>
          </div>
        ))}
        <button
          className={SCENARIO_EDITOR_ACTION_BUTTON_CLASSNAME}
          onClick={() => {
            onChange(appendScenarioEditorScriptAction(event));
          }}
          type="button"
        >
          Add Action
        </button>
      </div>

      <button className={SCENARIO_EDITOR_ACTION_BUTTON_CLASSNAME} onClick={onRemove} type="button">
        Remove Event
      </button>
    </fieldset>
  );
}

/**
 * Behavior-profile assignment card for Stage 4.3 closed-profile authoring.
 * Parity note: profile keys map to closed `ScenarioID` behavior variants in `DoShipSprite`
 * (`ref/micropolis/src/sim/w_sprite.c`), with declarative selection via
 * `packages/scenario-runtime/src/behavior-profiles.ts`.
 */
function ScenarioBehaviorProfileEditorCard() {
  const { behavior, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const validationIssue = getScenarioEditorBehaviorValidationIssue(behavior);
  const normalizedProfileKey = behavior.profileKey.trim();
  const hasClosedProfileKey = isScenarioEditorBehaviorProfileKey(normalizedProfileKey);
  const selectedProfileKey = hasClosedProfileKey ? normalizedProfileKey : behavior.profileKey;
  const behaviorJson = useMemo(
    () =>
      JSON.stringify(
        behavior.enabled ? { behaviorProfileKey: behavior.profileKey } : null,
        null,
        2,
      ),
    [behavior.enabled, behavior.profileKey],
  );

  return (
    <section
      className={EDITOR_BEHAVIOR_CARD_CLASSNAME}
      aria-label="Scenario behavior profile editor"
    >
      <h1>Scenario Behavior Profile</h1>
      <p>
        Assign one closed runtime behavior profile key. This preserves deterministic parity by
        allowing only registered profile variants.
      </p>

      <label className={EDITOR_FIELD_CLASSNAME}>
        <span>Behavior Profile Assignment Enabled</span>
        <input
          className="justify-self-start"
          checked={behavior.enabled}
          onChange={(event) => {
            dispatch({ type: 'set-behavior-enabled', enabled: event.currentTarget.checked });
          }}
          type="checkbox"
        />
        <small className={EDITOR_HELP_TEXT_CLASSNAME}>
          This Stage 4.3 draft editor captures profile assignment only; export integration lands in
          Stage 4.5.
        </small>
      </label>

      {behavior.enabled ? (
        <label className={EDITOR_FIELD_CLASSNAME}>
          <span>Behavior Profile Key</span>
          <select
            aria-invalid={validationIssue !== undefined}
            onChange={(event) => {
              dispatch({
                type: 'set-behavior-profile-key',
                profileKey: event.currentTarget.value,
              });
            }}
            value={selectedProfileKey}
          >
            {hasClosedProfileKey ? null : (
              <option value={selectedProfileKey}>
                {`Unrecognized key: ${behavior.profileKey || '(empty)'}`}
              </option>
            )}
            {SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS.map((profileKey) => (
              <option key={profileKey} value={profileKey}>
                {getScenarioBehaviorProfileLabel(profileKey)}
              </option>
            ))}
          </select>
          <small className={EDITOR_HELP_TEXT_CLASSNAME}>
            Closed profile keys only: {SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS.join(', ')}.
          </small>
          {validationIssue !== undefined ? (
            <small className={EDITOR_ERROR_TEXT_CLASSNAME}>{validationIssue}</small>
          ) : null}
        </label>
      ) : (
        <p className={EDITOR_HELP_TEXT_CLASSNAME}>
          Behavior profile override is disabled for this draft.
        </p>
      )}

      <dl className={EDITOR_STATS_GRID_CLASSNAME}>
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Assignment Enabled</dt>
        <dd>{behavior.enabled ? 'yes' : 'no'}</dd>
        <dt>Profile Key</dt>
        <dd>{behavior.enabled ? behavior.profileKey : 'none'}</dd>
        <dt>Validation</dt>
        <dd>{validationIssue === undefined ? 'valid' : 'invalid'}</dd>
      </dl>

      <section className={EDITOR_PREVIEW_PANEL_CLASSNAME} aria-label="Behavior profile preview">
        <h2>Behavior Assignment JSON</h2>
        <textarea readOnly rows={6} value={behaviorJson} />
      </section>
    </section>
  );
}

/**
 * Strict JSON export + open/import card for Stage 3.4/3.5.
 * Reuses Stage 0 schema/map canonicalization checks derived from Micropolis map
 * persistence in `ref/micropolis/src/sim/s_fileio.c`; open/import diagnostics and
 * file-picker UX are editor-only browser workflow glue.
 */
function ScenarioExportCard() {
  const { bundle, isDirty, objective, script } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const openFileInputRef = useRef<HTMLInputElement | null>(null);
  const [lastOpenResult, setLastOpenResult] = useState<ScenarioEditorOpenResult | null>(null);
  const [lastResult, setLastResult] = useState<ScenarioEditorStrictExportResult | null>(null);
  const exportFileName = getScenarioEditorExportFileName(bundle.key);

  const handleExport = () => {
    const result = buildScenarioEditorStrictExport(bundle, { objective, script });
    setLastResult(result);

    if (!result.ok) {
      return;
    }

    triggerScenarioBundleJsonDownload(exportFileName, result.jsonText);
    dispatch({ type: 'mark-clean' });
  };

  const handleOpenBundle = () => {
    if (
      isDirty &&
      !window.confirm('Open a bundle and discard unsaved editor changes in this draft?')
    ) {
      return;
    }

    openFileInputRef.current?.click();
  };

  const handleOpenBundleInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selectedFile = input.files?.[0];
    input.value = '';
    if (selectedFile === undefined) {
      return;
    }

    let fileText: string;
    try {
      fileText = await selectedFile.text();
    } catch {
      setLastOpenResult({
        ok: false,
        fileName: selectedFile.name,
        issues: [
          {
            source: 'io',
            path: '$',
            message: 'failed to read the selected bundle file',
          },
        ],
      });
      return;
    }

    const importResult = parseScenarioEditorBundleImportJson(fileText);
    if (!importResult.ok) {
      setLastOpenResult({
        ok: false,
        fileName: selectedFile.name,
        issues: importResult.issues,
      });
      return;
    }

    dispatch({ type: 'replace-bundle', bundle: importResult.bundle });
    dispatch({ type: 'set-active-view', view: 'metadata' });
    setLastOpenResult({
      ok: true,
      fileName: selectedFile.name,
    });
    setLastResult(null);
  };

  const issues = lastResult?.ok === false ? lastResult.issues : [];
  const openIssues = lastOpenResult?.ok === false ? lastOpenResult.issues : [];

  return (
    <section className={EDITOR_CARD_CLASSNAME} aria-label="Scenario strict export panel">
      <h1>Export Scenario Bundle</h1>
      <p>
        Open an existing bundle JSON for iterative edits, then run strict schema/lint checks and
        export canonical `ScenarioBundleV1` JSON with map payload compiled to `city-file-bytes` plus
        authored Stage 4 objective/script payloads when enabled.
      </p>

      <div className={EDITOR_EXPORT_ACTIONS_CLASSNAME}>
        <input
          accept="application/json,.json"
          className="hidden"
          onChange={handleOpenBundleInputChange}
          ref={openFileInputRef}
          type="file"
        />
        <button className={EDITOR_OPEN_BUTTON_CLASSNAME} onClick={handleOpenBundle} type="button">
          Open Bundle JSON
        </button>
        <button className={EDITOR_EXPORT_BUTTON_CLASSNAME} onClick={handleExport} type="button">
          Export Bundle JSON
        </button>
        <small className={EDITOR_HELP_TEXT_CLASSNAME}>Export file name: {exportFileName}</small>
      </div>

      <dl className={EDITOR_STATS_GRID_CLASSNAME}>
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Last Open Attempt</dt>
        <dd>
          {lastOpenResult === null
            ? 'not attempted'
            : lastOpenResult.ok
              ? `success (${lastOpenResult.fileName})`
              : `blocked (${openIssues.length} issue${openIssues.length === 1 ? '' : 's'})`}
        </dd>
        <dt>Last Export Attempt</dt>
        <dd>
          {lastResult === null
            ? 'not attempted'
            : lastResult.ok
              ? 'success'
              : `blocked (${issues.length} issue${issues.length === 1 ? '' : 's'})`}
        </dd>
      </dl>

      {lastResult?.ok === false ? (
        <section aria-label="Strict export issues" className={EDITOR_ISSUES_PANEL_CLASSNAME}>
          <h2>Export Blocked</h2>
          <ul>
            {lastResult.issues.map((issue, index) => (
              <li key={`${issue.source}:${issue.path}:${issue.message}:${index}`}>
                <strong>{issue.source}</strong> at <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lastOpenResult?.ok === false ? (
        <section aria-label="Bundle open issues" className={EDITOR_ISSUES_PANEL_CLASSNAME}>
          <h2>Open Blocked</h2>
          <ul>
            {openIssues.map((issue, index) => (
              <li key={`${issue.source}:${issue.path}:${issue.message}:${index}`}>
                <strong>{issue.source}</strong> at <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lastResult?.ok ? (
        <section aria-label="Export json preview" className={EDITOR_PREVIEW_PANEL_CLASSNAME}>
          <h2>Last Export JSON</h2>
          <textarea readOnly rows={12} value={lastResult.jsonText} />
        </section>
      ) : null}
    </section>
  );
}

/**
 * Prevent accidental form submission reload while editing metadata.
 * Not from Micropolis C: browser form behavior guard for SPA workflow.
 */
function preventFormSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

/**
 * Trigger one browser download for a strict-export scenario bundle JSON file.
 * Not from Micropolis C: classic scenario/city files were written by `saveFile` in
 * `ref/micropolis/src/sim/s_fileio.c`; this is browser download plumbing.
 */
function triggerScenarioBundleJsonDownload(fileName: string, jsonText: string) {
  const blob = new Blob([jsonText], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 0);
}

/**
 * Parse integer form input with deterministic fallback.
 * Parity note: integers mirror C-style whole-number scenario/objective fields, while fallback
 * behavior is editor-specific UI handling.
 */
function parseIntegerInput(rawValue: string, fallback: number): number {
  if (rawValue.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Render label text for one objective predicate kind.
 * Not from Micropolis C: UI-only display names for runtime predicate kinds.
 */
function getScenarioObjectivePredicateKindLabel(
  kind: ScenarioEditorObjectivePredicate['kind'],
): string {
  if (kind === 'metric') {
    return 'Metric';
  }
  if (kind === 'all') {
    return 'All';
  }
  if (kind === 'any') {
    return 'Any';
  }
  return 'Not';
}

/**
 * Render label text for one objective metric key.
 * Mirrors metric domains from `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c`.
 */
function getScenarioObjectiveMetricLabel(
  metric: (typeof SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS)[number],
): string {
  if (metric === 'city-class') {
    return 'City Class';
  }
  if (metric === 'traffic-average') {
    return 'Traffic Average';
  }
  if (metric === 'city-score') {
    return 'City Score';
  }
  return 'Crime Average';
}

/**
 * Render label text for one objective comparison operator.
 * Mirrors relational operator semantics used by `DoScenarioScore` in
 * `ref/micropolis/src/sim/s_msg.c`.
 */
function getScenarioObjectiveComparisonLabel(
  comparison: (typeof SCENARIO_EDITOR_OBJECTIVE_COMPARISONS)[number],
): string {
  if (comparison === 'gt') {
    return '>';
  }
  if (comparison === 'gte') {
    return '>=';
  }
  if (comparison === 'lt') {
    return '<';
  }
  if (comparison === 'lte') {
    return '<=';
  }
  if (comparison === 'eq') {
    return '=';
  }
  return '!=';
}

/**
 * Render label text for one script trigger selector value.
 * Mirrors `ScenarioDisaster` trigger styles in `ref/micropolis/src/sim/s_disast.c`.
 */
function getScenarioScriptTriggerKindLabel(
  kind: (typeof SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS)[number],
): string {
  if (kind === 'atTick') {
    return 'At Tick';
  }
  return 'Every Ticks';
}

/**
 * Render label text for one script action kind.
 * Mirrors action side-effect categories represented by `ScenarioRuntimeAction`.
 */
function getScenarioScriptActionKindLabel(
  kind: (typeof SCENARIO_EDITOR_SCRIPT_ACTION_KINDS)[number],
): string {
  if (kind === 'make-earthquake') {
    return 'Make Earthquake';
  }
  if (kind === 'drop-fire-bombs') {
    return 'Drop Fire Bombs';
  }
  if (kind === 'make-monster') {
    return 'Make Monster';
  }
  if (kind === 'make-meltdown') {
    return 'Make Meltdown';
  }
  if (kind === 'make-flood') {
    return 'Make Flood';
  }
  if (kind === 'send-message') {
    return 'Send Message';
  }
  return 'Lose Game';
}

/**
 * Render label text for one closed behavior-profile key.
 * Mirrors runtime profile keyspace from `packages/scenario-runtime` registry.
 */
function getScenarioBehaviorProfileLabel(
  profileKey: (typeof SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS)[number],
): string {
  if (profileKey === 'classic/default') {
    return 'Classic Default';
  }
  if (profileKey === 'classic/sf-ship-honk') {
    return 'Classic SF Ship Honk';
  }
  return profileKey;
}
