import {
  ClassicyButton,
  ClassicyDialogBackdrop,
  ClassicyDialogPanel,
  ClassicyInput,
  ClassicyMenuActionButton,
  ClassicyMenuItemButton,
  ClassicyMenuPanel,
  ClassicyMenuSeparator,
  ClassicyPanelChrome,
  ClassicyPanelTitle,
  ClassicyRange,
  ClassicySelect,
  ClassicyStatRow,
  ClassicyWindowFrame,
  getAllThemes,
  getThemeVars,
} from '@city/classicyui';
import { createFileRoute } from '@tanstack/react-router';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef } from 'react';

import micropolisRunningIndicatorUrl from '../../../../packages/sim-assets/generated-images/images/micropolisg.png';
import micropolisPausedIndicatorUrl from '../../../../packages/sim-assets/generated-images/images/micropoliss.png';
import { resolveSimUiToolIconAssetLookup } from '../../../../packages/sim-assets/src/sim-ui.ts';
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
import {
  DemandHeadsWidget,
  GraphPreviewWidget,
  GraphWindowChart,
  MessageFeed,
  NoticePanel,
} from '../features/playable-runtime/presentation/runtime-panel-components.tsx';
import {
  getPlayableToolSpec,
  PLAYABLE_TOOL_SPECS,
  type PlayableSimSpeed,
  type WebRuntimeState,
} from '../game/runtime/index.ts';
import {
  type CityExportPayload,
  PLAYABLE_DISASTER_CHOICES,
  PLAYABLE_SCENARIO_CHOICES,
} from '../game/runtime/playable-runtime-host.ts';
import { type PlayableGameLevel } from '../game/runtime/protocol.ts';
import { MapCanvas } from '../presentation/map/map-canvas.tsx';
import { type RuntimeTilesetName } from '../presentation/map/tile-sprite-atlas.ts';

export const Route = createFileRoute('/')({
  component: HomePage,
});

const MAP_TILE_SIZE = 16;
const PLAYABLE_TOOL_ICON_MODULES = import.meta.glob(
  '../../../../packages/sim-assets/generated-images/images/ic*.png',
  {
    eager: true,
    import: 'default',
  },
) as Record<string, string>;
const PLAYABLE_TOOL_ICON_URL_BY_BASENAME = new Map<string, string>(
  Object.entries(PLAYABLE_TOOL_ICON_MODULES).map(([modulePath, moduleUrl]) => {
    const basenameMatch = /\/(ic[^/]+\.png)$/.exec(modulePath);
    return [basenameMatch?.[1] ?? modulePath, moduleUrl];
  }),
);
const PLAYABLE_GAME_LEVEL_CHOICES: ReadonlyArray<{
  id: PlayableGameLevel;
  label: 'Easy' | 'Medium' | 'Hard';
  startingFundsLabel: string;
}> = [
  { id: 0, label: 'Easy', startingFundsLabel: '$20,000' },
  { id: 1, label: 'Medium', startingFundsLabel: '$10,000' },
  { id: 2, label: 'Hard', startingFundsLabel: '$5,000' },
];
const HEAD_GRAPH_MASK_RCI = 0b111;
const ALL_GRAPH_SERIES_MASK = 0b11_1111;
const GRAPH_SERIES_TOGGLES = [
  { bit: 1 << 0, color: '#1b8f3a', label: 'Residential' },
  { bit: 1 << 1, color: '#1b2fe0', label: 'Commercial' },
  { bit: 1 << 2, color: '#ff7a1a', label: 'Industrial' },
  { bit: 1 << 3, color: '#222222', label: 'Money' },
  { bit: 1 << 4, color: '#b00020', label: 'Crime' },
  { bit: 1 << 5, color: '#7a4f00', label: 'Pollution' },
] as const;
const CLASSICY_INSET_BEVEL_SHADOW =
  '[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07)]';
const CLASSICY_MESSAGE_SURFACE_CHROME = `text-[var(--color-black)] border-solid [border-width:var(--window-border-size)] [border-color:var(--color-window-border)] [background:color-mix(in_srgb,var(--color-system-03)_90%,transparent)] ${CLASSICY_INSET_BEVEL_SHADOW}`;
const CLASSICY_MENU_BUTTON_ACTIVE_CLASS = '!text-[var(--color-white)] !bg-[var(--color-theme-04)]';
const CLASSICY_FLOATING_BUDGET_ROW_CLASS = 'flex items-center justify-between gap-2';
const CLASSICY_WINDOW_LAUNCHER_BUTTON_CLASS =
  '!m-0 w-full max-w-full !min-w-0 box-border !p-0 !border-0 !bg-transparent !shadow-none';

/**
 * Formats HUD budget amounts with a C-style signed currency prefix.
 * Mirrors the sign behavior in `ReallyDrawBudgetWindow` from `w_budget.c`.
 */
function formatSignedBudgetAmount(value: number): string {
  const absValue = Math.abs(Math.trunc(value));
  const signedPrefix = value < 0 ? '-' : '+';
  return `${signedPrefix}$${absValue.toLocaleString('en-US')}`;
}

/**
 * Formats HUD budget amounts using grouped dollars.
 * Mirrors `makeDollarDecimalStr` display intent in `ref/micropolis/src/sim/w_budget.c`.
 */
function formatBudgetAmount(value: number): string {
  return `$${Math.max(0, Math.trunc(value)).toLocaleString('en-US')}`;
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
  const {
    activeTool,
    applyCityExportPayload,
    cityIoError,
    dismissedNoticeSignature,
    gameDialog,
    graphMask,
    graphRange,
    hasStartedPlayableSession,
    isBrandDialogOpen,
    isLoadingCityFile,
    isSpeedMenuOpen,
    lastSaveStatus,
    openMenubarSection,
    pendingLoadFile,
    runtimeTilesetMenuChoices,
    saveFileName,
    saveFileNameDraft,
    selectedGameLevel,
    selectedRuntimeTileset,
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
  } = useRuntimeUiState();
  const onCityExport = useCallback(
    (payload: CityExportPayload): void => {
      downloadCityBytes(payload.fileName, payload.cityBytes);
      applyCityExportPayload(payload);
    },
    [applyCityExportPayload],
  );
  const {
    controlsDisabled,
    host,
    isGameplayMuted,
    isSimulationRunning,
    reconnect,
    reconnectDisabled,
    requestResyncSnapshot,
    resyncDisabled,
    runtimePhaseStatus,
    sendCityIoCommand,
    sendCityLifecycleCommand,
    sendScenarioCommand,
    sendSimControlCommand,
    sendToolCommand,
    state,
    toggleGameplayMuted,
  } = useRuntimeSession({ onCityExport });
  const {
    closeFloatingWindow,
    floatingWindows,
    focusFloatingWindow,
    openFloatingWindow: openFloatingWindowBase,
    startFloatingWindowDrag,
  } = useFloatingWindowsState();
  const budgetWindowOriginalStateRef = useRef({ ...state.hudState.budget });
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
      budgetWindowOriginalStateRef.current = { ...state.hudState.budget };
      if (!sessionControlsDisabled) {
        sendSimControlCommand({
          kind: 'sim-control',
          control: 'open-budget-from-menu',
        });
      }
    },
    [openFloatingWindowBase, sendSimControlCommand, sessionControlsDisabled, state.hudState.budget],
  );

  /**
   * Applies one full budget control state to authoritative sim runtime.
   * Mirrors `BudgetReset` restore semantics in `ref/micropolis/res/micropolis.tcl`.
   */
  const applyBudgetControlState = useCallback(
    (nextBudgetState: WebRuntimeState['hudState']['budget']): void => {
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
      setOpenMenubarSection(null);
      setGameDialog(null);
      setIsSpeedMenuOpen(false);
      setIsBrandDialogOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    openMenubarSection,
    isSpeedMenuOpen,
    setGameDialog,
    setIsBrandDialogOpen,
    setIsSpeedMenuOpen,
    setOpenMenubarSection,
  ]);

  const activeToolSpec = getPlayableToolSpec(activeTool);
  const activeNotice = state.hudState.notice;
  const activeNoticeSignature =
    activeNotice === null ? null : `${activeNotice.serverSeq}:${activeNotice.id}`;
  const visibleNotice =
    !state.hudState.options.doNotices ||
    activeNotice === null ||
    activeNoticeSignature === dismissedNoticeSignature
      ? null
      : activeNotice;
  const menubarButtonClass =
    '!m-0 min-w-[calc(var(--window-control-size)*7)] px-2 py-1 text-center';
  const menubarPanelClass = 'absolute left-0 top-[calc(100%+3px)] z-[12] grid p-1.5';
  const runtimeTheme = useMemo(() => {
    const theme = getAllThemes()[0];
    if (theme === undefined) {
      return {};
    }
    return getThemeVars(theme);
  }, []);
  const isClassicBwTheme = selectedRuntimeTileset === 'classicbw';
  const yesPercentValueRaw = Number.parseInt(state.hudState.evaluation.yesPercent, 10);
  const yesPercentValue = Number.isFinite(yesPercentValueRaw)
    ? Math.max(0, Math.min(yesPercentValueRaw, 100))
    : 0;
  const noPercentValueRaw = Number.parseInt(state.hudState.evaluation.noPercent, 10);
  const noPercentValue = Number.isFinite(noPercentValueRaw)
    ? Math.max(0, Math.min(noPercentValueRaw, 100))
    : 0;
  const opinionTotalPercent = yesPercentValue + noPercentValue;
  const opinionYesChartWidthPercent =
    opinionTotalPercent > 0 ? (yesPercentValue / opinionTotalPercent) * 100 : 50;
  const opinionNoChartWidthPercent =
    opinionTotalPercent > 0 ? (noPercentValue / opinionTotalPercent) * 100 : 50;

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
  }, [setGameDialog, setHasStartedPlayableSession, setOpenMenubarSection, state.hudState.notice]);
  return (
    <section
      className={`relative h-full w-full overflow-hidden [--runtime-top-bar-padding-y:4px] [--runtime-top-bar-height:calc(var(--window-control-size)+(var(--runtime-top-bar-padding-y)*2))] [--runtime-sidebar-width:94px] text-[var(--color-black)] [font-family:var(--ui-font),sans-serif] [font-size:var(--ui-font-size)] ${
        isClassicBwTheme ? 'grayscale' : ''
      }`}
      style={runtimeTheme as CSSProperties}
    >
      <div
        className="absolute right-0 bottom-0"
        style={{ left: layoutInsets.left, top: layoutInsets.top }}
      >
        <MapCanvas
          dragPlacementEnabled={!sessionControlsDisabled && activeToolSpec.size === 1}
          hoverTool={sessionControlsDisabled ? undefined : activeTool}
          mapState={state.mapState}
          onTileClick={(x, y) => {
            if (sessionControlsDisabled) {
              return;
            }
            sendToolCommand(activeTool, x, y);
          }}
          pendingTools={state.pendingTools}
          realtimeObjects={state.realtimeState.objects}
          tileSize={MAP_TILE_SIZE}
          tilesetName={selectedRuntimeTileset}
        />
      </div>

      <header
        ref={menubarRef}
        className="pointer-events-auto absolute left-0 right-0 top-0 z-10 flex min-h-(--runtime-top-bar-height) items-center justify-between gap-2 bg-[var(--color-system-02)] py-(--runtime-top-bar-padding-y) pl-2 pr-0 [border-bottom:calc(var(--window-border-size)*2)_solid_var(--color-black)] [box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07)]"
      >
        <div className="min-w-max flex items-center gap-2">
          <div className="relative">
            <ClassicyButton
              onClick={() => {
                setOpenMenubarSection((current) =>
                  current === 'micropolis' ? null : 'micropolis',
                );
                setIsSpeedMenuOpen(false);
              }}
              className={`${menubarButtonClass} ${openMenubarSection === 'micropolis' ? CLASSICY_MENU_BUTTON_ACTIVE_CLASS : ''}`}
              active={openMenubarSection === 'micropolis'}
              activeClassName={CLASSICY_MENU_BUTTON_ACTIVE_CLASS}
              type="button"
            >
              Micropolis
            </ClassicyButton>
            {openMenubarSection !== 'micropolis' ? null : (
              <ClassicyMenuPanel className={`${menubarPanelClass} min-w-51 gap-0.5`}>
                <ClassicyMenuItemButton
                  onClick={() => {
                    setIsBrandDialogOpen(true);
                    setOpenMenubarSection(null);
                  }}
                  type="button"
                >
                  About...
                </ClassicyMenuItemButton>
                <ClassicyMenuSeparator />
                <ClassicyMenuItemButton
                  disabled={controlsDisabled}
                  onClick={() => {
                    setGameDialog('new');
                    setOpenMenubarSection(null);
                  }}
                  type="button"
                >
                  New
                </ClassicyMenuItemButton>
                <ClassicyMenuItemButton
                  disabled={sessionControlsDisabled}
                  onClick={() => {
                    setSaveFileNameDraft(saveFileName);
                    setGameDialog('save');
                    setOpenMenubarSection(null);
                  }}
                  type="button"
                >
                  Save...
                </ClassicyMenuItemButton>
                <ClassicyMenuItemButton
                  disabled={controlsDisabled}
                  onClick={() => {
                    setPendingLoadFile(null);
                    setGameDialog('load');
                    setOpenMenubarSection(null);
                  }}
                  type="button"
                >
                  Load...
                </ClassicyMenuItemButton>
                <ClassicyMenuItemButton
                  disabled={controlsDisabled}
                  onClick={() => {
                    setGameDialog('scenario');
                    setOpenMenubarSection(null);
                  }}
                  type="button"
                >
                  Scenario...
                </ClassicyMenuItemButton>
              </ClassicyMenuPanel>
            )}
          </div>
          <div className="relative">
            <ClassicyButton
              onClick={() => {
                setOpenMenubarSection((current) => (current === 'windows' ? null : 'windows'));
                setIsSpeedMenuOpen(false);
              }}
              className={`${menubarButtonClass} ${openMenubarSection === 'windows' ? CLASSICY_MENU_BUTTON_ACTIVE_CLASS : ''}`}
              active={openMenubarSection === 'windows'}
              activeClassName={CLASSICY_MENU_BUTTON_ACTIVE_CLASS}
              type="button"
            >
              Windows
            </ClassicyButton>
            {openMenubarSection !== 'windows' ? null : (
              <ClassicyMenuPanel className={`${menubarPanelClass} min-w-51 gap-0.5`}>
                <ClassicyMenuItemButton
                  onClick={() => {
                    openFloatingWindow('budget');
                    setOpenMenubarSection(null);
                  }}
                  type="button"
                >
                  Budget
                </ClassicyMenuItemButton>
                <ClassicyMenuItemButton
                  onClick={() => {
                    openFloatingWindow('evaluation');
                    setOpenMenubarSection(null);
                  }}
                  type="button"
                >
                  Evaluation
                </ClassicyMenuItemButton>
                <ClassicyMenuItemButton
                  onClick={() => {
                    openFloatingWindow('graph');
                    setOpenMenubarSection(null);
                  }}
                  type="button"
                >
                  Graph
                </ClassicyMenuItemButton>
              </ClassicyMenuPanel>
            )}
          </div>
          <div className="relative">
            <ClassicyButton
              onClick={() => {
                setOpenMenubarSection((current) => (current === 'disasters' ? null : 'disasters'));
                setIsSpeedMenuOpen(false);
              }}
              className={`${menubarButtonClass} ${openMenubarSection === 'disasters' ? CLASSICY_MENU_BUTTON_ACTIVE_CLASS : ''}`}
              active={openMenubarSection === 'disasters'}
              activeClassName={CLASSICY_MENU_BUTTON_ACTIVE_CLASS}
              type="button"
            >
              Disasters
            </ClassicyButton>
            {openMenubarSection !== 'disasters' ? null : (
              <ClassicyMenuPanel className={`${menubarPanelClass} min-w-51 gap-1`}>
                {PLAYABLE_DISASTER_CHOICES.map((choice) => (
                  <ClassicyMenuItemButton
                    key={choice.id}
                    disabled={sessionControlsDisabled}
                    onClick={() => {
                      triggerRouteDisasterControl(host, choice.id, choice.label);
                      setOpenMenubarSection(null);
                    }}
                    type="button"
                  >
                    {choice.label.replace('Trigger ', '')}
                  </ClassicyMenuItemButton>
                ))}
              </ClassicyMenuPanel>
            )}
          </div>
          <div className="relative">
            <ClassicyButton
              onClick={() => {
                setOpenMenubarSection((current) => (current === 'settings' ? null : 'settings'));
                setIsSpeedMenuOpen(false);
              }}
              className={`${menubarButtonClass} ${openMenubarSection === 'settings' ? CLASSICY_MENU_BUTTON_ACTIVE_CLASS : ''}`}
              active={openMenubarSection === 'settings'}
              activeClassName={CLASSICY_MENU_BUTTON_ACTIVE_CLASS}
              type="button"
            >
              Settings
            </ClassicyButton>
            {openMenubarSection !== 'settings' ? null : (
              <ClassicyMenuPanel className={`${menubarPanelClass} min-w-72.5 gap-1.5 p-2`}>
                <label className="grid gap-0.5 text-xs" htmlFor="settings-tileset-select">
                  Tileset
                  <ClassicySelect
                    id="settings-tileset-select"
                    className="px-1.5 py-1"
                    onChange={(event) => {
                      const nextTileset = event.currentTarget.value as RuntimeTilesetName;
                      setSelectedRuntimeTileset(nextTileset);
                    }}
                    value={selectedRuntimeTileset}
                  >
                    {runtimeTilesetMenuChoices.map((choice) => (
                      <option key={choice.name} value={choice.name}>
                        {choice.label}
                      </option>
                    ))}
                  </ClassicySelect>
                </label>
                <div className="text-xs">
                  phase={state.phase} seq={state.lastAppliedServerSeq} tick={state.lastAppliedTick}
                </div>
                <div className="text-xs">{runtimePhaseStatus}</div>

                {state.lastRejectReason === null ? null : (
                  <div className="text-xs text-red-700">{`last reject: ${state.lastRejectReason}`}</div>
                )}
                {cityIoError === '' ? null : (
                  <div className="text-xs text-red-700">{cityIoError}</div>
                )}
                {lastSaveStatus === '' ? null : (
                  <div className="text-xs text-green-700">{lastSaveStatus}</div>
                )}
                <div className="flex flex-wrap gap-2">
                  <ClassicyMenuActionButton
                    disabled={reconnectDisabled}
                    onClick={() => {
                      reconnect();
                      setCityIoError('');
                      setLastSaveStatus('');
                    }}
                    type="button"
                  >
                    Reconnect
                  </ClassicyMenuActionButton>
                  <ClassicyMenuActionButton
                    disabled={resyncDisabled}
                    onClick={() => {
                      requestResyncSnapshot();
                    }}
                    type="button"
                  >
                    Resync Snapshot
                  </ClassicyMenuActionButton>
                </div>
              </ClassicyMenuPanel>
            )}
          </div>
        </div>
        <div
          className={`pointer-events-none absolute left-1/2 top-1/2 z-[11] flex w-[min(280px,30vw)] max-[960px]:w-[min(220px,34vw)] -translate-x-1/2 -translate-y-1/2 flex-col border-solid [border-width:var(--window-border-size)] [border-color:var(--color-window-border)] [background:color-mix(in_srgb,var(--color-system-02)_92%,transparent)] px-2 py-0.5 ${CLASSICY_INSET_BEVEL_SHADOW}`}
        >
          <div className="text-[12px] font-bold leading-4">
            {activeToolSpec.label}: ${activeToolSpec.baseCost}
          </div>
          <div className="text-[10px] leading-3 text-slate-700">
            {sessionControlsDisabled
              ? 'Connect and start a city to build.'
              : activeToolSpec.size === 1
                ? 'Click or drag to place tool.'
                : 'Click map tiles to place tool.'}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ClassicyButton
            disabled={sessionControlsDisabled}
            onClick={() => {
              sendSimControlCommand({
                kind: 'sim-control',
                control: isSimulationRunning ? 'pause' : 'play',
              });
            }}
            className="!m-0 min-w-21 font-bold"
            type="button"
          >
            {isSimulationRunning ? 'Pause' : 'Play'}
          </ClassicyButton>
          <div ref={speedControlRef} className="relative">
            <ClassicyButton
              disabled={sessionControlsDisabled}
              onClick={() => {
                setOpenMenubarSection(null);
                setIsSpeedMenuOpen((current) => !current);
              }}
              className="!m-0 min-w-13.5 px-1.5 font-bold"
              active={isSpeedMenuOpen}
              activeClassName={CLASSICY_MENU_BUTTON_ACTIVE_CLASS}
              type="button"
            >
              {state.hudState.speed > 0 ? `${state.hudState.speed}x` : '1x'} ▾
            </ClassicyButton>
            {isSpeedMenuOpen ? (
              <ClassicyMenuPanel className="absolute right-0 top-[calc(100%+3px)] z-12 grid min-w-14.5 gap-0.5 p-1">
                {([1, 2, 3] as const).map((speed) => (
                  <ClassicyButton
                    key={speed}
                    active={state.hudState.speed === speed}
                    activeClassName={`${CLASSICY_MENU_BUTTON_ACTIVE_CLASS} font-bold`}
                    className="px-2 py-1 text-left"
                    disabled={sessionControlsDisabled}
                    onClick={() => {
                      sendSimControlCommand({
                        kind: 'sim-control',
                        control: 'set-speed',
                        speed: speed as PlayableSimSpeed,
                      });
                      setIsSpeedMenuOpen(false);
                    }}
                    type="button"
                  >
                    {speed}x
                  </ClassicyButton>
                ))}
              </ClassicyMenuPanel>
            ) : null}
          </div>
          <ClassicyButton
            aria-label={isGameplayMuted ? 'Unmute audio' : 'Mute audio'}
            onClick={() => {
              toggleGameplayMuted();
            }}
            active={isGameplayMuted}
            activeClassName={CLASSICY_MENU_BUTTON_ACTIVE_CLASS}
            buttonShape="square"
            className="!m-0 inline-flex h-(--window-control-size) w-(--window-control-size) items-center justify-center p-0"
            title={isGameplayMuted ? 'Unmute' : 'Mute'}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="16"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.7"
              viewBox="0 0 24 24"
              width="16"
            >
              <path d="M3 9h4l5-4v14l-5-4H3z" />
              {isGameplayMuted ? (
                <path d="M15 9l6 6M21 9l-6 6" />
              ) : (
                <>
                  <path d="M15 9.5a4 4 0 0 1 0 5" />
                  <path d="M17.5 7a7.5 7.5 0 0 1 0 10" />
                </>
              )}
            </svg>
          </ClassicyButton>
        </div>
        <img
          alt={isSimulationRunning ? 'Simulation running indicator' : 'Simulation paused indicator'}
          aria-label="Open Micropolis popup"
          draggable={false}
          onClick={() => {
            setOpenMenubarSection(null);
            setIsSpeedMenuOpen(false);
            setIsBrandDialogOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setOpenMenubarSection(null);
              setIsSpeedMenuOpen(false);
              setIsBrandDialogOpen(true);
            }
          }}
          role="button"
          src={isSimulationRunning ? micropolisRunningIndicatorUrl : micropolisPausedIndicatorUrl}
          tabIndex={0}
          title="Micropolis"
          className="block self-stretch !mt-[calc((var(--runtime-top-bar-padding-y)*-1)+var(--window-border-size))] !mb-[calc(var(--runtime-top-bar-padding-y)*-1)] h-auto w-auto shrink-0 max-h-none cursor-pointer select-none [image-rendering:pixelated]"
        />
      </header>
      {visibleNotice === null ? null : (
        <NoticePanel
          notice={visibleNotice}
          onDismiss={() => {
            setDismissedNoticeSignature(activeNoticeSignature);
          }}
          topInsetPx={layoutInsets.top}
        />
      )}

      <ClassicyPanelChrome
        ref={sidebarRef}
        className="pointer-events-auto absolute bottom-0 left-0 z-6 grid w-(--runtime-sidebar-width) content-start gap-1.5 overflow-x-hidden overflow-y-auto px-2 py-3"
        style={{ top: layoutInsets.top }}
      >
        <div className="mx-auto grid grid-cols-2 justify-center gap-x-1.5 gap-y-1">
          {PLAYABLE_TOOL_SPECS.map((spec) => {
            const active = activeTool === spec.tool;
            const iconLookup = resolveSimUiToolIconAssetLookup(spec.toolState, {
              highlighted: active,
            });
            const iconBasename = iconLookup?.derivedPngPath?.split('/').pop();
            const iconUrl =
              iconBasename === undefined
                ? undefined
                : PLAYABLE_TOOL_ICON_URL_BY_BASENAME.get(iconBasename);

            return (
              <ClassicyButton
                key={spec.tool}
                disabled={sessionControlsDisabled}
                buttonShape="square"
                buttonSize="small"
                onClick={() => {
                  setActiveTool(spec.tool);
                }}
                title={`${spec.label} ($${spec.baseCost})`}
                type="button"
                className={`!m-0 flex h-9 min-h-9 max-h-9 w-9 min-w-9 max-w-9 items-center justify-center border-2 p-0 ${
                  active
                    ? '!border-[var(--color-theme-07)] !bg-[var(--color-theme-03)]'
                    : '!border-[var(--color-black)] !bg-[var(--color-system-02)]'
                } ${sessionControlsDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                {iconUrl === undefined ? (
                  <span className="[font-family:var(--ui-font),sans-serif] [font-size:calc(var(--ui-font-size)*0.75)] text-[var(--color-black)] font-bold">
                    {spec.label.slice(0, 2).toUpperCase()}
                  </span>
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center">
                    <img
                      alt={`${spec.label} tool`}
                      draggable={false}
                      src={iconUrl}
                      className="block h-full w-full object-contain [image-rendering:pixelated]"
                    />
                  </span>
                )}
              </ClassicyButton>
            );
          })}
        </div>
        <div className="grid gap-1">
          <ClassicyButton
            onClick={() => {
              openFloatingWindow('evaluation');
            }}
            className={CLASSICY_WINDOW_LAUNCHER_BUTTON_CLASS}
            title="Open Evaluation Window"
            type="button"
          >
            <DemandHeadsWidget
              demandC={state.hudState.demandC}
              demandI={state.hudState.demandI}
              demandR={state.hudState.demandR}
            />
          </ClassicyButton>
          <ClassicyButton
            onClick={() => {
              openFloatingWindow('graph');
            }}
            className={CLASSICY_WINDOW_LAUNCHER_BUTTON_CLASS}
            title="Open Graph Window"
            type="button"
          >
            <GraphPreviewWidget
              graph={state.hudState.graph}
              mask={HEAD_GRAPH_MASK_RCI}
              range={10}
            />
          </ClassicyButton>
        </div>
        <div className="grid min-w-0 content-start auto-rows-max gap-y-1 text-[11px]">
          <button
            onClick={() => {
              openFloatingWindow('budget');
            }}
            className={`${CLASSICY_WINDOW_LAUNCHER_BUTTON_CLASS} grid gap-y-1 text-inherit [font:inherit] text-left`}
            title="Open Budget Window"
            type="button"
          >
            <ClassicyStatRow
              label="Funds"
              value={state.hudState.fundsLabel.replace(/^Funds:\s*/u, '')}
            />
            <ClassicyStatRow label="Tax" value={`${state.hudState.budget.taxRate}%`} />
          </button>
          <ClassicyStatRow
            label="Date"
            value={state.hudState.dateDisplayLabel.replace(/^Date:\s*/u, '')}
          />
          <ClassicyStatRow
            label="Population"
            value={state.hudState.cityPopulation.toLocaleString('en-US')}
          />
          <ClassicyStatRow
            label="Class"
            value={
              state.hudState.cityClassLabel.slice(0, 1).toUpperCase() +
              state.hudState.cityClassLabel.slice(1).toLowerCase()
            }
          />
        </div>
      </ClassicyPanelChrome>

      <ClassicyPanelChrome className="pointer-events-auto absolute left-1/2 bottom-[calc(var(--window-padding-size)*2)] z-6 grid w-[min(560px,calc(100vw-24px))] -translate-x-1/2 gap-0.5 px-2 py-1">
        <div className="[font-family:var(--ui-font),sans-serif] [font-size:var(--ui-font-size)] leading-none p-0 text-center">
          Message Feed
        </div>
        <MessageFeed messages={state.hudState.messages} />
      </ClassicyPanelChrome>
      <input
        accept=".cty,application/octet-stream"
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0] ?? null;
          input.value = '';
          setPendingLoadFile(file);
          if (file !== null) {
            setCityIoError('');
          }
        }}
        ref={loadInputRef}
        className="hidden"
        type="file"
      />

      {floatingWindows.budget.open ? (
        <ClassicyWindowFrame
          bodyClassName="grid gap-2 p-2 text-xs"
          data-floating-window="budget"
          onClose={() => {
            closeFloatingWindow('budget');
          }}
          onHeaderPointerDown={(event) => {
            startFloatingWindowDrag('budget', event);
          }}
          onPointerDown={() => {
            focusFloatingWindow('budget');
          }}
          className="min-w-88 max-w-[min(520px,calc(100vw-12px))]"
          style={{
            left: floatingWindows.budget.x,
            top: floatingWindows.budget.y,
            zIndex: floatingWindows.budget.zIndex,
          }}
          windowTitle="Budget"
        >
          <div className="grid gap-1.5 md:grid-cols-2">
            <div className="grid gap-1">
              <div className={CLASSICY_FLOATING_BUDGET_ROW_CLASS}>
                <span>Taxes Collected</span>
                <strong>{formatBudgetAmount(state.hudState.budget.taxFund)}</strong>
              </div>
              <div className={CLASSICY_FLOATING_BUDGET_ROW_CLASS}>
                <span>Cash Flow</span>
                <strong>{formatSignedBudgetAmount(state.hudState.budget.cashFlow)}</strong>
              </div>
              <div className={CLASSICY_FLOATING_BUDGET_ROW_CLASS}>
                <span>Previous Funds</span>
                <strong>{formatBudgetAmount(state.hudState.budget.totalFunds)}</strong>
              </div>
              <div className={CLASSICY_FLOATING_BUDGET_ROW_CLASS}>
                <span>Current Funds</span>
                <strong>
                  {formatBudgetAmount(
                    state.hudState.budget.totalFunds + state.hudState.budget.cashFlow,
                  )}
                </strong>
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="grid gap-0.5">
                <span>Road Fund ({state.hudState.budget.roadPercent}%)</span>
                <span className="text-[11px] text-slate-700">
                  {formatBudgetAmount(state.hudState.budget.roadGot)} /{' '}
                  {formatBudgetAmount(state.hudState.budget.roadWant)}
                </span>
                <ClassicyRange
                  disabled={sessionControlsDisabled}
                  max={100}
                  min={0}
                  onChange={(event) => {
                    sendSimControlCommand({
                      kind: 'sim-control',
                      control: 'set-road-percent',
                      percent: Math.trunc(Number(event.currentTarget.value)),
                    });
                  }}
                  value={state.hudState.budget.roadPercent}
                />
              </label>
              <label className="grid gap-0.5">
                <span>Fire Fund ({state.hudState.budget.firePercent}%)</span>
                <span className="text-[11px] text-slate-700">
                  {formatBudgetAmount(state.hudState.budget.fireGot)} /{' '}
                  {formatBudgetAmount(state.hudState.budget.fireWant)}
                </span>
                <ClassicyRange
                  disabled={sessionControlsDisabled}
                  max={100}
                  min={0}
                  onChange={(event) => {
                    sendSimControlCommand({
                      kind: 'sim-control',
                      control: 'set-fire-percent',
                      percent: Math.trunc(Number(event.currentTarget.value)),
                    });
                  }}
                  value={state.hudState.budget.firePercent}
                />
              </label>
              <label className="grid gap-0.5">
                <span>Police Fund ({state.hudState.budget.policePercent}%)</span>
                <span className="text-[11px] text-slate-700">
                  {formatBudgetAmount(state.hudState.budget.policeGot)} /{' '}
                  {formatBudgetAmount(state.hudState.budget.policeWant)}
                </span>
                <ClassicyRange
                  disabled={sessionControlsDisabled}
                  max={100}
                  min={0}
                  onChange={(event) => {
                    sendSimControlCommand({
                      kind: 'sim-control',
                      control: 'set-police-percent',
                      percent: Math.trunc(Number(event.currentTarget.value)),
                    });
                  }}
                  value={state.hudState.budget.policePercent}
                />
              </label>
              <label className="grid gap-0.5">
                <span>Tax Rate ({state.hudState.budget.taxRate}%)</span>
                <ClassicyRange
                  disabled={sessionControlsDisabled}
                  max={20}
                  min={0}
                  onChange={(event) => {
                    sendSimControlCommand({
                      kind: 'sim-control',
                      control: 'set-tax-rate',
                      taxRate: Math.trunc(Number(event.currentTarget.value)),
                    });
                  }}
                  value={state.hudState.budget.taxRate}
                />
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ClassicyButton
              disabled={sessionControlsDisabled}
              onClick={() => {
                sendSimControlCommand({
                  kind: 'sim-control',
                  control: 'set-auto-budget',
                  enabled: !state.hudState.budget.autoBudget,
                });
              }}
              type="button"
            >
              {state.hudState.budget.autoBudget ? 'Disable Auto Budget' : 'Enable Auto Budget'}
            </ClassicyButton>
            <div className="flex flex-wrap justify-end gap-2">
              <ClassicyButton
                onClick={() => {
                  closeFloatingWindow('budget');
                }}
                type="button"
              >
                Continue
              </ClassicyButton>
              <ClassicyButton
                disabled={sessionControlsDisabled}
                onClick={() => {
                  applyBudgetControlState(budgetWindowOriginalStateRef.current);
                }}
                type="button"
              >
                Reset
              </ClassicyButton>
              <ClassicyButton
                disabled={sessionControlsDisabled}
                onClick={() => {
                  applyBudgetControlState(budgetWindowOriginalStateRef.current);
                  closeFloatingWindow('budget');
                }}
                type="button"
              >
                Cancel
              </ClassicyButton>
            </div>
          </div>
        </ClassicyWindowFrame>
      ) : null}

      {floatingWindows.evaluation.open ? (
        <ClassicyWindowFrame
          bodyClassName="grid gap-1.5 p-2 text-xs"
          data-floating-window="evaluation"
          onClose={() => {
            closeFloatingWindow('evaluation');
          }}
          onHeaderPointerDown={(event) => {
            startFloatingWindowDrag('evaluation', event);
          }}
          onPointerDown={() => {
            focusFloatingWindow('evaluation');
          }}
          className="min-w-70 max-w-[min(460px,calc(100vw-12px))]"
          style={{
            left: floatingWindows.evaluation.x,
            top: floatingWindows.evaluation.y,
            zIndex: floatingWindows.evaluation.zIndex,
          }}
          windowTitle="Evaluation"
        >
          <ClassicyPanelTitle className="text-center text-xs">
            {state.hudState.evaluation.title}
          </ClassicyPanelTitle>
          <div className="grid gap-2 md:grid-cols-2">
            <section className={`${CLASSICY_MESSAGE_SURFACE_CHROME} grid gap-1 p-1.5`}>
              <strong className="text-[11px]">Public Opinion</strong>
              <div className="text-[11px]">Is the mayor doing a good job?</div>
              <div
                className={`${CLASSICY_MESSAGE_SURFACE_CHROME} relative h-5 overflow-hidden`}
                role="img"
                aria-label={`Public opinion: yes ${state.hudState.evaluation.yesPercent}, no ${state.hudState.evaluation.noPercent}`}
              >
                <div className="flex h-full w-full">
                  <div
                    className="h-full shrink-0 [background:color-mix(in_srgb,#6fbf7c_72%,var(--color-system-03))]"
                    style={{ width: `${opinionYesChartWidthPercent}%` }}
                  />
                  <div
                    className="h-full shrink-0 [border-left:var(--window-border-size)_solid_color-mix(in_srgb,var(--color-black)_45%,transparent)] [background:color-mix(in_srgb,#d78686_74%,var(--color-system-03))]"
                    style={{ width: `${opinionNoChartWidthPercent}%` }}
                  />
                </div>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-1">
                  <strong className="text-[11px] leading-none [color:color-mix(in_srgb,var(--color-black)_92%,#101010)]">
                    Yes {state.hudState.evaluation.yesPercent}
                  </strong>
                  <strong className="text-[11px] leading-none [color:color-mix(in_srgb,var(--color-black)_92%,#101010)]">
                    No {state.hudState.evaluation.noPercent}
                  </strong>
                </div>
              </div>
              <strong className="mt-1 text-[11px]">Worst Problems</strong>
              {state.hudState.evaluation.problems.map((problem, index) => (
                <div
                  key={`evaluation-problem-${index}`}
                  className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}
                >
                  <span>{problem.name}</span>
                  <strong>{problem.percent}</strong>
                </div>
              ))}
            </section>
            <section className={`${CLASSICY_MESSAGE_SURFACE_CHROME} grid gap-1 p-1.5`}>
              <strong className="text-[11px]">Statistics</strong>
              <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
                <span>Population</span>
                <strong>{state.hudState.evaluation.population}</strong>
              </div>
              <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
                <span>Net Migration (last year)</span>
                <strong>{state.hudState.evaluation.populationDelta}</strong>
              </div>
              <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
                <span>Assessed Value</span>
                <strong>{state.hudState.evaluation.assessedValue}</strong>
              </div>
              <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
                <span>Category</span>
                <strong>{state.hudState.evaluation.cityClass}</strong>
              </div>
              <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
                <span>Game Level</span>
                <strong>{state.hudState.evaluation.cityLevel}</strong>
              </div>
              <strong className="mt-1 text-[11px]">Overall City Score (0 - 1000)</strong>
              <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
                <span>Current Score</span>
                <strong>{state.hudState.evaluation.score}</strong>
              </div>
              <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
                <span>Annual Change</span>
                <strong>{state.hudState.evaluation.scoreDelta}</strong>
              </div>
            </section>
          </div>
          <div className="flex justify-center">
            <ClassicyButton
              onClick={() => {
                closeFloatingWindow('evaluation');
              }}
              type="button"
            >
              Dismiss Evaluation
            </ClassicyButton>
          </div>
        </ClassicyWindowFrame>
      ) : null}

      {floatingWindows.graph.open ? (
        <ClassicyWindowFrame
          bodyClassName="grid gap-1.5 p-2 text-xs"
          data-floating-window="graph"
          onClose={() => {
            closeFloatingWindow('graph');
          }}
          onHeaderPointerDown={(event) => {
            startFloatingWindowDrag('graph', event);
          }}
          onPointerDown={() => {
            focusFloatingWindow('graph');
          }}
          className="min-w-70 max-w-[min(460px,calc(100vw-12px))]"
          style={{
            left: floatingWindows.graph.x,
            top: floatingWindows.graph.y,
            zIndex: floatingWindows.graph.zIndex,
          }}
          windowTitle="Graph"
        >
          <div className="grid grid-cols-2 gap-1">
            <ClassicyButton
              onClick={() => {
                setGraphRange(10);
              }}
              className="text-[11px]"
              style={{
                background: graphRange === 10 ? 'var(--color-theme-03)' : undefined,
              }}
              type="button"
            >
              10 Years
            </ClassicyButton>
            <ClassicyButton
              onClick={() => {
                setGraphRange(120);
              }}
              className="text-[11px]"
              style={{
                background: graphRange === 120 ? 'var(--color-theme-03)' : undefined,
              }}
              type="button"
            >
              120 Years
            </ClassicyButton>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {GRAPH_SERIES_TOGGLES.map((series) => (
              <ClassicyButton
                key={series.bit}
                onClick={() => {
                  setGraphMask((currentMask) => currentMask ^ series.bit);
                }}
                className="flex items-center justify-between gap-1 text-[11px]"
                style={{
                  background: (graphMask & series.bit) !== 0 ? 'var(--color-theme-03)' : undefined,
                }}
                type="button"
              >
                <span>{series.label}</span>
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 border border-black"
                  style={{ background: series.color }}
                />
              </ClassicyButton>
            ))}
          </div>
          <GraphWindowChart graph={state.hudState.graph} mask={graphMask} range={graphRange} />
          <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
            <span>Visible series</span>
            <strong>
              {GRAPH_SERIES_TOGGLES.filter((series) => (graphMask & series.bit) !== 0).length}/
              {GRAPH_SERIES_TOGGLES.length}
            </strong>
          </div>
          <div className="flex justify-between gap-1">
            <ClassicyButton
              onClick={() => {
                setGraphMask(HEAD_GRAPH_MASK_RCI);
                setGraphRange(10);
              }}
              className="text-[11px]"
              type="button"
            >
              Reset to R/C/I
            </ClassicyButton>
            <ClassicyButton
              onClick={() => {
                setGraphMask(ALL_GRAPH_SERIES_MASK);
              }}
              className="text-[11px]"
              type="button"
            >
              Show All
            </ClassicyButton>
          </div>
        </ClassicyWindowFrame>
      ) : null}

      {isBrandDialogOpen ? (
        <ClassicyDialogBackdrop
          onClick={() => {
            setIsBrandDialogOpen(false);
          }}
        >
          <ClassicyDialogPanel
            modalWindow
            onClick={(event) => {
              event.stopPropagation();
            }}
            className="grid min-w-70 w-[min(420px,calc(100vw-24px))] !p-2 gap-2.5"
            style={{ position: 'relative' }}
          >
            <ClassicyPanelTitle className="text-sm">Micropolis</ClassicyPanelTitle>
            <div className="grid gap-1 text-sm">
              <p>
                Developed by Christopher Ehrlich using gpt 5.3-codex:{' '}
                <a
                  className="underline"
                  href="https://github.com/c-ehrlich/micropolis"
                  rel="noreferrer"
                  target="_blank"
                >
                  github.com/c-ehrlich/micropolis
                </a>
              </p>
              <p>
                Based on the TCL/X11 version of Micropolis (open-source SimCity):{' '}
                <a
                  className="underline"
                  href="https://github.com/SimHacker/micropolis"
                  rel="noreferrer"
                  target="_blank"
                >
                  github.com/SimHacker/micropolis
                </a>
              </p>
              <p>
                Twitter:{' '}
                <a
                  className="underline"
                  href="https://x.com/ccccjjjjeeee"
                  rel="noreferrer"
                  target="_blank"
                >
                  x.com/ccccjjjjeeee
                </a>
              </p>
            </div>
            <div className="flex justify-end">
              <ClassicyButton
                onClick={() => {
                  setIsBrandDialogOpen(false);
                }}
                type="button"
              >
                Dismiss
              </ClassicyButton>
            </div>
          </ClassicyDialogPanel>
        </ClassicyDialogBackdrop>
      ) : null}

      {gameDialog === null ? null : (
        <ClassicyDialogBackdrop
          onClick={() => {
            if (!isLoadingCityFile) {
              setGameDialog(null);
            }
          }}
        >
          <ClassicyDialogPanel
            onClick={(event) => {
              event.stopPropagation();
            }}
            className="grid min-w-[320px] w-[min(420px,calc(100vw-24px))] gap-2.5 p-3"
          >
            {gameDialog !== 'save' ? null : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
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
                }}
                className="grid gap-2.5"
              >
                <ClassicyPanelTitle className="text-sm">Save City</ClassicyPanelTitle>
                <label className="grid gap-1 text-xs">
                  File name
                  <ClassicyInput
                    autoFocus
                    className="px-2 py-1"
                    disabled={sessionControlsDisabled}
                    onChange={(event) => {
                      setSaveFileNameDraft(event.target.value);
                    }}
                    type="text"
                    value={saveFileNameDraft}
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <ClassicyButton
                    onClick={() => {
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </ClassicyButton>
                  <ClassicyButton disabled={sessionControlsDisabled} type="submit">
                    Save
                  </ClassicyButton>
                </div>
              </form>
            )}

            {gameDialog !== 'new' ? null : (
              <section className="grid gap-2.5">
                <ClassicyPanelTitle className="text-sm">New Game</ClassicyPanelTitle>
                <label className="grid gap-1 text-xs">
                  Difficulty
                  <ClassicySelect
                    autoFocus
                    className="px-2 py-1"
                    disabled={controlsDisabled}
                    onChange={(event) => {
                      const level = Number.parseInt(event.target.value, 10);
                      if (level === 0 || level === 1 || level === 2) {
                        setSelectedGameLevel(level);
                      }
                    }}
                    value={selectedGameLevel}
                  >
                    {PLAYABLE_GAME_LEVEL_CHOICES.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label} (Starting Funds: {choice.startingFundsLabel})
                      </option>
                    ))}
                  </ClassicySelect>
                </label>
                <div className="flex justify-end gap-2">
                  <ClassicyButton
                    onClick={() => {
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </ClassicyButton>
                  <ClassicyButton
                    disabled={controlsDisabled}
                    onClick={() => {
                      setHasStartedPlayableSession(true);
                      setSaveFileName('newcity.cty');
                      sendCityLifecycleCommand({
                        kind: 'city-lifecycle',
                        action: 'new-city',
                        gameLevel: selectedGameLevel,
                      });
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Start New City
                  </ClassicyButton>
                </div>
              </section>
            )}

            {gameDialog !== 'load' ? null : (
              <section className="grid gap-2.5">
                <ClassicyPanelTitle className="text-sm">Load City</ClassicyPanelTitle>
                <div className="text-xs text-slate-700">
                  {pendingLoadFile === null
                    ? 'No file selected.'
                    : `Selected: ${pendingLoadFile.name}`}
                </div>
                <div className="flex flex-wrap gap-2">
                  <ClassicyButton
                    disabled={controlsDisabled || isLoadingCityFile}
                    onClick={() => {
                      loadInputRef.current?.click();
                    }}
                    type="button"
                  >
                    Choose .cty File...
                  </ClassicyButton>
                  <ClassicyButton
                    disabled={controlsDisabled || pendingLoadFile === null || isLoadingCityFile}
                    onClick={async () => {
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
                    }}
                    type="button"
                  >
                    {isLoadingCityFile ? 'Loading...' : 'Load'}
                  </ClassicyButton>
                </div>
                <div className="flex justify-end">
                  <ClassicyButton
                    disabled={isLoadingCityFile}
                    onClick={() => {
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Close
                  </ClassicyButton>
                </div>
              </section>
            )}

            {gameDialog !== 'scenario' ? null : (
              <section className="grid gap-2.5">
                <ClassicyPanelTitle className="text-sm">Scenario</ClassicyPanelTitle>
                <label className="grid gap-1 text-xs">
                  Scenario
                  <ClassicySelect
                    autoFocus
                    className="px-2 py-1"
                    disabled={controlsDisabled}
                    onChange={(event) => {
                      setSelectedScenarioId(Number.parseInt(event.target.value, 10));
                    }}
                    value={selectedScenarioId}
                  >
                    {PLAYABLE_SCENARIO_CHOICES.map((scenario) => (
                      <option key={scenario.id} value={scenario.id}>
                        {scenario.id}. {scenario.name} ({scenario.startYear})
                      </option>
                    ))}
                  </ClassicySelect>
                </label>
                <label className="grid gap-1 text-xs">
                  Difficulty
                  <ClassicySelect
                    className="px-2 py-1"
                    disabled={controlsDisabled}
                    onChange={(event) => {
                      const level = Number.parseInt(event.target.value, 10);
                      if (level === 0 || level === 1 || level === 2) {
                        setSelectedGameLevel(level);
                      }
                    }}
                    value={selectedGameLevel}
                  >
                    {PLAYABLE_GAME_LEVEL_CHOICES.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label} (Starting Funds: {choice.startingFundsLabel})
                      </option>
                    ))}
                  </ClassicySelect>
                </label>
                <div className="flex justify-end gap-2">
                  <ClassicyButton
                    onClick={() => {
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </ClassicyButton>
                  <ClassicyButton
                    disabled={controlsDisabled}
                    onClick={() => {
                      setHasStartedPlayableSession(true);
                      const scenario = PLAYABLE_SCENARIO_CHOICES.find(
                        (entry) => entry.id === selectedScenarioId,
                      );
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
                    }}
                    type="button"
                  >
                    Start Scenario
                  </ClassicyButton>
                </div>
              </section>
            )}
          </ClassicyDialogPanel>
        </ClassicyDialogBackdrop>
      )}
    </section>
  );
}
