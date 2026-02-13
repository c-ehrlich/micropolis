import './index.classicy.css';

import { ClassicyButton } from '@city/classicyui';
import { createFileRoute } from '@tanstack/react-router';
import { getAllThemes, getThemeVars } from 'classicy';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import micropolisRunningIndicatorUrl from '../../../../packages/sim-assets/generated-images/images/micropolisg.png';
import micropolisPausedIndicatorUrl from '../../../../packages/sim-assets/generated-images/images/micropoliss.png';
import { resolveSimUiToolIconAssetLookup } from '../../../../packages/sim-assets/src/sim-ui.ts';
import {
  downloadCityBytes,
  formatRuntimePhaseStatus,
  nextCommandId,
  normalizeCitySaveFileName,
  triggerRouteDisasterControl,
} from '../features/playable-runtime/behavior/runtime-panel-behavior.ts';
import {
  DemandHeadsWidget,
  GraphPreviewWidget,
  GraphWindowChart,
  MessageFeed,
  NoticePanel,
} from '../features/playable-runtime/presentation/runtime-panel-components.tsx';
import { createMicropolisGameplayAudioConsumer } from '../game/audio/micropolis-gameplay-audio-consumer.ts';
import { createMicropolisGameplaySoundPlaybackPolicy } from '../game/audio/micropolis-gameplay-sound-playback-policy.ts';
import { routeMicropolisGameplaySoundDeltas } from '../game/audio/micropolis-runtime-envelope-sound-routing.ts';
import { createCoalescedStateDispatcher } from '../game/runtime/frame-coalescer.ts';
import {
  coalesceQueuedRuntimeMapState,
  createWebHostRuntime,
  getPlayableToolSpec,
  PLAYABLE_TOOL_SPECS,
  type PlayableSimSpeed,
  type PlayableToolName,
  type WebRuntimeState,
} from '../game/runtime/index.ts';
import {
  createPlayableRuntimeHost,
  PLAYABLE_DISASTER_CHOICES,
  PLAYABLE_SCENARIO_CHOICES,
  readCityExportPayload,
} from '../game/runtime/playable-runtime-host.ts';
import { type PlayableGameLevel } from '../game/runtime/protocol.ts';
import { MapCanvas } from '../presentation/map/map-canvas.tsx';
import {
  RUNTIME_TILESET_CHOICES,
  type RuntimeTilesetName,
} from '../presentation/map/tile-sprite-atlas.ts';

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
type TopMenubarSection = 'micropolis' | 'windows' | 'disasters' | 'settings';
type GameDialogKind = 'new' | 'save' | 'load' | 'scenario';
type RuntimeFloatingWindowId = 'budget' | 'evaluation' | 'graph';

interface RuntimeFloatingWindowState {
  open: boolean;
  x: number;
  y: number;
  zIndex: number;
}

interface RuntimeFloatingWindowsState {
  budget: RuntimeFloatingWindowState;
  evaluation: RuntimeFloatingWindowState;
  graph: RuntimeFloatingWindowState;
}

interface FloatingWindowDragState {
  windowId: RuntimeFloatingWindowId;
  offsetX: number;
  offsetY: number;
}
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

/**
 * Creates initial floating-window positions for budget/evaluation/graph windows.
 * Mirrors independent top-level window placement in `ref/micropolis/res/whead.tcl`.
 */
function createInitialRuntimeFloatingWindows(): RuntimeFloatingWindowsState {
  return {
    budget: { open: false, x: 140, y: 76, zIndex: 20 },
    evaluation: { open: false, x: 190, y: 116, zIndex: 21 },
    graph: { open: false, x: 240, y: 156, zIndex: 22 },
  };
}

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
  const host = useMemo(() => createPlayableRuntimeHost(), []);
  const runtime = useMemo(() => createWebHostRuntime({ host }), [host]);
  const gameplayAudioConsumer = useMemo(() => createMicropolisGameplayAudioConsumer(), []);
  const gameplaySoundPlaybackPolicy = useMemo(
    () => createMicropolisGameplaySoundPlaybackPolicy({ mode: 'applied-only' }),
    [],
  );
  const [state, setState] = useState<WebRuntimeState>(() => runtime.getState());
  const [isGameplayMuted, setIsGameplayMuted] = useState(false);
  const isGameplayMutedRef = useRef(isGameplayMuted);
  /**
   * Coalesces host-driven runtime projections to one browser paint commit.
   * Mirrors Micropolis cadence where map/head updates are consumed on UI update
   * boundaries (`sim_update_maps` / `DoUpdateHeads`) rather than every internal
   * simulation mutation (`ref/micropolis/src/sim/sim.c`, `w_update.c`).
   */
  const stateCommitDispatcher = useMemo(
    () =>
      createCoalescedStateDispatcher<WebRuntimeState>({
        scheduleFrame: (flush) => requestAnimationFrame(flush),
        cancelFrame: (frameHandle) => cancelAnimationFrame(frameHandle),
        commitState: (nextState) => {
          setState(nextState);
        },
        coalesceQueuedState: (queuedState, nextState) => {
          return {
            ...nextState,
            mapState: coalesceQueuedRuntimeMapState(queuedState.mapState, nextState.mapState),
          };
        },
      }),
    [],
  );
  const [activeTool, setActiveTool] = useState<PlayableToolName>('road');
  const [selectedScenarioId, setSelectedScenarioId] = useState<number>(
    PLAYABLE_SCENARIO_CHOICES[0]?.id ?? 1,
  );
  const [selectedGameLevel, setSelectedGameLevel] = useState<PlayableGameLevel>(0);
  const [hasStartedPlayableSession, setHasStartedPlayableSession] = useState(false);
  const [saveFileName, setSaveFileName] = useState('newcity.cty');
  const [lastSaveStatus, setLastSaveStatus] = useState<string>('');
  const [cityIoError, setCityIoError] = useState<string>('');
  const [_disasterStatus, setDisasterStatus] = useState<string>('');
  const [openMenubarSection, setOpenMenubarSection] = useState<TopMenubarSection | null>(null);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const [floatingWindows, setFloatingWindows] = useState<RuntimeFloatingWindowsState>(() =>
    createInitialRuntimeFloatingWindows(),
  );
  const [graphRange, setGraphRange] = useState<10 | 120>(10);
  const [graphMask, setGraphMask] = useState(HEAD_GRAPH_MASK_RCI);
  const [floatingWindowZCounter, setFloatingWindowZCounter] = useState(30);
  const floatingWindowDragRef = useRef<FloatingWindowDragState | null>(null);
  const budgetWindowOriginalStateRef = useRef({ ...state.hudState.budget });
  const [gameDialog, setGameDialog] = useState<GameDialogKind | null>(null);
  const [isBrandDialogOpen, setIsBrandDialogOpen] = useState(false);
  const [dismissedNoticeSignature, setDismissedNoticeSignature] = useState<string | null>(null);
  const [saveFileNameDraft, setSaveFileNameDraft] = useState('newcity.cty');
  const [pendingLoadFile, setPendingLoadFile] = useState<File | null>(null);
  const [isLoadingCityFile, setIsLoadingCityFile] = useState(false);
  const [layoutInsets, setLayoutInsets] = useState({ left: 96, top: 34 });
  const [selectedRuntimeTileset, setSelectedRuntimeTileset] =
    useState<RuntimeTilesetName>('classic');
  // Temporarily hide `ancientasia` because upstream tileset files are incorrect.
  // Tracking: https://github.com/SimHacker/MicropolisCore/issues/9
  const runtimeTilesetMenuChoices = useMemo(
    () => RUNTIME_TILESET_CHOICES.filter((choice) => choice.name !== 'ancientasia'),
    [],
  );
  const menubarRef = useRef<HTMLElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const speedControlRef = useRef<HTMLDivElement | null>(null);
  const loadInputRef = useRef<HTMLInputElement | null>(null);
  const handledLoseNoticeServerSeq = useRef(0);
  const commandCounter = useRef(1);

  /**
   * Raises one floating window to the top of the local z-order stack.
   * Mirrors front-window focus behavior for `budget/evaluation/graph` windows in
   * `ref/micropolis/res/whead.tcl`.
   */
  const focusFloatingWindow = (windowId: RuntimeFloatingWindowId): void => {
    const nextZIndex = floatingWindowZCounter + 1;
    setFloatingWindowZCounter(nextZIndex);
    setFloatingWindows((current) => ({
      ...current,
      [windowId]: {
        ...current[windowId],
        zIndex: nextZIndex,
      },
    }));
  };

  /**
   * Opens one floating runtime window and optionally runs menu-open side effects.
   * Mirrors menu-triggered window creation in `ref/micropolis/res/whead.tcl`.
   */
  const openFloatingWindow = (windowId: RuntimeFloatingWindowId): void => {
    focusFloatingWindow(windowId);
    setFloatingWindows((current) => ({
      ...current,
      [windowId]: {
        ...current[windowId],
        open: true,
      },
    }));
    if (windowId === 'budget') {
      budgetWindowOriginalStateRef.current = { ...state.hudState.budget };
      if (!sessionControlsDisabled) {
        runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
          kind: 'sim-control',
          control: 'open-budget-from-menu',
        });
      }
    }
  };

  /**
   * Closes one floating runtime window.
   * Mirrors user-dismissed auxiliary windows in `ref/micropolis/res/whead.tcl`.
   */
  const closeFloatingWindow = (windowId: RuntimeFloatingWindowId): void => {
    setFloatingWindows((current) => ({
      ...current,
      [windowId]: {
        ...current[windowId],
        open: false,
      },
    }));
  };

  /**
   * Starts drag movement for one floating runtime window.
   * Mirrors window title-bar drag behavior in classic Micropolis Tk windows.
   */
  const startFloatingWindowDrag = (
    windowId: RuntimeFloatingWindowId,
    event: ReactPointerEvent<HTMLElement>,
  ): void => {
    const windowElement = event.currentTarget.closest<HTMLElement>('[data-floating-window]');
    if (windowElement === null) {
      return;
    }
    const bounds = windowElement.getBoundingClientRect();
    floatingWindowDragRef.current = {
      windowId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    focusFloatingWindow(windowId);
  };

  /**
   * Applies one full budget control state to authoritative sim runtime.
   * Mirrors `BudgetReset` restore semantics in `ref/micropolis/res/micropolis.tcl`.
   */
  const applyBudgetControlState = (nextBudgetState: typeof state.hudState.budget): void => {
    if (sessionControlsDisabled) {
      return;
    }
    runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
      kind: 'sim-control',
      control: 'set-tax-rate',
      taxRate: nextBudgetState.taxRate,
    });
    runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
      kind: 'sim-control',
      control: 'set-road-percent',
      percent: nextBudgetState.roadPercent,
    });
    runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
      kind: 'sim-control',
      control: 'set-fire-percent',
      percent: nextBudgetState.firePercent,
    });
    runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
      kind: 'sim-control',
      control: 'set-police-percent',
      percent: nextBudgetState.policePercent,
    });
    runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
      kind: 'sim-control',
      control: 'set-auto-budget',
      enabled: nextBudgetState.autoBudget,
    });
  };

  useEffect(() => {
    isGameplayMutedRef.current = isGameplayMuted;
  }, [isGameplayMuted]);

  useEffect(() => {
    const unsubscribe = runtime.subscribe((event) => {
      stateCommitDispatcher.queue(event.state);

      const runtimeEnvelope = event.envelope;
      if (runtimeEnvelope === undefined) {
        return;
      }

      routeMicropolisGameplaySoundDeltas({
        envelope: runtimeEnvelope,
        reducerOutcome: event.outcome,
        userSoundOn: event.state.hudState.options.userSoundOn && !isGameplayMutedRef.current,
        gameplayAudioConsumer,
        gameplaySoundPlaybackPolicy,
      });

      if (runtimeEnvelope.kind !== 'patch') {
        return;
      }

      const savePayload = readCityExportPayload(runtimeEnvelope.payload);
      if (savePayload !== null) {
        downloadCityBytes(savePayload.fileName, savePayload.cityBytes);
        setSaveFileName(savePayload.fileName);
        setLastSaveStatus(`Saved ${savePayload.cityName} -> ${savePayload.fileName}`);
        setCityIoError('');
      }
    });

    runtime.connect();
    return () => {
      unsubscribe();
      stateCommitDispatcher.dispose();
      runtime.disconnect();
      gameplayAudioConsumer.dispose();
    };
  }, [runtime, stateCommitDispatcher, gameplayAudioConsumer, gameplaySoundPlaybackPolicy]);

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
  }, [openMenubarSection, isSpeedMenuOpen]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = floatingWindowDragRef.current;
      if (dragState === null) {
        return;
      }

      const unclampedX = Math.trunc(event.clientX - dragState.offsetX);
      const unclampedY = Math.trunc(event.clientY - dragState.offsetY);
      const maxX = Math.max(0, window.innerWidth - 220);
      const maxY = Math.max(0, window.innerHeight - 120);
      const clampedX = Math.max(0, Math.min(unclampedX, maxX));
      const clampedY = Math.max(0, Math.min(unclampedY, maxY));
      setFloatingWindows((current) => ({
        ...current,
        [dragState.windowId]: {
          ...current[dragState.windowId],
          x: clampedX,
          y: clampedY,
        },
      }));
    };

    const stopDrag = () => {
      floatingWindowDragRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
    };
  }, []);

  const controlsDisabled = state.phase !== 'ready';
  const sessionControlsDisabled = controlsDisabled || !hasStartedPlayableSession;
  const reconnectDisabled =
    state.phase === 'connecting' || state.phase === 'negotiating' || state.phase === 'reconnecting';
  const resyncDisabled =
    state.phase === 'disconnected' ||
    state.phase === 'connecting' ||
    state.phase === 'negotiating' ||
    state.phase === 'reconnecting' ||
    state.phase === 'failed';
  const activeToolSpec = getPlayableToolSpec(activeTool);
  const isSimulationRunning = state.hudState.speed > 0;
  const runtimePhaseStatus = formatRuntimePhaseStatus(state.phase);
  const activeNotice = state.hudState.notice;
  const activeNoticeSignature =
    activeNotice === null ? null : `${activeNotice.serverSeq}:${activeNotice.id}`;
  const visibleNotice =
    !state.hudState.options.doNotices ||
    activeNotice === null ||
    activeNoticeSignature === dismissedNoticeSignature
      ? null
      : activeNotice;
  const menubarButtonClass = 'classicyRuntimeMenuButton px-2 py-1 text-center';
  const menubarPanelClass =
    'classicyRuntimeMenuPanel absolute left-0 top-[calc(100%+3px)] z-[12] grid p-1.5';
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
  }, [state.hudState.notice]);

  useLayoutEffect(() => {
    const menubarElement = menubarRef.current;
    const sidebarElement = sidebarRef.current;
    if (
      menubarElement === null ||
      sidebarElement === null ||
      typeof ResizeObserver === 'undefined'
    ) {
      return;
    }

    const updateInsets = () => {
      const nextTopInset = Math.ceil(menubarElement.getBoundingClientRect().height);
      const nextLeftInset = Math.ceil(sidebarElement.getBoundingClientRect().width);
      setLayoutInsets((currentInsets) => {
        if (currentInsets.top === nextTopInset && currentInsets.left === nextLeftInset) {
          return currentInsets;
        }
        return { top: nextTopInset, left: nextLeftInset };
      });
    };

    updateInsets();

    const observer = new ResizeObserver(() => {
      updateInsets();
    });
    observer.observe(menubarElement);
    observer.observe(sidebarElement);
    window.addEventListener('resize', updateInsets);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateInsets);
    };
  }, []);

  return (
    <section
      className={`classicyRuntimePanel relative h-full w-full overflow-hidden ${
        isClassicBwTheme ? 'classicyRuntimePanelClassicBw' : ''
      }`}
      style={runtimeTheme as CSSProperties}
    >
      <div
        className="classicyRuntimeMapArea absolute"
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

            const commandId = nextCommandId(commandCounter, 'tool');
            runtime.sendCommand(commandId, {
              kind: 'tool',
              tool: activeTool,
              x,
              y,
            });
          }}
          pendingTools={state.pendingTools}
          realtimeObjects={state.realtimeState.objects}
          tileSize={MAP_TILE_SIZE}
          tilesetName={selectedRuntimeTileset}
        />
      </div>

      <header
        ref={menubarRef}
        className="classicyRuntimeMenuBar classicyRuntimeTopBar pointer-events-auto absolute left-0 right-0 top-0 z-10 flex items-center justify-between gap-2 pl-2 pr-0"
      >
        <div className="classicyRuntimeTopLeft flex items-center gap-2">
          <div className="relative">
            <ClassicyButton
              onClick={() => {
                setOpenMenubarSection((current) =>
                  current === 'micropolis' ? null : 'micropolis',
                );
                setIsSpeedMenuOpen(false);
              }}
              className={`${menubarButtonClass} ${openMenubarSection === 'micropolis' ? 'classicyRuntimeMenuButtonActive' : ''}`}
              active={openMenubarSection === 'micropolis'}
              activeClassName="classicyRuntimeMenuButtonActive"
              type="button"
            >
              Micropolis
            </ClassicyButton>
            {openMenubarSection !== 'micropolis' ? null : (
              <section className={`${menubarPanelClass} min-w-51 gap-0.5`}>
                <ClassicyButton
                  onClick={() => {
                    setIsBrandDialogOpen(true);
                    setOpenMenubarSection(null);
                  }}
                  className="classicyRuntimeMenuItem text-left"
                  type="button"
                >
                  About...
                </ClassicyButton>
                <div className="mx-1 h-px bg-black/35" />
                <ClassicyButton
                  disabled={controlsDisabled}
                  onClick={() => {
                    setGameDialog('new');
                    setOpenMenubarSection(null);
                  }}
                  className="classicyRuntimeMenuItem text-left"
                  type="button"
                >
                  New
                </ClassicyButton>
                <ClassicyButton
                  disabled={sessionControlsDisabled}
                  onClick={() => {
                    setSaveFileNameDraft(saveFileName);
                    setGameDialog('save');
                    setOpenMenubarSection(null);
                  }}
                  className="classicyRuntimeMenuItem text-left"
                  type="button"
                >
                  Save...
                </ClassicyButton>
                <ClassicyButton
                  disabled={controlsDisabled}
                  onClick={() => {
                    setPendingLoadFile(null);
                    setGameDialog('load');
                    setOpenMenubarSection(null);
                  }}
                  className="classicyRuntimeMenuItem text-left"
                  type="button"
                >
                  Load...
                </ClassicyButton>
                <ClassicyButton
                  disabled={controlsDisabled}
                  onClick={() => {
                    setGameDialog('scenario');
                    setOpenMenubarSection(null);
                  }}
                  className="classicyRuntimeMenuItem text-left"
                  type="button"
                >
                  Scenario...
                </ClassicyButton>
              </section>
            )}
          </div>
          <div className="relative">
            <ClassicyButton
              onClick={() => {
                setOpenMenubarSection((current) => (current === 'windows' ? null : 'windows'));
                setIsSpeedMenuOpen(false);
              }}
              className={`${menubarButtonClass} ${openMenubarSection === 'windows' ? 'classicyRuntimeMenuButtonActive' : ''}`}
              active={openMenubarSection === 'windows'}
              activeClassName="classicyRuntimeMenuButtonActive"
              type="button"
            >
              Windows
            </ClassicyButton>
            {openMenubarSection !== 'windows' ? null : (
              <section className={`${menubarPanelClass} min-w-51 gap-0.5`}>
                <ClassicyButton
                  onClick={() => {
                    openFloatingWindow('budget');
                    setOpenMenubarSection(null);
                  }}
                  className="classicyRuntimeMenuItem text-left"
                  type="button"
                >
                  Budget
                </ClassicyButton>
                <ClassicyButton
                  onClick={() => {
                    openFloatingWindow('evaluation');
                    setOpenMenubarSection(null);
                  }}
                  className="classicyRuntimeMenuItem text-left"
                  type="button"
                >
                  Evaluation
                </ClassicyButton>
                <ClassicyButton
                  onClick={() => {
                    openFloatingWindow('graph');
                    setOpenMenubarSection(null);
                  }}
                  className="classicyRuntimeMenuItem text-left"
                  type="button"
                >
                  Graph
                </ClassicyButton>
              </section>
            )}
          </div>
          <div className="relative">
            <ClassicyButton
              onClick={() => {
                setOpenMenubarSection((current) => (current === 'disasters' ? null : 'disasters'));
                setIsSpeedMenuOpen(false);
              }}
              className={`${menubarButtonClass} ${openMenubarSection === 'disasters' ? 'classicyRuntimeMenuButtonActive' : ''}`}
              active={openMenubarSection === 'disasters'}
              activeClassName="classicyRuntimeMenuButtonActive"
              type="button"
            >
              Disasters
            </ClassicyButton>
            {openMenubarSection !== 'disasters' ? null : (
              <section className={`${menubarPanelClass} min-w-51 gap-1`}>
                {PLAYABLE_DISASTER_CHOICES.map((choice) => (
                  <ClassicyButton
                    key={choice.id}
                    disabled={sessionControlsDisabled}
                    onClick={() => {
                      setDisasterStatus(triggerRouteDisasterControl(host, choice.id, choice.label));
                      setOpenMenubarSection(null);
                    }}
                    className="classicyRuntimeMenuItem text-left"
                    type="button"
                  >
                    {choice.label.replace('Trigger ', '')}
                  </ClassicyButton>
                ))}
              </section>
            )}
          </div>
          <div className="relative">
            <ClassicyButton
              onClick={() => {
                setOpenMenubarSection((current) => (current === 'settings' ? null : 'settings'));
                setIsSpeedMenuOpen(false);
              }}
              className={`${menubarButtonClass} ${openMenubarSection === 'settings' ? 'classicyRuntimeMenuButtonActive' : ''}`}
              active={openMenubarSection === 'settings'}
              activeClassName="classicyRuntimeMenuButtonActive"
              type="button"
            >
              Settings
            </ClassicyButton>
            {openMenubarSection !== 'settings' ? null : (
              <section className={`${menubarPanelClass} min-w-72.5 gap-1.5 p-2`}>
                <label className="grid gap-0.5 text-xs" htmlFor="settings-tileset-select">
                  Tileset
                  <select
                    id="settings-tileset-select"
                    className="classicyRuntimeSelect px-1.5 py-1"
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
                  </select>
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
                  <ClassicyButton
                    disabled={reconnectDisabled}
                    onClick={() => {
                      runtime.reconnect();
                      setCityIoError('');
                      setLastSaveStatus('');
                    }}
                    className="classicyRuntimeRuntimeAction"
                    type="button"
                  >
                    Reconnect
                  </ClassicyButton>
                  <ClassicyButton
                    disabled={resyncDisabled}
                    onClick={() => {
                      runtime.requestSnapshot('resync');
                    }}
                    className="classicyRuntimeRuntimeAction"
                    type="button"
                  >
                    Resync Snapshot
                  </ClassicyButton>
                </div>
              </section>
            )}
          </div>
        </div>
        <div className="classicyRuntimeTopStatus pointer-events-none absolute left-1/2 top-1/2 z- 11 flex -translate-x-1/2 -translate-y-1/2 flex-col px-2 py-0.5">
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
        <div className="classicyRuntimeTopControls ml-auto flex items-center gap-2">
          <ClassicyButton
            disabled={sessionControlsDisabled}
            onClick={() => {
              runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
                kind: 'sim-control',
                control: isSimulationRunning ? 'pause' : 'play',
              });
            }}
            className="classicyRuntimeTopControlButton min-w-21 font-bold"
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
              className="classicyRuntimeTopControlButton min-w-13.5 px-1.5 font-bold"
              active={isSpeedMenuOpen}
              activeClassName="classicyRuntimeMenuButtonActive"
              type="button"
            >
              {state.hudState.speed > 0 ? `${state.hudState.speed}x` : '1x'} ▾
            </ClassicyButton>
            {isSpeedMenuOpen ? (
              <section className="classicyRuntimeMenuPanel absolute right-0 top-[calc(100%+3px)] z-12 grid min-w-14.5 gap-0.5 p-1">
                {([1, 2, 3] as const).map((speed) => (
                  <ClassicyButton
                    key={speed}
                    active={state.hudState.speed === speed}
                    activeClassName="classicyRuntimeMenuButtonActive font-bold"
                    className="px-2 py-1 text-left"
                    disabled={sessionControlsDisabled}
                    onClick={() => {
                      runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
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
              </section>
            ) : null}
          </div>
          <ClassicyButton
            aria-label={isGameplayMuted ? 'Unmute audio' : 'Mute audio'}
            onClick={() => {
              setIsGameplayMuted((current) => {
                const nextMuted = !current;
                if (nextMuted) {
                  gameplayAudioConsumer.dispose();
                }
                return nextMuted;
              });
            }}
            active={isGameplayMuted}
            activeClassName="classicyRuntimeMenuButtonActive"
            buttonShape="square"
            className="classicyRuntimeTopControlButton inline-flex h-(--window-control-size) w-(--window-control-size) items-center justify-center p-0"
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
          className="classicyRuntimeBrandIcon [image-rendering:pixelated]"
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

      <section
        ref={sidebarRef}
        className="classicyRuntimeSidebar classicyRuntimePanelChrome pointer-events-auto absolute bottom-0 left-0 z-6 grid gap-1.5 overflow-y-auto px-2 py-3"
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
              <button
                key={spec.tool}
                disabled={sessionControlsDisabled}
                onClick={() => {
                  setActiveTool(spec.tool);
                }}
                title={`${spec.label} ($${spec.baseCost})`}
                type="button"
                className={`classicyButton classicyButtonShapeSquare classicyButtonSmall classicyRuntimeToolButton flex items-center justify-center border-2 p-0 ${
                  active ? 'classicyRuntimeToolButtonActive' : 'classicyRuntimeToolButtonInactive'
                } ${sessionControlsDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                {iconUrl === undefined ? (
                  <span className="classicyRuntimeToolButtonLabel font-bold">
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
              </button>
            );
          })}
        </div>
        <div className="grid gap-1">
          <button
            onClick={() => {
              openFloatingWindow('evaluation');
            }}
            className="classicyButton classicyRuntimeWindowLauncher p-0"
            title="Open Evaluation Window"
            type="button"
          >
            <DemandHeadsWidget
              demandC={state.hudState.demandC}
              demandI={state.hudState.demandI}
              demandR={state.hudState.demandR}
            />
          </button>
          <button
            onClick={() => {
              openFloatingWindow('graph');
            }}
            className="classicyButton classicyRuntimeWindowLauncher p-0"
            title="Open Graph Window"
            type="button"
          >
            <GraphPreviewWidget
              graph={state.hudState.graph}
              mask={HEAD_GRAPH_MASK_RCI}
              range={10}
            />
          </button>
        </div>
        <div className="classicyRuntimeSidebarStats grid text-[11px]">
          <button
            onClick={() => {
              openFloatingWindow('budget');
            }}
            className="classicyRuntimeSidebarBudgetGroup"
            title="Open Budget Window"
            type="button"
          >
            <div className="classicyRuntimeSidebarStat">
              <div className="classicyRuntimeSidebarStatLabel">Funds</div>
              <div className="classicyRuntimeSidebarStatValue">
                {state.hudState.fundsLabel.replace(/^Funds:\s*/u, '')}
              </div>
            </div>
            <div className="classicyRuntimeSidebarStat">
              <div className="classicyRuntimeSidebarStatLabel">Tax</div>
              <div className="classicyRuntimeSidebarStatValue">
                {state.hudState.budget.taxRate}%
              </div>
            </div>
          </button>
          <div className="classicyRuntimeSidebarStat">
            <div className="classicyRuntimeSidebarStatLabel">Date</div>
            <div className="classicyRuntimeSidebarStatValue">
              {state.hudState.dateDisplayLabel.replace(/^Date:\s*/u, '')}
            </div>
          </div>
          <div className="classicyRuntimeSidebarStat">
            <div className="classicyRuntimeSidebarStatLabel">Population</div>
            <div className="classicyRuntimeSidebarStatValue">
              {state.hudState.cityPopulation.toLocaleString('en-US')}
            </div>
          </div>
          <div className="classicyRuntimeSidebarStat">
            <div className="classicyRuntimeSidebarStatLabel">Class</div>
            <div className="classicyRuntimeSidebarStatValue">
              {state.hudState.cityClassLabel.slice(0, 1).toUpperCase() +
                state.hudState.cityClassLabel.slice(1).toLowerCase()}
            </div>
          </div>
        </div>
      </section>

      <section className="classicyRuntimeBottomFeed classicyRuntimePanelChrome pointer-events-auto absolute left-1/2 z-6 grid w-[min(560px,calc(100vw-24px))] -translate-x-1/2 gap-0.5 px-2 py-1">
        <div className="classicyRuntimeSidebarStatLabel classicyRuntimeMessageFeedLabel">
          Message Feed
        </div>
        <MessageFeed messages={state.hudState.messages} />
      </section>
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
        <section
          data-floating-window="budget"
          onPointerDown={() => {
            focusFloatingWindow('budget');
          }}
          className="classicyWindow classicyWindowActive classicyRuntimeFloatingWindow pointer-events-auto absolute grid min-w-88 max-w-[min(520px,calc(100vw-12px))]"
          style={{
            left: floatingWindows.budget.x,
            top: floatingWindows.budget.y,
            zIndex: floatingWindows.budget.zIndex,
          }}
        >
          <header
            onPointerDown={(event) => {
              startFloatingWindowDrag('budget', event);
            }}
            className="classicyRuntimeFloatingWindowTitleBar classicyRuntimeFloatingWindowMenuTitleBar flex cursor-move items-center justify-between gap-2"
          >
            <strong className="classicyRuntimeFloatingWindowMenuTitle">Budget</strong>
            <button
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={() => {
                closeFloatingWindow('budget');
              }}
              className="classicyButton classicyRuntimeFloatingWindowClose"
              type="button"
            >
              x
            </button>
          </header>
          <div className="classicyRuntimeFloatingWindowBody grid gap-2 p-2 text-xs">
            <div className="grid gap-1.5 md:grid-cols-2">
              <div className="grid gap-1">
                <div className="classicyRuntimeFloatingBudgetRow">
                  <span>Taxes Collected</span>
                  <strong>{formatBudgetAmount(state.hudState.budget.taxFund)}</strong>
                </div>
                <div className="classicyRuntimeFloatingBudgetRow">
                  <span>Cash Flow</span>
                  <strong>{formatSignedBudgetAmount(state.hudState.budget.cashFlow)}</strong>
                </div>
                <div className="classicyRuntimeFloatingBudgetRow">
                  <span>Previous Funds</span>
                  <strong>{formatBudgetAmount(state.hudState.budget.totalFunds)}</strong>
                </div>
                <div className="classicyRuntimeFloatingBudgetRow">
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
                  <input
                    className="classicyRuntimeRange"
                    disabled={sessionControlsDisabled}
                    max={100}
                    min={0}
                    onChange={(event) => {
                      runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
                        kind: 'sim-control',
                        control: 'set-road-percent',
                        percent: Math.trunc(Number(event.currentTarget.value)),
                      });
                    }}
                    type="range"
                    value={state.hudState.budget.roadPercent}
                  />
                </label>
                <label className="grid gap-0.5">
                  <span>Fire Fund ({state.hudState.budget.firePercent}%)</span>
                  <span className="text-[11px] text-slate-700">
                    {formatBudgetAmount(state.hudState.budget.fireGot)} /{' '}
                    {formatBudgetAmount(state.hudState.budget.fireWant)}
                  </span>
                  <input
                    className="classicyRuntimeRange"
                    disabled={sessionControlsDisabled}
                    max={100}
                    min={0}
                    onChange={(event) => {
                      runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
                        kind: 'sim-control',
                        control: 'set-fire-percent',
                        percent: Math.trunc(Number(event.currentTarget.value)),
                      });
                    }}
                    type="range"
                    value={state.hudState.budget.firePercent}
                  />
                </label>
                <label className="grid gap-0.5">
                  <span>Police Fund ({state.hudState.budget.policePercent}%)</span>
                  <span className="text-[11px] text-slate-700">
                    {formatBudgetAmount(state.hudState.budget.policeGot)} /{' '}
                    {formatBudgetAmount(state.hudState.budget.policeWant)}
                  </span>
                  <input
                    className="classicyRuntimeRange"
                    disabled={sessionControlsDisabled}
                    max={100}
                    min={0}
                    onChange={(event) => {
                      runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
                        kind: 'sim-control',
                        control: 'set-police-percent',
                        percent: Math.trunc(Number(event.currentTarget.value)),
                      });
                    }}
                    type="range"
                    value={state.hudState.budget.policePercent}
                  />
                </label>
                <label className="grid gap-0.5">
                  <span>Tax Rate ({state.hudState.budget.taxRate}%)</span>
                  <input
                    className="classicyRuntimeRange"
                    disabled={sessionControlsDisabled}
                    max={20}
                    min={0}
                    onChange={(event) => {
                      runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
                        kind: 'sim-control',
                        control: 'set-tax-rate',
                        taxRate: Math.trunc(Number(event.currentTarget.value)),
                      });
                    }}
                    type="range"
                    value={state.hudState.budget.taxRate}
                  />
                </label>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                disabled={sessionControlsDisabled}
                onClick={() => {
                  runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
                    kind: 'sim-control',
                    control: 'set-auto-budget',
                    enabled: !state.hudState.budget.autoBudget,
                  });
                }}
                className="classicyButton"
                type="button"
              >
                {state.hudState.budget.autoBudget ? 'Disable Auto Budget' : 'Enable Auto Budget'}
              </button>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  className="classicyButton"
                  onClick={() => {
                    closeFloatingWindow('budget');
                  }}
                  type="button"
                >
                  Continue
                </button>
                <button
                  disabled={sessionControlsDisabled}
                  className="classicyButton"
                  onClick={() => {
                    applyBudgetControlState(budgetWindowOriginalStateRef.current);
                  }}
                  type="button"
                >
                  Reset
                </button>
                <button
                  disabled={sessionControlsDisabled}
                  className="classicyButton"
                  onClick={() => {
                    applyBudgetControlState(budgetWindowOriginalStateRef.current);
                    closeFloatingWindow('budget');
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {floatingWindows.evaluation.open ? (
        <section
          data-floating-window="evaluation"
          onPointerDown={() => {
            focusFloatingWindow('evaluation');
          }}
          className="classicyWindow classicyWindowActive classicyRuntimeFloatingWindow pointer-events-auto absolute grid min-w-70 max-w-[min(460px,calc(100vw-12px))]"
          style={{
            left: floatingWindows.evaluation.x,
            top: floatingWindows.evaluation.y,
            zIndex: floatingWindows.evaluation.zIndex,
          }}
        >
          <header
            onPointerDown={(event) => {
              startFloatingWindowDrag('evaluation', event);
            }}
            className="classicyRuntimeFloatingWindowTitleBar classicyRuntimeFloatingWindowMenuTitleBar flex cursor-move items-center justify-between gap-2"
          >
            <strong className="classicyRuntimeFloatingWindowMenuTitle">Evaluation</strong>
            <button
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={() => {
                closeFloatingWindow('evaluation');
              }}
              className="classicyButton classicyRuntimeFloatingWindowClose"
              type="button"
            >
              x
            </button>
          </header>
          <div className="classicyRuntimeFloatingWindowBody grid gap-1.5 p-2 text-xs">
            <div className="classicyRuntimePanelTitle text-center text-xs">
              {state.hudState.evaluation.title}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <section className="classicyRuntimeMessageFeed grid gap-1 p-1.5">
                <strong className="text-[11px]">Public Opinion</strong>
                <div className="text-[11px]">Is the mayor doing a good job?</div>
                <div
                  className="classicyRuntimeEvaluationOpinionChart"
                  role="img"
                  aria-label={`Public opinion: yes ${state.hudState.evaluation.yesPercent}, no ${state.hudState.evaluation.noPercent}`}
                >
                  <div className="classicyRuntimeEvaluationOpinionTrack">
                    <div
                      className="classicyRuntimeEvaluationOpinionSegment classicyRuntimeEvaluationOpinionSegmentYes"
                      style={{ width: `${opinionYesChartWidthPercent}%` }}
                    />
                    <div
                      className="classicyRuntimeEvaluationOpinionSegment classicyRuntimeEvaluationOpinionSegmentNo"
                      style={{ width: `${opinionNoChartWidthPercent}%` }}
                    />
                  </div>
                  <div className="classicyRuntimeEvaluationOpinionLabels">
                    <strong className="classicyRuntimeEvaluationOpinionLabel">
                      Yes {state.hudState.evaluation.yesPercent}
                    </strong>
                    <strong className="classicyRuntimeEvaluationOpinionLabel">
                      No {state.hudState.evaluation.noPercent}
                    </strong>
                  </div>
                </div>
                <strong className="mt-1 text-[11px]">Worst Problems</strong>
                {state.hudState.evaluation.problems.map((problem, index) => (
                  <div
                    key={`evaluation-problem-${index}`}
                    className="classicyRuntimeFloatingBudgetRow text-[11px]"
                  >
                    <span>{problem.name}</span>
                    <strong>{problem.percent}</strong>
                  </div>
                ))}
              </section>
              <section className="classicyRuntimeMessageFeed grid gap-1 p-1.5">
                <strong className="text-[11px]">Statistics</strong>
                <div className="classicyRuntimeFloatingBudgetRow text-[11px]">
                  <span>Population</span>
                  <strong>{state.hudState.evaluation.population}</strong>
                </div>
                <div className="classicyRuntimeFloatingBudgetRow text-[11px]">
                  <span>Net Migration (last year)</span>
                  <strong>{state.hudState.evaluation.populationDelta}</strong>
                </div>
                <div className="classicyRuntimeFloatingBudgetRow text-[11px]">
                  <span>Assessed Value</span>
                  <strong>{state.hudState.evaluation.assessedValue}</strong>
                </div>
                <div className="classicyRuntimeFloatingBudgetRow text-[11px]">
                  <span>Category</span>
                  <strong>{state.hudState.evaluation.cityClass}</strong>
                </div>
                <div className="classicyRuntimeFloatingBudgetRow text-[11px]">
                  <span>Game Level</span>
                  <strong>{state.hudState.evaluation.cityLevel}</strong>
                </div>
                <strong className="mt-1 text-[11px]">Overall City Score (0 - 1000)</strong>
                <div className="classicyRuntimeFloatingBudgetRow text-[11px]">
                  <span>Current Score</span>
                  <strong>{state.hudState.evaluation.score}</strong>
                </div>
                <div className="classicyRuntimeFloatingBudgetRow text-[11px]">
                  <span>Annual Change</span>
                  <strong>{state.hudState.evaluation.scoreDelta}</strong>
                </div>
              </section>
            </div>
            <div className="flex justify-center">
              <button
                onClick={() => {
                  closeFloatingWindow('evaluation');
                }}
                className="classicyButton"
                type="button"
              >
                Dismiss Evaluation
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {floatingWindows.graph.open ? (
        <section
          data-floating-window="graph"
          onPointerDown={() => {
            focusFloatingWindow('graph');
          }}
          className="classicyWindow classicyWindowActive classicyRuntimeFloatingWindow pointer-events-auto absolute grid min-w-70 max-w-[min(460px,calc(100vw-12px))]"
          style={{
            left: floatingWindows.graph.x,
            top: floatingWindows.graph.y,
            zIndex: floatingWindows.graph.zIndex,
          }}
        >
          <header
            onPointerDown={(event) => {
              startFloatingWindowDrag('graph', event);
            }}
            className="classicyRuntimeFloatingWindowTitleBar classicyRuntimeFloatingWindowMenuTitleBar flex cursor-move items-center justify-between gap-2"
          >
            <strong className="classicyRuntimeFloatingWindowMenuTitle">Graph</strong>
            <button
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={() => {
                closeFloatingWindow('graph');
              }}
              className="classicyButton classicyRuntimeFloatingWindowClose"
              type="button"
            >
              x
            </button>
          </header>
          <div className="classicyRuntimeFloatingWindowBody grid gap-1.5 p-2 text-xs">
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => {
                  setGraphRange(10);
                }}
                className="classicyButton text-[11px]"
                style={{
                  background: graphRange === 10 ? 'var(--color-theme-03)' : undefined,
                }}
                type="button"
              >
                10 Years
              </button>
              <button
                onClick={() => {
                  setGraphRange(120);
                }}
                className="classicyButton text-[11px]"
                style={{
                  background: graphRange === 120 ? 'var(--color-theme-03)' : undefined,
                }}
                type="button"
              >
                120 Years
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {GRAPH_SERIES_TOGGLES.map((series) => (
                <button
                  key={series.bit}
                  onClick={() => {
                    setGraphMask((currentMask) => currentMask ^ series.bit);
                  }}
                  className="classicyButton flex items-center justify-between gap-1 text-[11px]"
                  style={{
                    background:
                      (graphMask & series.bit) !== 0 ? 'var(--color-theme-03)' : undefined,
                  }}
                  type="button"
                >
                  <span>{series.label}</span>
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 border border-black"
                    style={{ background: series.color }}
                  />
                </button>
              ))}
            </div>
            <GraphWindowChart graph={state.hudState.graph} mask={graphMask} range={graphRange} />
            <div className="classicyRuntimeFloatingBudgetRow text-[11px]">
              <span>Visible series</span>
              <strong>
                {GRAPH_SERIES_TOGGLES.filter((series) => (graphMask & series.bit) !== 0).length}/
                {GRAPH_SERIES_TOGGLES.length}
              </strong>
            </div>
            <div className="flex justify-between gap-1">
              <button
                onClick={() => {
                  setGraphMask(HEAD_GRAPH_MASK_RCI);
                  setGraphRange(10);
                }}
                className="classicyButton text-[11px]"
                type="button"
              >
                Reset to R/C/I
              </button>
              <button
                onClick={() => {
                  setGraphMask(ALL_GRAPH_SERIES_MASK);
                }}
                className="classicyButton text-[11px]"
                type="button"
              >
                Show All
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {isBrandDialogOpen ? (
        <div
          onClick={() => {
            setIsBrandDialogOpen(false);
          }}
          className="classicyRuntimeDialogBackdrop pointer-events-auto absolute inset-0 z-15 flex items-center justify-center"
        >
          <section
            onClick={(event) => {
              event.stopPropagation();
            }}
            className="classicyWindow classicyWindowActive classicyWindowModal classicyRuntimeDialog classicyRuntimeBrandDialog grid min-w-70 w-[min(420px,calc(100vw-24px))] gap-2.5"
            style={{ position: 'relative' }}
          >
            <strong className="classicyRuntimePanelTitle text-sm">Micropolis</strong>
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
              <button
                className="classicyButton"
                onClick={() => {
                  setIsBrandDialogOpen(false);
                }}
                type="button"
              >
                Dismiss
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {gameDialog === null ? null : (
        <div
          onClick={() => {
            if (!isLoadingCityFile) {
              setGameDialog(null);
            }
          }}
          className="classicyRuntimeDialogBackdrop pointer-events-auto absolute inset-0 z-15 flex items-center justify-center"
        >
          <section
            onClick={(event) => {
              event.stopPropagation();
            }}
            className="classicyRuntimeDialog grid min-w-[320px] w-[min(420px,calc(100vw-24px))] gap-2.5 p-3"
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
                  runtime.sendCommand(nextCommandId(commandCounter, 'city'), {
                    kind: 'city-io',
                    action: 'save-city',
                    fileName,
                  });
                  setGameDialog(null);
                }}
                className="grid gap-2.5"
              >
                <strong className="classicyRuntimePanelTitle text-sm">Save City</strong>
                <label className="grid gap-1 text-xs">
                  File name
                  <input
                    autoFocus
                    className="classicyRuntimeInput px-2 py-1"
                    disabled={sessionControlsDisabled}
                    onChange={(event) => {
                      setSaveFileNameDraft(event.target.value);
                    }}
                    type="text"
                    value={saveFileNameDraft}
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    className="classicyButton"
                    onClick={() => {
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="classicyButton"
                    disabled={sessionControlsDisabled}
                    type="submit"
                  >
                    Save
                  </button>
                </div>
              </form>
            )}

            {gameDialog !== 'new' ? null : (
              <section className="grid gap-2.5">
                <strong className="classicyRuntimePanelTitle text-sm">New Game</strong>
                <label className="grid gap-1 text-xs">
                  Difficulty
                  <select
                    autoFocus
                    className="classicyRuntimeSelect px-2 py-1"
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
                  </select>
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    className="classicyButton"
                    onClick={() => {
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="classicyButton"
                    disabled={controlsDisabled}
                    onClick={() => {
                      setHasStartedPlayableSession(true);
                      setSaveFileName('newcity.cty');
                      runtime.sendCommand(nextCommandId(commandCounter, 'city'), {
                        kind: 'city-lifecycle',
                        action: 'new-city',
                        gameLevel: selectedGameLevel,
                      });
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Start New City
                  </button>
                </div>
              </section>
            )}

            {gameDialog !== 'load' ? null : (
              <section className="grid gap-2.5">
                <strong className="classicyRuntimePanelTitle text-sm">Load City</strong>
                <div className="text-xs text-slate-700">
                  {pendingLoadFile === null
                    ? 'No file selected.'
                    : `Selected: ${pendingLoadFile.name}`}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="classicyButton"
                    disabled={controlsDisabled || isLoadingCityFile}
                    onClick={() => {
                      loadInputRef.current?.click();
                    }}
                    type="button"
                  >
                    Choose .cty File...
                  </button>
                  <button
                    className="classicyButton"
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
                        runtime.sendCommand(nextCommandId(commandCounter, 'city'), {
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
                  </button>
                </div>
                <div className="flex justify-end">
                  <button
                    className="classicyButton"
                    disabled={isLoadingCityFile}
                    onClick={() => {
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Close
                  </button>
                </div>
              </section>
            )}

            {gameDialog !== 'scenario' ? null : (
              <section className="grid gap-2.5">
                <strong className="classicyRuntimePanelTitle text-sm">Scenario</strong>
                <label className="grid gap-1 text-xs">
                  Scenario
                  <select
                    autoFocus
                    className="classicyRuntimeSelect px-2 py-1"
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
                  </select>
                </label>
                <label className="grid gap-1 text-xs">
                  Difficulty
                  <select
                    className="classicyRuntimeSelect px-2 py-1"
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
                  </select>
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    className="classicyButton"
                    onClick={() => {
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="classicyButton"
                    disabled={controlsDisabled}
                    onClick={() => {
                      setHasStartedPlayableSession(true);
                      const scenario = PLAYABLE_SCENARIO_CHOICES.find(
                        (entry) => entry.id === selectedScenarioId,
                      );
                      if (scenario !== undefined) {
                        setSaveFileName(`${scenario.fileName}.cty`);
                      }
                      runtime.sendCommand(nextCommandId(commandCounter, 'scenario'), {
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
                  </button>
                </div>
              </section>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
