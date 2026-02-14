import { getAllThemes, getThemeVars } from '@city/classicyui';
import { useHotkey } from '@tanstack/react-hotkeys';
import { createFileRoute } from '@tanstack/react-router';
import { type CSSProperties, useCallback, useEffect, useRef } from 'react';

import {
  downloadCityBytes,
  normalizeCitySaveFileName,
  triggerRouteDisasterControl,
} from '../features/playable-runtime/behavior/runtime-panel-behavior.ts';
import {
  type RuntimeFloatingWindowId,
  useFloatingWindowsState,
  useRuntimeLayoutInsets,
  useRuntimeSession,
  useRuntimeUiState,
} from '../features/playable-runtime/behavior/runtime-panel-controller.ts';
import { ALL_GRAPH_SERIES_MASK } from '../features/playable-runtime/presentation/runtime-panel/runtime-panel-constants.ts';
import { type RuntimePanelActions } from '../features/playable-runtime/presentation/runtime-panel/runtime-panel-types.ts';
import { RuntimePanelView } from '../features/playable-runtime/presentation/runtime-panel/runtime-panel-view.tsx';
import {
  type CityExportPayload,
  PLAYABLE_SCENARIO_CHOICES,
} from '../game/runtime/playable-runtime-host.ts';
import type { PlayableToolName } from '../game/runtime/protocol.ts';

export const Route = createFileRoute('/')({
  component: HomePage,
});

const RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS = {
  ignoreInputs: true,
  preventDefault: true,
  requireReset: true,
  stopPropagation: true,
} as const;

/**
 * Runtime keyboard shortcuts for tool selection and window opening.
 * Mirrors classic tool/menu intent from `ref/micropolis/src/sim/w_tool.c` and
 * `ref/micropolis/res/whead.tcl`.
 * Difference: this is a web-specific single-key map powered by TanStack Hotkeys.
 */
function useRuntimePanelHotkeys(options: {
  selectTool: (tool: PlayableToolName) => void;
  openFloatingWindow: (windowId: RuntimeFloatingWindowId) => void;
}): void {
  const { openFloatingWindow, selectTool } = options;

  useHotkey(
    'R',
    () => {
      selectTool('res');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'C',
    () => {
      selectTool('com');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'I',
    () => {
      selectTool('ind');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'F',
    () => {
      selectTool('fire');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'Q',
    () => {
      selectTool('query');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'P',
    () => {
      selectTool('police');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'W',
    () => {
      selectTool('wire');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'Z',
    () => {
      selectTool('bulldoze');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'L',
    () => {
      selectTool('rail');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'O',
    () => {
      selectTool('road');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'M',
    () => {
      selectTool('stadium');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'K',
    () => {
      selectTool('park');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'S',
    () => {
      selectTool('seaport');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'T',
    () => {
      selectTool('coal');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'N',
    () => {
      selectTool('nuclear');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'A',
    () => {
      selectTool('airport');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'B',
    () => {
      openFloatingWindow('budget');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'E',
    () => {
      openFloatingWindow('evaluation');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
  useHotkey(
    'G',
    () => {
      openFloatingWindow('graph');
    },
    RUNTIME_SINGLE_KEY_HOTKEY_OPTIONS,
  );
}

/**
 * Primary Authoritative Runtime gameplay route rendered at `/`.
 * Mirrors the single command-surface gameplay intent from `w_sim.c` in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: route wiring imports a Authoritative Runtime primary-host surface so users do
 * not depend on demo-only host controls in the default gameplay path.
 */
function HomePage() {
  return (
    <main className="fixed inset-0 overflow-hidden">
      <RuntimePanel />
    </main>
  );
}

/**
 * Authoritative Runtime route panel that renders map, HUD, controls, and message feed from host envelopes.
 * Mirrors map/tool/heads flows in `ref/micropolis/src/sim/w_map.c`,
 * `ref/micropolis/src/sim/w_tool.c`, `ref/micropolis/src/sim/w_update.c`, and
 * `ref/micropolis/src/sim/s_msg.c`, adapted to React + typed bridge state.
 * Parity note: this replaces the earlier Authoritative Runtime placement-only primary panel
 * with the full authoritative map/HUD/control projection path.
 */
function RuntimePanel() {
  const ui = useRuntimeUiState();
  const {
    applyCityExportPayload,
    dismissedNoticeSignature,
    hasStartedPlayableSession,
    isLoadingCityFile,
    isSpeedMenuOpen,
    openMenubarSection,
    pendingLoadFile,
    saveFileNameDraft,
    selectedGameLevel,
    selectedScenarioId,
    setActiveTool,
    setCityIoError,
    setDismissedNoticeSignature,
    setGameDialog,
    setGraphMask,
    setGraphRange,
    setHasStartedPlayableSession,
    setIsBrandDialogOpen,
    setIsLoadingCityFile,
    setIsSpeedMenuOpen,
    setLastSaveStatus,
    setOpenMenubarSection,
    setPendingLoadFile,
    setSaveFileName,
    setSaveFileNameDraft,
    setSelectedGameLevel,
    setSelectedRuntimeTileset,
    setSelectedScenarioId,
  } = ui;

  const onCityExport = useCallback(
    (payload: CityExportPayload): void => {
      downloadCityBytes(payload.fileName, payload.cityBytes);
      applyCityExportPayload(payload);
    },
    [applyCityExportPayload],
  );

  const session = useRuntimeSession({ onCityExport });
  const {
    controlsDisabled,
    host,
    isSimulationRunning,
    reconnect,
    requestResyncSnapshot,
    sendCityIoCommand,
    sendCityLifecycleCommand,
    sendScenarioCommand,
    sendSimControlCommand,
    sendToolCommand,
    state,
    toggleGameplayMuted,
  } = session;
  const floating = useFloatingWindowsState();
  const { openFloatingWindow: openFloatingWindowBase } = floating;
  const runtimeBudget = state.hudState.budget;

  const budgetWindowOriginalStateRef = useRef({ ...runtimeBudget });
  const menubarRef = useRef<HTMLElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const speedControlRef = useRef<HTMLDivElement | null>(null);
  const loadInputRef = useRef<HTMLInputElement | null>(null);
  const handledLoseNoticeServerSeq = useRef(0);
  const layoutInsets = useRuntimeLayoutInsets({ menubarRef, sidebarRef });

  const sessionControlsDisabled = controlsDisabled || !hasStartedPlayableSession;
  const openFloatingWindow = useCallback(
    (windowId: RuntimeFloatingWindowId): void => {
      openFloatingWindowBase(windowId);
      if (windowId !== 'budget') {
        return;
      }
      budgetWindowOriginalStateRef.current = { ...runtimeBudget };
      if (!sessionControlsDisabled) {
        sendSimControlCommand({
          kind: 'sim-control',
          control: 'open-budget-from-menu',
        });
      }
    },
    [openFloatingWindowBase, runtimeBudget, sendSimControlCommand, sessionControlsDisabled],
  );

  useRuntimePanelHotkeys({
    openFloatingWindow,
    selectTool: setActiveTool,
  });

  /**
   * Applies one full budget control state to authoritative sim runtime.
   * Mirrors `BudgetReset` restore semantics in `ref/micropolis/res/micropolis.tcl`.
   */
  const applyBudgetControlState = useCallback(
    (nextBudgetState: typeof runtimeBudget): void => {
      if (sessionControlsDisabled) {
        return;
      }
      sendSimControlCommand({
        kind: 'sim-control',
        control: 'set-tax-rate',
        taxRate: nextBudgetState.taxRate,
      });
      sendSimControlCommand({
        kind: 'sim-control',
        control: 'set-road-percent',
        percent: nextBudgetState.roadPercent,
      });
      sendSimControlCommand({
        kind: 'sim-control',
        control: 'set-fire-percent',
        percent: nextBudgetState.firePercent,
      });
      sendSimControlCommand({
        kind: 'sim-control',
        control: 'set-police-percent',
        percent: nextBudgetState.policePercent,
      });
      sendSimControlCommand({
        kind: 'sim-control',
        control: 'set-auto-budget',
        enabled: nextBudgetState.autoBudget,
      });
    },
    [sendSimControlCommand, sessionControlsDisabled],
  );

  const closeTopBarOverlays = useCallback((): void => {
    setOpenMenubarSection(null);
    setIsSpeedMenuOpen(false);
  }, [setIsSpeedMenuOpen, setOpenMenubarSection]);

  const toggleMenu = useCallback(
    (section: 'micropolis' | 'windows' | 'disasters' | 'settings'): void => {
      setOpenMenubarSection((current) => (current === section ? null : section));
      setIsSpeedMenuOpen(false);
    },
    [setIsSpeedMenuOpen, setOpenMenubarSection],
  );

  const toggleSpeedMenu = useCallback((): void => {
    setOpenMenubarSection(null);
    setIsSpeedMenuOpen((current) => !current);
  }, [setIsSpeedMenuOpen, setOpenMenubarSection]);

  const openBrandDialog = useCallback((): void => {
    closeTopBarOverlays();
    setIsBrandDialogOpen(true);
  }, [closeTopBarOverlays, setIsBrandDialogOpen]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (openMenubarSection !== null) {
        const menuRoot = menubarRef.current;
        if (menuRoot === null || !menuRoot.contains(event.target)) {
          setOpenMenubarSection(null);
        }
      }
      if (isSpeedMenuOpen) {
        const speedRoot = speedControlRef.current;
        if (speedRoot === null || !speedRoot.contains(event.target)) {
          setIsSpeedMenuOpen(false);
        }
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      closeTopBarOverlays();
      if (!isLoadingCityFile) {
        setGameDialog(null);
      }
      setIsBrandDialogOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isSpeedMenuOpen,
    isLoadingCityFile,
    openMenubarSection,
    setGameDialog,
    setIsBrandDialogOpen,
    setIsSpeedMenuOpen,
    setOpenMenubarSection,
    closeTopBarOverlays,
  ]);

  const activeNotice = state.hudState.notice;
  const activeNoticeSignature =
    activeNotice === null ? null : `${activeNotice.serverSeq}:${activeNotice.id}`;
  const visibleNotice =
    !state.hudState.options.doNotices ||
    activeNotice === null ||
    activeNoticeSignature === dismissedNoticeSignature
      ? null
      : activeNotice;

  const theme = getAllThemes()[0];
  const runtimeTheme = theme === undefined ? {} : getThemeVars(theme);

  const actions: RuntimePanelActions = {
    closeBrandDialog: () => {
      setIsBrandDialogOpen(false);
    },
    closeFloatingWindow: (windowId) => {
      floating.closeFloatingWindow(windowId);
    },
    closeGameDialog: () => {
      setGameDialog(null);
    },
    closeMenu: () => {
      setOpenMenubarSection(null);
    },
    closeSpeedMenu: () => {
      setIsSpeedMenuOpen(false);
    },
    dismissNotice: (signature) => {
      setDismissedNoticeSignature(signature);
    },
    focusFloatingWindow: (windowId) => {
      floating.focusFloatingWindow(windowId);
    },
    loadPendingCityFile: async () => {
      if (pendingLoadFile === null || controlsDisabled) {
        return;
      }

      setIsLoadingCityFile(true);
      try {
        const cityBytes = new Uint8Array(await pendingLoadFile.arrayBuffer());
        setHasStartedPlayableSession(true);
        setSaveFileName(pendingLoadFile.name);
        sendCityIoCommand({
          kind: 'city-io',
          action: 'load-city',
          fileName: pendingLoadFile.name,
          cityBytes,
        });
        setCityIoError('');
        setPendingLoadFile(null);
        setGameDialog(null);
      } catch {
        setCityIoError('Failed to read selected city file.');
      } finally {
        setIsLoadingCityFile(false);
      }
    },
    openBrandDialog,
    openFloatingWindow,
    openGameDialog: (kind) => {
      closeTopBarOverlays();
      setGameDialog(kind);
    },
    placeTool: (tool, x, y) => {
      if (sessionControlsDisabled) {
        return;
      }
      sendToolCommand(tool, x, y);
    },
    playPauseSimulation: () => {
      sendSimControlCommand({
        kind: 'sim-control',
        control: isSimulationRunning ? 'pause' : 'play',
      });
    },
    reconnectRuntime: () => {
      reconnect();
      setCityIoError('');
      setLastSaveStatus('');
    },
    requestResyncSnapshot: () => {
      requestResyncSnapshot();
    },
    saveCityFromDraft: () => {
      if (sessionControlsDisabled) {
        return;
      }
      const fileName = normalizeCitySaveFileName(saveFileNameDraft);
      setSaveFileName(fileName);
      sendCityIoCommand({
        kind: 'city-io',
        action: 'save-city',
        fileName,
      });
      setGameDialog(null);
    },
    selectScenario: (scenarioId) => {
      setSelectedScenarioId(scenarioId);
    },
    selectTool: (tool) => {
      setActiveTool(tool);
    },
    setBudgetAuto: (enabled) => {
      sendSimControlCommand({
        kind: 'sim-control',
        control: 'set-auto-budget',
        enabled,
      });
    },
    setBudgetFirePercent: (percent) => {
      sendSimControlCommand({
        kind: 'sim-control',
        control: 'set-fire-percent',
        percent,
      });
    },
    setBudgetPolicePercent: (percent) => {
      sendSimControlCommand({
        kind: 'sim-control',
        control: 'set-police-percent',
        percent,
      });
    },
    setBudgetRoadPercent: (percent) => {
      sendSimControlCommand({
        kind: 'sim-control',
        control: 'set-road-percent',
        percent,
      });
    },
    setBudgetTaxRate: (taxRate) => {
      sendSimControlCommand({
        kind: 'sim-control',
        control: 'set-tax-rate',
        taxRate,
      });
    },
    setGameLevel: (level) => {
      setSelectedGameLevel(level);
    },
    setGraphMask,
    setGraphRange,
    setPendingLoadFile: (file) => {
      setPendingLoadFile(file);
      if (file !== null) {
        setCityIoError('');
      }
    },
    setRuntimeTileset: (tileset) => {
      setSelectedRuntimeTileset(tileset);
    },
    setSaveFileNameDraft: (draft) => {
      setSaveFileNameDraft(draft);
    },
    setSimulationSpeed: (speed) => {
      sendSimControlCommand({
        kind: 'sim-control',
        control: 'set-speed',
        speed,
      });
    },
    showAllGraphSeries: () => {
      setGraphMask(ALL_GRAPH_SERIES_MASK);
    },
    startFloatingWindowDrag: (windowId, event) => {
      floating.startFloatingWindowDrag(windowId, event);
    },
    startNewCity: () => {
      if (controlsDisabled) {
        return;
      }
      setHasStartedPlayableSession(true);
      setSaveFileName('newcity.cty');
      sendCityLifecycleCommand({
        kind: 'city-lifecycle',
        action: 'new-city',
        gameLevel: selectedGameLevel,
      });
      setGameDialog(null);
    },
    startScenario: () => {
      if (controlsDisabled) {
        return;
      }
      setHasStartedPlayableSession(true);
      const scenario = PLAYABLE_SCENARIO_CHOICES.find((entry) => entry.id === selectedScenarioId);
      if (scenario !== undefined) {
        setSaveFileName(`${scenario.fileName}.cty`);
      }
      sendScenarioCommand({
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: selectedScenarioId,
        gameLevel: selectedGameLevel,
      });
      setGameDialog(null);
    },
    toggleGameplayMuted: () => {
      toggleGameplayMuted();
    },
    toggleGraphSeriesBit: (bit) => {
      setGraphMask((currentMask) => currentMask ^ bit);
    },
    toggleMenu,
    toggleSpeedMenu,
    triggerDisaster: (disasterId, label) => {
      triggerRouteDisasterControl(host, disasterId, label);
      setOpenMenubarSection(null);
    },
  };

  useEffect(() => {
    const notice = state.hudState.notice;
    if (notice === null || notice.id !== 200) {
      return;
    }
    if (notice.serverSeq <= handledLoseNoticeServerSeq.current) {
      return;
    }
    handledLoseNoticeServerSeq.current = notice.serverSeq;
    setHasStartedPlayableSession(false);
    setOpenMenubarSection(null);
    setGameDialog('scenario');
  }, [state.hudState.notice, setGameDialog, setHasStartedPlayableSession, setOpenMenubarSection]);

  return (
    <RuntimePanelView
      activeNoticeSignature={activeNoticeSignature}
      actions={actions}
      applyBudgetControlState={applyBudgetControlState}
      budgetWindowOriginalStateRef={budgetWindowOriginalStateRef}
      floating={floating}
      layoutInsets={layoutInsets}
      loadInputRef={loadInputRef}
      menubarRef={menubarRef}
      runtimeTheme={runtimeTheme as CSSProperties}
      session={session}
      sessionControlsDisabled={sessionControlsDisabled}
      sidebarRef={sidebarRef}
      speedControlRef={speedControlRef}
      ui={ui}
      visibleNotice={visibleNotice}
    />
  );
}
