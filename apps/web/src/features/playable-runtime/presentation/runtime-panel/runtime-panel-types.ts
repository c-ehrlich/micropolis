import type { PlayableDisasterChoiceId } from '../../../../game/runtime/playable-runtime-host.ts';
import type { PlayableGameLevel, PlayableSimSpeed } from '../../../../game/runtime/protocol.ts';
import type { RuntimeTilesetName } from '../../../../presentation/map/tile-sprite-atlas.ts';
import type {
  GameDialogKind,
  RuntimeFloatingWindowId,
  TopMenubarSection,
  useFloatingWindowsState,
  useRuntimeSession,
  useRuntimeUiState,
} from '../../behavior/runtime-panel-controller.ts';

/**
 * Shared controller aliases for runtime-panel presentation modules.
 * Mirrors route-level UI/session/window coordination from
 * `ref/micropolis/res/whead.tcl` and `ref/micropolis/src/sim/w_update.c`.
 */
export type RuntimeUiController = ReturnType<typeof useRuntimeUiState>;
export type RuntimeSessionController = ReturnType<typeof useRuntimeSession>;
export type RuntimeFloatingWindowsController = ReturnType<typeof useFloatingWindowsState>;
export type RuntimeBudgetState = RuntimeSessionController['state']['hudState']['budget'];
export type RuntimeOpenFloatingWindow = (windowId: RuntimeFloatingWindowId) => void;

/**
 * Semantically grouped write/command actions for runtime-panel presentation.
 * Mirrors route-level command dispatch ownership from `ref/micropolis/src/sim/w_update.c`
 * while keeping React presentation components free of direct controller mutation calls.
 */
export interface RuntimePanelActions {
  closeBrandDialog: () => void;
  closeFloatingWindow: (windowId: RuntimeFloatingWindowId) => void;
  closeGameDialog: () => void;
  closeMenu: () => void;
  closeSpeedMenu: () => void;
  dismissNotice: (signature: string | null) => void;
  focusFloatingWindow: (windowId: RuntimeFloatingWindowId) => void;
  loadPendingCityFile: () => Promise<void>;
  openBrandDialog: () => void;
  openFloatingWindow: RuntimeOpenFloatingWindow;
  openGameDialog: (kind: GameDialogKind) => void;
  placeTool: (tool: RuntimeUiController['activeTool'], x: number, y: number) => void;
  playPauseSimulation: () => void;
  reconnectRuntime: () => void;
  requestResyncSnapshot: () => void;
  saveCityFromDraft: () => void;
  selectScenario: (scenarioId: number) => void;
  selectTool: RuntimeUiController['setActiveTool'];
  setBudgetAuto: (enabled: boolean) => void;
  setBudgetFirePercent: (percent: number) => void;
  setBudgetPolicePercent: (percent: number) => void;
  setBudgetRoadPercent: (percent: number) => void;
  setBudgetTaxRate: (taxRate: number) => void;
  setGameLevel: (level: PlayableGameLevel) => void;
  setGraphMask: RuntimeUiController['setGraphMask'];
  setGraphRange: RuntimeUiController['setGraphRange'];
  setPendingLoadFile: (file: File | null) => void;
  setRuntimeTileset: (tileset: RuntimeTilesetName) => void;
  setSaveFileNameDraft: (draft: string) => void;
  setSimulationSpeed: (speed: PlayableSimSpeed) => void;
  showAllGraphSeries: () => void;
  startFloatingWindowDrag: RuntimeFloatingWindowsController['startFloatingWindowDrag'];
  startNewCity: () => void;
  startScenario: () => void;
  toggleGameplayMuted: () => void;
  toggleGraphSeriesBit: (bit: number) => void;
  toggleMenu: (section: TopMenubarSection) => void;
  toggleSpeedMenu: () => void;
  triggerDisaster: (disasterId: PlayableDisasterChoiceId, label: string) => void;
}

/**
 * Focused action bundles consumed by presentation sections.
 * Mirrors Tcl menu/dialog/window command grouping in
 * `ref/micropolis/res/whead.tcl`, adapted to route-owned React actions.
 */
export type RuntimeBrandActions = Pick<RuntimePanelActions, 'closeBrandDialog' | 'openBrandDialog'>;
export type RuntimeBudgetActions = Pick<
  RuntimePanelActions,
  | 'setBudgetAuto'
  | 'setBudgetFirePercent'
  | 'setBudgetPolicePercent'
  | 'setBudgetRoadPercent'
  | 'setBudgetTaxRate'
>;
export type RuntimeDialogActions = Pick<
  RuntimePanelActions,
  | 'closeGameDialog'
  | 'loadPendingCityFile'
  | 'saveCityFromDraft'
  | 'selectScenario'
  | 'setGameLevel'
  | 'setPendingLoadFile'
  | 'setSaveFileNameDraft'
  | 'startNewCity'
  | 'startScenario'
>;
export type RuntimeGraphActions = Pick<
  RuntimePanelActions,
  'setGraphMask' | 'setGraphRange' | 'showAllGraphSeries' | 'toggleGraphSeriesBit'
>;
export type RuntimeMenuActions = Pick<
  RuntimePanelActions,
  | 'closeMenu'
  | 'openBrandDialog'
  | 'openFloatingWindow'
  | 'openGameDialog'
  | 'reconnectRuntime'
  | 'requestResyncSnapshot'
  | 'setPendingLoadFile'
  | 'setRuntimeTileset'
  | 'setSaveFileNameDraft'
  | 'toggleMenu'
  | 'triggerDisaster'
>;
export type RuntimeNoticeActions = Pick<RuntimePanelActions, 'dismissNotice'>;
export type RuntimeSimulationActions = Pick<
  RuntimePanelActions,
  'playPauseSimulation' | 'toggleGameplayMuted'
>;
export type RuntimeSpeedActions = Pick<
  RuntimePanelActions,
  'closeSpeedMenu' | 'setSimulationSpeed' | 'toggleSpeedMenu'
>;
export type RuntimeToolActions = Pick<RuntimePanelActions, 'placeTool' | 'selectTool'>;
export type RuntimeWindowActions = Pick<
  RuntimePanelActions,
  'closeFloatingWindow' | 'focusFloatingWindow' | 'openFloatingWindow' | 'startFloatingWindowDrag'
>;
