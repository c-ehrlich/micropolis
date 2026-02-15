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

import { fillScenarioEditorMapTileWord, writeScenarioEditorMapTileWord } from './editor-map.ts';
import {
  createScenarioEditorInitialObjectiveDraft,
  type ScenarioEditorObjectiveDraft,
  type ScenarioEditorObjectivePredicate,
} from './editor-objective.ts';
import {
  createScenarioEditorInitialScriptDraft,
  type ScenarioEditorScriptDraft,
  type ScenarioEditorScriptEvent,
} from './editor-script.ts';

/**
 * Editor workbench sections for Stage 4 objective/script authoring navigation state.
 * Not from Micropolis C: this is editor-only UI flow state and has no direct C runtime equivalent.
 */
export const SCENARIO_EDITOR_MVP_VIEWS = [
  'metadata',
  'map',
  'objective',
  'script',
  'export',
] as const;

/**
 * Editor workbench sections for Stage 4 objective/script authoring navigation state.
 * Stage-parity note: predicate and event/action authoring are exposed in Stage 4.1/4.2, while
 * behavior-profile authoring remains deferred to Stage 4.3 and AI/image import remains Stage 5.
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
  readonly bundle: ScenarioBundleV1;
  readonly objective: ScenarioEditorObjectiveDraft;
  readonly script: ScenarioEditorScriptDraft;
  readonly isDirty: boolean;
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
  | { type: 'fill-map'; tileWord: number }
  | { type: 'paint-map-tile'; x: number; y: number; tileWord: number }
  | { type: 'replace-objective-predicate'; predicate: ScenarioEditorObjectivePredicate }
  | { type: 'replace-script-events'; events: readonly ScenarioEditorScriptEvent[] }
  | { type: 'set-objective-enabled'; enabled: boolean }
  | { type: 'set-script-enabled'; enabled: boolean }
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
    bundle: createScenarioEditorInitialBundle(),
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
    case 'fill-map': {
      const nextBundle = fillScenarioEditorMapTileWord(state.bundle, action.tileWord);
      if (nextBundle === state.bundle) {
        return state;
      }
      return {
        ...state,
        bundle: nextBundle,
        isDirty: true,
      };
    }
    case 'paint-map-tile': {
      const nextBundle = writeScenarioEditorMapTileWord(state.bundle, action, action.tileWord);
      if (nextBundle === state.bundle) {
        return state;
      }
      return {
        ...state,
        bundle: nextBundle,
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
        objective: createScenarioEditorInitialObjectiveDraft(),
        script: createScenarioEditorInitialScriptDraft(),
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
