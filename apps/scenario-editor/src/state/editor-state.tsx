import {
  SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  SCENARIO_BUNDLE_V1_MAP_WIDTH,
  SCENARIO_BUNDLE_V1_TILE_COUNT,
  type ScenarioBundleV1,
} from '@city/scenario-core';
import {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  useContext,
  useMemo,
  useReducer,
} from 'react';

/**
 * Editor workbench sections for Stage 3 MVP navigation state.
 * Not from Micropolis C: this is editor-only UI flow state and has no direct C runtime equivalent.
 */
export type ScenarioEditorWorkbenchView = 'metadata' | 'map' | 'export';

/**
 * Authoring draft state used by the scenario editor shell.
 * Maps map dimensions and tile cardinality to classic `WORLD_X/WORLD_Y` map storage from
 * `ref/micropolis/src/sim/s_alloc.c`; parity note: this state container itself is web-only.
 */
export interface ScenarioEditorState {
  readonly activeView: ScenarioEditorWorkbenchView;
  readonly bundle: ScenarioBundleV1;
  readonly isDirty: boolean;
}

/**
 * Action set for the scenario editor reducer.
 * Not from Micropolis C: deterministic React reducer actions for editor UI state transitions.
 */
export type ScenarioEditorAction =
  | { type: 'mark-clean' }
  | { type: 'mark-dirty' }
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
    case 'replace-bundle':
      return {
        ...state,
        bundle: action.bundle,
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
