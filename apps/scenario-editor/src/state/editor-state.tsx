import {
  SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  SCENARIO_BUNDLE_V1_MAP_WIDTH,
  SCENARIO_BUNDLE_V1_TILE_COUNT,
  type ScenarioBundleV1,
  scenarioBundleV1Schema,
} from '@city/scenario-core';
import {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  useContext,
  useMemo,
  useReducer,
} from 'react';

import {
  createScenarioEditorInitialBehaviorDraft,
  type ScenarioEditorBehaviorDraft,
} from './editor-behavior.ts';
import {
  applyScenarioEditorMapSpecialZoneAtPoint,
  applyScenarioEditorMapToolAtPoint,
  applyScenarioEditorMapZoneLevelAtPoint,
  deriveScenarioEditorMapPower,
  deriveScenarioEditorMapSimulation,
  fillScenarioEditorMapBaseTileId,
  fillScenarioEditorMapTileWord,
  recomputeScenarioEditorMapTerrain,
  type ScenarioEditorMapSpecialZoneKind,
  type ScenarioEditorMapTerrainRecomputeMode,
  type ScenarioEditorMapTerrainRecomputeOptions,
  type ScenarioEditorMapTool,
  type ScenarioEditorMapZoneKind,
  writeScenarioEditorMapBaseTileId,
  writeScenarioEditorMapTileWord,
} from './editor-map.ts';
import {
  createScenarioEditorInitialObjectiveDraft,
  createScenarioEditorObjectiveDraftFromBundle,
  type ScenarioEditorObjectiveDraft,
  type ScenarioEditorObjectivePredicate,
} from './editor-objective.ts';
import {
  createScenarioEditorInitialScriptDraft,
  createScenarioEditorScriptDraftFromBundle,
  type ScenarioEditorScriptDraft,
  type ScenarioEditorScriptEvent,
} from './editor-script.ts';

/**
 * Editor workbench sections for Stage 4 objective/script/behavior authoring navigation state.
 * Not from Micropolis C: this is editor-only UI flow state and has no direct C runtime equivalent.
 */
export const SCENARIO_EDITOR_MVP_VIEWS = [
  'metadata',
  'map',
  'map-final',
  'objective',
  'script',
  'behavior',
  'export',
] as const;

/**
 * Editor workbench sections for Stage 4 objective/script authoring navigation state.
 * Stage-parity note: predicate/event authoring and behavior-profile assignment are exposed in
 * Stage 4.1/4.2/4.3, while AI/image import remains deferred to Stage 5.
 * Not from Micropolis C: this is editor-only UI flow state and has no direct C runtime equivalent.
 */
export type ScenarioEditorWorkbenchView = (typeof SCENARIO_EDITOR_MVP_VIEWS)[number];

/**
 * Authoring draft state used by the scenario editor shell.
 * Maps map dimensions and tile cardinality to classic `WORLD_X/WORLD_Y` map storage from
 * `ref/micropolis/src/sim/s_alloc.c`; parity note: this state container itself is web-only.
 */
export interface ScenarioEditorState {
  readonly activeView: ScenarioEditorWorkbenchView;
  readonly behavior: ScenarioEditorBehaviorDraft;
  readonly bundle: ScenarioBundleV1;
  readonly mapEditor: ScenarioEditorMapEditorDraft;
  readonly objective: ScenarioEditorObjectiveDraft;
  readonly script: ScenarioEditorScriptDraft;
  readonly isDirty: boolean;
}

/**
 * Editor-only map-authoring settings that are not serialized into scenario bundles.
 * Not from Micropolis C: these are UI workflow preferences that control whether map edits
 * request terrain smoothing passes (`SmoothTrees`/`SmoothWater`/`SmoothRiver` in
 * `ref/micropolis/src/sim/s_gen.c` and `ref/micropolis/src/sim/terrain/terra.c`), plus
 * editor-only visualization overlays for terrain class readability.
 */
export interface ScenarioEditorMapEditorDraft {
  readonly autoSmoothingEnabled: boolean;
  readonly showBaseTileClassesEnabled: boolean;
}

/**
 * Editable metadata fields for the Stage 3 editor MVP.
 * Mirrors scenario start metadata (`startYear`, `startFunds`) from `LoadScenario`
 * rows in `ref/micropolis/src/sim/s_fileio.c`; key/name/description/tags are modern
 * JSON-bundle authoring fields with no 1:1 C struct equivalent.
 */
export type ScenarioEditorMetadataFields = Pick<
  ScenarioBundleV1,
  'key' | 'name' | 'description' | 'tags' | 'start'
>;

/**
 * Partial metadata update payload for reducer actions.
 * Not from Micropolis C: this is an editor-only patch model for immutable React state updates.
 */
export type ScenarioEditorMetadataPatch = Partial<
  Omit<ScenarioEditorMetadataFields, 'start'> & {
    start: Partial<ScenarioEditorMetadataFields['start']>;
  }
>;

/**
 * Metadata validation messages surfaced by the Stage 3 metadata form.
 * Uses the same contract constraints as `scenarioBundleV1Schema` from `@city/scenario-core`.
 */
export interface ScenarioEditorMetadataValidationIssues {
  readonly description?: string;
  readonly key?: string;
  readonly name?: string;
  readonly startFunds?: string;
  readonly startYear?: string;
  readonly tags?: string;
}

/**
 * Action set for the scenario editor reducer.
 * Not from Micropolis C: deterministic React reducer actions for editor UI state transitions.
 */
export type ScenarioEditorAction =
  | { type: 'mark-clean' }
  | { type: 'mark-dirty' }
  | {
      type: 'apply-map-tool';
      x: number;
      y: number;
      tool: ScenarioEditorMapTool;
      terrainRecomputeMode?: ScenarioEditorMapTerrainRecomputeMode;
    }
  | {
      type: 'apply-map-zone-level';
      x: number;
      y: number;
      zone: ScenarioEditorMapZoneKind;
      level: number;
      value: number;
      terrainRecomputeMode?: ScenarioEditorMapTerrainRecomputeMode;
    }
  | {
      type: 'apply-map-special-zone';
      x: number;
      y: number;
      zone: ScenarioEditorMapSpecialZoneKind;
      terrainRecomputeMode?: ScenarioEditorMapTerrainRecomputeMode;
    }
  | {
      type: 'derive-map-simulation';
      ticks: number;
    }
  | {
      type: 'fill-map';
      tileWord: number;
      terrainRecomputeMode?: ScenarioEditorMapTerrainRecomputeMode;
    }
  | {
      type: 'fill-map-base-tile';
      baseTileId: number;
      preserveFlags: boolean;
      terrainRecomputeMode?: ScenarioEditorMapTerrainRecomputeMode;
    }
  | {
      type: 'paint-map-base-tile';
      x: number;
      y: number;
      baseTileId: number;
      preserveFlags: boolean;
      terrainRecomputeMode?: ScenarioEditorMapTerrainRecomputeMode;
      terrainRecomputeRadius?: number;
    }
  | {
      type: 'paint-map-tile';
      x: number;
      y: number;
      tileWord: number;
      terrainRecomputeMode?: ScenarioEditorMapTerrainRecomputeMode;
      terrainRecomputeRadius?: number;
    }
  | { type: 'set-behavior-enabled'; enabled: boolean }
  | { type: 'set-behavior-profile-key'; profileKey: string }
  | { type: 'replace-objective-predicate'; predicate: ScenarioEditorObjectivePredicate }
  | { type: 'replace-script-events'; events: readonly ScenarioEditorScriptEvent[] }
  | { type: 'set-objective-enabled'; enabled: boolean }
  | { type: 'set-script-enabled'; enabled: boolean }
  | { type: 'set-map-auto-smoothing-enabled'; enabled: boolean }
  | { type: 'set-map-show-base-tile-classes-enabled'; enabled: boolean }
  | { type: 'update-metadata'; metadata: ScenarioEditorMetadataPatch }
  | { type: 'replace-bundle'; bundle: ScenarioBundleV1 }
  | { type: 'set-active-view'; view: ScenarioEditorWorkbenchView };

const DEFAULT_DRAFT_KEY = 'user/scenario-editor-draft';

const ScenarioEditorStateContext = createContext<ScenarioEditorState | null>(null);
const ScenarioEditorDispatchContext = createContext<Dispatch<ScenarioEditorAction> | null>(null);

/**
 * Creates a baseline editable scenario bundle for new editor sessions.
 * Mirrors fixed classic map geometry (`WORLD_X=120`, `WORLD_Y=100`) and empty tile initialization
 * with `DIRT` (`0`) from `ref/micropolis/src/sim/headers/sim.h`.
 * Parity note: bundle metadata defaults are editor-specific placeholders.
 */
export function createScenarioEditorInitialBundle(): ScenarioBundleV1 {
  return {
    version: 1,
    key: DEFAULT_DRAFT_KEY,
    name: 'Untitled Scenario',
    description: '',
    tags: [],
    start: {
      startYear: 1900,
      startFunds: 5000,
    },
    map: {
      kind: 'tile-words',
      width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
      height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      tileWords: new Array<number>(SCENARIO_BUNDLE_V1_TILE_COUNT).fill(0),
    },
  };
}

/**
 * Creates initial editor reducer state for app boot.
 * Uses the same baseline map map dimensions as classic Micropolis world allocation in
 * `ref/micropolis/src/sim/s_alloc.c`; parity note: view/dirty flags are editor-only state.
 */
export function createScenarioEditorInitialState(): ScenarioEditorState {
  return {
    activeView: 'metadata',
    behavior: createScenarioEditorInitialBehaviorDraft(),
    bundle: createScenarioEditorInitialBundle(),
    mapEditor: {
      autoSmoothingEnabled: true,
      showBaseTileClassesEnabled: true,
    },
    objective: createScenarioEditorInitialObjectiveDraft(),
    script: createScenarioEditorInitialScriptDraft(),
    isDirty: false,
  };
}

/**
 * Reducer for deterministic editor-state transitions.
 * Not a Micropolis C port: this models modern UI state transitions while preserving immutable
 * updates suitable for deterministic undo/history extensions in later editor stages.
 */
export function scenarioEditorReducer(
  state: ScenarioEditorState,
  action: ScenarioEditorAction,
): ScenarioEditorState {
  switch (action.type) {
    case 'mark-clean':
      return {
        ...state,
        isDirty: false,
      };
    case 'mark-dirty':
      return {
        ...state,
        isDirty: true,
      };
    case 'apply-map-tool': {
      const nextBundle = applyScenarioEditorMapToolAtPoint(state.bundle, action, action.tool);
      return applyScenarioEditorMapMutation(state, nextBundle, {
        mode: action.terrainRecomputeMode,
      });
    }
    case 'apply-map-zone-level': {
      const nextBundle = applyScenarioEditorMapZoneLevelAtPoint(state.bundle, action, {
        zone: action.zone,
        level: action.level,
        value: action.value,
      });
      return applyScenarioEditorMapMutation(state, nextBundle, {
        mode: action.terrainRecomputeMode,
      });
    }
    case 'apply-map-special-zone': {
      const nextBundle = applyScenarioEditorMapSpecialZoneAtPoint(
        state.bundle,
        action,
        action.zone,
      );
      return applyScenarioEditorMapMutation(state, nextBundle, {
        mode: action.terrainRecomputeMode,
      });
    }
    case 'derive-map-simulation': {
      const nextBundle = deriveScenarioEditorMapSimulation(state.bundle, {
        ticks: action.ticks,
      });
      return applyScenarioEditorMapMutation(state, nextBundle, {
        mode: 'off',
      });
    }
    case 'fill-map': {
      const nextBundle = fillScenarioEditorMapTileWord(state.bundle, action.tileWord);
      return applyScenarioEditorMapMutation(state, nextBundle, {
        mode: action.terrainRecomputeMode,
      });
    }
    case 'fill-map-base-tile': {
      const nextBundle = fillScenarioEditorMapBaseTileId(state.bundle, action.baseTileId, {
        preserveFlags: action.preserveFlags,
      });
      return applyScenarioEditorMapMutation(state, nextBundle, {
        mode: action.terrainRecomputeMode,
      });
    }
    case 'paint-map-base-tile': {
      const nextBundle = writeScenarioEditorMapBaseTileId(state.bundle, action, action.baseTileId, {
        preserveFlags: action.preserveFlags,
      });
      return applyScenarioEditorMapMutation(
        state,
        nextBundle,
        toScenarioEditorPointRecomputeOptions(action),
      );
    }
    case 'paint-map-tile': {
      const nextBundle = writeScenarioEditorMapTileWord(state.bundle, action, action.tileWord);
      return applyScenarioEditorMapMutation(
        state,
        nextBundle,
        toScenarioEditorPointRecomputeOptions(action),
      );
    }
    case 'set-behavior-enabled':
      if (state.behavior.enabled === action.enabled) {
        return state;
      }
      return {
        ...state,
        behavior: {
          ...state.behavior,
          enabled: action.enabled,
        },
        isDirty: true,
      };
    case 'set-behavior-profile-key': {
      const nextProfileKey = action.profileKey.trim();
      if (state.behavior.profileKey === nextProfileKey) {
        return state;
      }
      return {
        ...state,
        behavior: {
          ...state.behavior,
          profileKey: nextProfileKey,
        },
        isDirty: true,
      };
    }
    case 'replace-objective-predicate':
      return {
        ...state,
        objective: {
          ...state.objective,
          predicate: action.predicate,
        },
        isDirty: true,
      };
    case 'set-objective-enabled':
      if (state.objective.enabled === action.enabled) {
        return state;
      }
      return {
        ...state,
        objective: {
          ...state.objective,
          enabled: action.enabled,
        },
        isDirty: true,
      };
    case 'replace-script-events':
      if (state.script.events === action.events) {
        return state;
      }
      return {
        ...state,
        script: {
          ...state.script,
          events: action.events,
        },
        isDirty: true,
      };
    case 'set-script-enabled':
      if (state.script.enabled === action.enabled) {
        return state;
      }
      return {
        ...state,
        script: {
          ...state.script,
          enabled: action.enabled,
        },
        isDirty: true,
      };
    case 'set-map-auto-smoothing-enabled':
      if (state.mapEditor.autoSmoothingEnabled === action.enabled) {
        return state;
      }
      return {
        ...state,
        mapEditor: {
          ...state.mapEditor,
          autoSmoothingEnabled: action.enabled,
        },
      };
    case 'set-map-show-base-tile-classes-enabled':
      if (state.mapEditor.showBaseTileClassesEnabled === action.enabled) {
        return state;
      }
      return {
        ...state,
        mapEditor: {
          ...state.mapEditor,
          showBaseTileClassesEnabled: action.enabled,
        },
      };
    case 'update-metadata':
      return {
        ...state,
        bundle: applyMetadataPatch(state.bundle, action.metadata),
        isDirty: true,
      };
    case 'replace-bundle':
      return {
        ...state,
        bundle: action.bundle,
        behavior: createScenarioEditorInitialBehaviorDraft(),
        objective: createScenarioEditorObjectiveDraftFromBundle(action.bundle),
        script: createScenarioEditorScriptDraftFromBundle(action.bundle),
        isDirty: false,
      };
    case 'set-active-view':
      return {
        ...state,
        activeView: action.view,
      };
    default:
      return state;
  }
}

/**
 * Apply one map mutation and run terrain post-processing.
 * Recompute mirrors terrain smoothing usage from `ref/micropolis/src/sim/s_gen.c`
 * and `ref/micropolis/src/sim/terrain/terra.c`, with editor-specific mode controls
 * (`global`/`local`/`off`) for precision workflows.
 */
function applyScenarioEditorMapMutation(
  state: ScenarioEditorState,
  mutatedBundle: ScenarioBundleV1,
  terrainRecompute: ScenarioEditorMapTerrainRecomputeOptions = {},
): ScenarioEditorState {
  if (mutatedBundle === state.bundle) {
    return state;
  }

  const terrainBundle = recomputeScenarioEditorMapTerrain(mutatedBundle, terrainRecompute);
  const nextBundle = deriveScenarioEditorMapPower(terrainBundle);
  return {
    ...state,
    bundle: nextBundle,
    isDirty: true,
  };
}

/**
 * Convert one point-based paint action into terrain recompute options.
 * Not from Micropolis C: editor-only control over whether smoothing is global/local/off.
 */
function toScenarioEditorPointRecomputeOptions(action: {
  readonly x: number;
  readonly y: number;
  readonly terrainRecomputeMode?: ScenarioEditorMapTerrainRecomputeMode;
  readonly terrainRecomputeRadius?: number;
}): ScenarioEditorMapTerrainRecomputeOptions {
  const mode = action.terrainRecomputeMode ?? 'global';
  if (mode !== 'local') {
    return { mode };
  }
  return {
    mode,
    center: { x: action.x, y: action.y },
    radius: action.terrainRecomputeRadius,
  };
}

/**
 * Root provider for editor state/dispatch contexts.
 * Not from Micropolis C: React context composition for editor shell wiring.
 */
export function ScenarioEditorStateProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(
    scenarioEditorReducer,
    undefined,
    createScenarioEditorInitialState,
  );
  const stableState = useMemo(() => state, [state]);

  return (
    <ScenarioEditorDispatchContext.Provider value={dispatch}>
      <ScenarioEditorStateContext.Provider value={stableState}>
        {children}
      </ScenarioEditorStateContext.Provider>
    </ScenarioEditorDispatchContext.Provider>
  );
}

/**
 * Reads editor state from context.
 * Not from Micropolis C: typed hook wrapper for React context consumption.
 */
export function useScenarioEditorState(): ScenarioEditorState {
  const state = useContext(ScenarioEditorStateContext);
  if (state === null) {
    throw new Error('useScenarioEditorState must be used within ScenarioEditorStateProvider');
  }

  return state;
}

/**
 * Reads editor dispatch function from context.
 * Not from Micropolis C: typed hook wrapper for reducer action dispatch.
 */
export function useScenarioEditorDispatch(): Dispatch<ScenarioEditorAction> {
  const dispatch = useContext(ScenarioEditorDispatchContext);
  if (dispatch === null) {
    throw new Error('useScenarioEditorDispatch must be used within ScenarioEditorStateProvider');
  }

  return dispatch;
}

/**
 * Parse a free-form tags string into canonical scenario tags.
 * Not from Micropolis C: Stage 3 editor convenience helper for converting user input
 * into `ScenarioBundleV1.tags` array values.
 */
export function parseScenarioEditorTagsInput(tagsText: string): string[] {
  return tagsText
    .split(/[\n,]/)
    .map((rawTag) => rawTag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * Validate metadata fields using canonical scenario bundle schema rules.
 * Reuses Stage 0 contract checks from `scenarioBundleV1Schema`, including key namespace
 * rules that replace legacy numeric scenario id routing from `LoadScenario`.
 */
export function getScenarioEditorMetadataValidationIssues(
  bundle: ScenarioBundleV1,
): ScenarioEditorMetadataValidationIssues {
  const result = scenarioBundleV1Schema.safeParse(bundle);
  if (result.success) {
    return {};
  }

  const issues: {
    description?: string;
    key?: string;
    name?: string;
    startFunds?: string;
    startYear?: string;
    tags?: string;
  } = {};

  for (const issue of result.error.issues) {
    const pathHead = issue.path[0];
    const pathTail = issue.path[1];
    if (pathHead === 'description' && issues.description === undefined) {
      issues.description = issue.message;
      continue;
    }
    if (pathHead === 'key' && issues.key === undefined) {
      issues.key = issue.message;
      continue;
    }
    if (pathHead === 'name' && issues.name === undefined) {
      issues.name = issue.message;
      continue;
    }
    if (pathHead === 'tags' && issues.tags === undefined) {
      issues.tags = issue.message;
      continue;
    }
    if (pathHead === 'start' && pathTail === 'startYear' && issues.startYear === undefined) {
      issues.startYear = issue.message;
      continue;
    }
    if (pathHead === 'start' && pathTail === 'startFunds' && issues.startFunds === undefined) {
      issues.startFunds = issue.message;
    }
  }

  return issues;
}

/**
 * Apply a metadata patch while preserving the existing scenario map payload.
 * Not a Micropolis C port: immutable bundle patching for React reducer updates.
 */
function applyMetadataPatch(
  bundle: ScenarioBundleV1,
  metadata: ScenarioEditorMetadataPatch,
): ScenarioBundleV1 {
  const nextStart =
    metadata.start === undefined
      ? bundle.start
      : {
          ...bundle.start,
          ...metadata.start,
        };

  return {
    ...bundle,
    ...metadata,
    start: nextStart,
  };
}
