import { type CSSProperties, type MutableRefObject, type RefObject } from 'react';

import { getPlayableToolSpec } from '../../../../game/runtime/index.ts';
import { MapCanvas } from '../../../../presentation/map/map-canvas.tsx';
import { type RuntimeLayoutInsets } from '../../behavior/runtime-panel-controller.ts';
import { NoticePanel } from '../runtime-panel-components.tsx';
import { RuntimeBrandDialog } from './dialogs/brand-dialog.tsx';
import { RuntimeGameDialogs } from './dialogs/game-dialogs.tsx';
import { RuntimeFloatingWindowsLayer } from './floating-windows/floating-windows-layer.tsx';
import { MAP_TILE_SIZE } from './runtime-panel-constants.ts';
import type {
  RuntimeBrandActions,
  RuntimeBudgetActions,
  RuntimeBudgetState,
  RuntimeDialogActions,
  RuntimeFloatingWindowsController,
  RuntimeGraphActions,
  RuntimeMenuActions,
  RuntimeNoticeActions,
  RuntimePanelActions,
  RuntimeSessionController,
  RuntimeSimulationActions,
  RuntimeSpeedActions,
  RuntimeToolActions,
  RuntimeUiController,
  RuntimeWindowActions,
} from './runtime-panel-types.ts';
import { RuntimeMessageFeedDock } from './sections/message-feed-dock.tsx';
import { RuntimeSidebarSection } from './sections/sidebar.tsx';
import { RuntimeTopBarSection } from './sections/top-bar.tsx';

interface RuntimePanelViewProps {
  activeNoticeSignature: string | null;
  actions: RuntimePanelActions;
  applyBudgetControlState: (nextBudgetState: RuntimeBudgetState) => void;
  budgetWindowOriginalStateRef: MutableRefObject<RuntimeBudgetState>;
  floating: RuntimeFloatingWindowsController;
  layoutInsets: RuntimeLayoutInsets;
  loadInputRef: RefObject<HTMLInputElement | null>;
  menubarRef: RefObject<HTMLElement | null>;
  runtimeTheme: CSSProperties;
  session: RuntimeSessionController;
  sessionControlsDisabled: boolean;
  sidebarRef: RefObject<HTMLElement | null>;
  speedControlRef: RefObject<HTMLDivElement | null>;
  ui: RuntimeUiController;
  visibleNotice: RuntimeSessionController['state']['hudState']['notice'];
}

/**
 * Runtime panel presentation surface for map + chrome sections.
 * Mirrors the single-screen runtime composition from
 * `ref/micropolis/src/sim/w_map.c`, `w_tool.c`, and `w_update.c`.
 */
export function RuntimePanelView(props: RuntimePanelViewProps) {
  const {
    activeNoticeSignature,
    actions,
    applyBudgetControlState,
    budgetWindowOriginalStateRef,
    floating,
    layoutInsets,
    loadInputRef,
    menubarRef,
    runtimeTheme,
    session,
    sessionControlsDisabled,
    sidebarRef,
    speedControlRef,
    ui,
    visibleNotice,
  } = props;

  const activeToolSpec = getPlayableToolSpec(ui.activeTool);
  const isClassicBwTheme = ui.selectedRuntimeTileset === 'classicbw';
  const brandActions: RuntimeBrandActions = {
    closeBrandDialog: actions.closeBrandDialog,
    openBrandDialog: actions.openBrandDialog,
  };
  const budgetActions: RuntimeBudgetActions = {
    setBudgetAuto: actions.setBudgetAuto,
    setBudgetFirePercent: actions.setBudgetFirePercent,
    setBudgetPolicePercent: actions.setBudgetPolicePercent,
    setBudgetRoadPercent: actions.setBudgetRoadPercent,
    setBudgetTaxRate: actions.setBudgetTaxRate,
  };
  const dialogActions: RuntimeDialogActions = {
    closeGameDialog: actions.closeGameDialog,
    loadPendingCityFile: actions.loadPendingCityFile,
    regenerateNewCityTerrainSeed: actions.regenerateNewCityTerrainSeed,
    saveCityFromDraft: actions.saveCityFromDraft,
    selectScenarioKey: actions.selectScenarioKey,
    setGameLevel: actions.setGameLevel,
    setPendingLoadFile: actions.setPendingLoadFile,
    setSaveFileNameDraft: actions.setSaveFileNameDraft,
    startNewCity: actions.startNewCity,
    startScenario: actions.startScenario,
  };
  const graphActions: RuntimeGraphActions = {
    setGraphMask: actions.setGraphMask,
    setGraphRange: actions.setGraphRange,
    showAllGraphSeries: actions.showAllGraphSeries,
    toggleGraphSeriesBit: actions.toggleGraphSeriesBit,
  };
  const menuActions: RuntimeMenuActions = {
    closeMenu: actions.closeMenu,
    openBrandDialog: actions.openBrandDialog,
    openFloatingWindow: actions.openFloatingWindow,
    openGameDialog: actions.openGameDialog,
    reconnectRuntime: actions.reconnectRuntime,
    requestResyncSnapshot: actions.requestResyncSnapshot,
    setPendingLoadFile: actions.setPendingLoadFile,
    setRuntimeTileset: actions.setRuntimeTileset,
    setSaveFileNameDraft: actions.setSaveFileNameDraft,
    toggleMenu: actions.toggleMenu,
    triggerDisaster: actions.triggerDisaster,
  };
  const noticeActions: RuntimeNoticeActions = {
    dismissNotice: actions.dismissNotice,
  };
  const simulationActions: RuntimeSimulationActions = {
    playPauseSimulation: actions.playPauseSimulation,
    toggleGameplayMuted: actions.toggleGameplayMuted,
  };
  const speedActions: RuntimeSpeedActions = {
    closeSpeedMenu: actions.closeSpeedMenu,
    setSimulationSpeed: actions.setSimulationSpeed,
    toggleSpeedMenu: actions.toggleSpeedMenu,
  };
  const toolActions: RuntimeToolActions = {
    placeTool: actions.placeTool,
    selectTool: actions.selectTool,
  };
  const windowActions: RuntimeWindowActions = {
    closeFloatingWindow: actions.closeFloatingWindow,
    focusFloatingWindow: actions.focusFloatingWindow,
    openFloatingWindow: actions.openFloatingWindow,
    startFloatingWindowDrag: actions.startFloatingWindowDrag,
  };

  return (
    <section
      className={`relative h-full w-full overflow-hidden [--runtime-top-bar-padding-y:4px] [--runtime-top-bar-height:calc(var(--window-control-size)+(var(--runtime-top-bar-padding-y)*2))] [--runtime-sidebar-width:94px] text-[var(--color-black)] [font-family:var(--ui-font),sans-serif] [font-size:var(--ui-font-size)] ${
        isClassicBwTheme ? 'grayscale' : ''
      }`}
      style={runtimeTheme}
    >
      <div
        className="absolute right-0 bottom-0"
        style={{ left: layoutInsets.left, top: layoutInsets.top }}
      >
        <MapCanvas
          dragPlacementEnabled={!sessionControlsDisabled && activeToolSpec.size === 1}
          hoverTool={sessionControlsDisabled ? undefined : ui.activeTool}
          mapState={session.state.mapState}
          onTileClick={(x, y) => {
            toolActions.placeTool(ui.activeTool, x, y);
          }}
          pendingTools={session.state.pendingTools}
          realtimeObjects={session.state.realtimeState.objects}
          tileSize={MAP_TILE_SIZE}
          tilesetName={ui.selectedRuntimeTileset}
        />
      </div>

      <RuntimeTopBarSection
        menuActions={menuActions}
        menubarRef={menubarRef}
        session={session}
        sessionControlsDisabled={sessionControlsDisabled}
        simulationActions={simulationActions}
        speedActions={speedActions}
        speedControlRef={speedControlRef}
        ui={ui}
      />

      {visibleNotice === null ? null : (
        <NoticePanel
          notice={visibleNotice}
          onDismiss={() => {
            noticeActions.dismissNotice(activeNoticeSignature);
          }}
          topInsetPx={layoutInsets.top}
        />
      )}

      <RuntimeSidebarSection
        toolActions={toolActions}
        session={session}
        sessionControlsDisabled={sessionControlsDisabled}
        sidebarRef={sidebarRef}
        topInsetPx={layoutInsets.top}
        ui={ui}
        windowActions={windowActions}
      />

      <RuntimeMessageFeedDock session={session} />

      <RuntimeFloatingWindowsLayer
        applyBudgetControlState={applyBudgetControlState}
        budgetActions={budgetActions}
        budgetWindowOriginalStateRef={budgetWindowOriginalStateRef}
        floating={floating}
        graphActions={graphActions}
        graphMask={ui.graphMask}
        graphRange={ui.graphRange}
        session={session}
        sessionControlsDisabled={sessionControlsDisabled}
        windowActions={windowActions}
      />

      <RuntimeBrandDialog actions={brandActions} isOpen={ui.isBrandDialogOpen} />

      <RuntimeGameDialogs
        dialogActions={dialogActions}
        isLoadingCityFile={ui.isLoadingCityFile}
        newCityTerrainSeed={ui.newCityTerrainSeed}
        pendingLoadFile={ui.pendingLoadFile}
        selectedGameLevel={ui.selectedGameLevel}
        selectedScenarioKey={ui.selectedScenarioKey}
        gameDialog={ui.gameDialog}
        loadInputRef={loadInputRef}
        controlsDisabled={session.controlsDisabled}
        saveFileNameDraft={ui.saveFileNameDraft}
        sessionControlsDisabled={sessionControlsDisabled}
      />
    </section>
  );
}
