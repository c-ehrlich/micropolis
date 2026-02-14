import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { createMicropolisGameplayAudioConsumer } from '../../../game/audio/micropolis-gameplay-audio-consumer.ts';
import { createMicropolisGameplaySoundPlaybackPolicy } from '../../../game/audio/micropolis-gameplay-sound-playback-policy.ts';
import { routeMicropolisGameplaySoundDeltas } from '../../../game/audio/micropolis-runtime-envelope-sound-routing.ts';
import { createCoalescedStateDispatcher } from '../../../game/runtime/frame-coalescer.ts';
import {
  coalesceQueuedRuntimeMapState,
  createWebHostRuntime,
  type PlayableToolName,
  type WebRuntimeState,
} from '../../../game/runtime/index.ts';
import {
  type CityExportPayload,
  createPlayableRuntimeHost,
  PLAYABLE_SCENARIO_CHOICES,
  readCityExportPayload,
} from '../../../game/runtime/playable-runtime-host.ts';
import type {
  PlayableCityIoCommand,
  PlayableCityLifecycleCommand,
  PlayableClientCommand,
  PlayableGameLevel,
  PlayableScenarioCommand,
  PlayableSimControlCommand,
} from '../../../game/runtime/protocol.ts';
import {
  RUNTIME_TILESET_CHOICES,
  type RuntimeTilesetName,
} from '../../../presentation/map/tile-sprite-atlas.ts';
import { formatRuntimePhaseStatus, nextCommandId } from './runtime-panel-behavior.ts';

export type TopMenubarSection = 'micropolis' | 'windows' | 'disasters' | 'settings';
export type GameDialogKind = 'new' | 'save' | 'load' | 'scenario';
export type RuntimeFloatingWindowId = 'budget' | 'evaluation' | 'graph';

export interface RuntimeFloatingWindowState {
  open: boolean;
  x: number;
  y: number;
  zIndex: number;
}

export interface RuntimeFloatingWindowsState {
  budget: RuntimeFloatingWindowState;
  evaluation: RuntimeFloatingWindowState;
  graph: RuntimeFloatingWindowState;
}

interface FloatingWindowDragState {
  windowId: RuntimeFloatingWindowId;
  offsetX: number;
  offsetY: number;
  windowWidth: number;
  windowHeight: number;
}

export interface RuntimeLayoutInsets {
  left: number;
  top: number;
}

interface UseRuntimeSessionOptions {
  onCityExport?: (payload: CityExportPayload) => void;
}

/**
 * Runtime session controller for authoritative host connectivity and command dispatch.
 * Mirrors runtime connect/update/command ownership in `ref/micropolis/src/sim/w_sim.c`
 * and `ref/micropolis/src/sim/w_update.c`.
 * Difference: this hook keeps web-only coalescing/audio policy and exposes typed
 * command helpers instead of Tcl command strings.
 */
export function useRuntimeSession(options: UseRuntimeSessionOptions = {}) {
  const onCityExport = options.onCityExport;
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
  const commandCounter = useRef(1);

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
        onCityExport?.(savePayload);
      }
    });

    runtime.connect();
    return () => {
      unsubscribe();
      stateCommitDispatcher.dispose();
      runtime.disconnect();
      gameplayAudioConsumer.dispose();
    };
  }, [
    gameplayAudioConsumer,
    gameplaySoundPlaybackPolicy,
    onCityExport,
    runtime,
    stateCommitDispatcher,
  ]);

  const sendCommand = useCallback(
    (prefix: 'tool' | 'sim' | 'city' | 'scenario', command: PlayableClientCommand): void => {
      runtime.sendCommand(nextCommandId(commandCounter, prefix), command);
    },
    [runtime],
  );
  const sendToolCommand = useCallback(
    (tool: PlayableToolName, x: number, y: number): void => {
      sendCommand('tool', {
        kind: 'tool',
        tool,
        x,
        y,
      });
    },
    [sendCommand],
  );
  const sendSimControlCommand = useCallback(
    (command: PlayableSimControlCommand): void => {
      sendCommand('sim', command);
    },
    [sendCommand],
  );
  const sendCityLifecycleCommand = useCallback(
    (command: PlayableCityLifecycleCommand): void => {
      sendCommand('city', command);
    },
    [sendCommand],
  );
  const sendCityIoCommand = useCallback(
    (command: PlayableCityIoCommand): void => {
      sendCommand('city', command);
    },
    [sendCommand],
  );
  const sendScenarioCommand = useCallback(
    (command: PlayableScenarioCommand): void => {
      sendCommand('scenario', command);
    },
    [sendCommand],
  );
  const toggleGameplayMuted = useCallback((): void => {
    setIsGameplayMuted((current) => {
      const nextMuted = !current;
      if (nextMuted) {
        gameplayAudioConsumer.dispose();
      }
      return nextMuted;
    });
  }, [gameplayAudioConsumer]);
  const reconnect = useCallback((): void => {
    runtime.reconnect();
  }, [runtime]);
  const requestResyncSnapshot = useCallback((): void => {
    runtime.requestSnapshot('resync');
  }, [runtime]);
  const controlsDisabled = state.phase !== 'ready';
  const reconnectDisabled =
    state.phase === 'connecting' || state.phase === 'negotiating' || state.phase === 'reconnecting';
  const resyncDisabled =
    state.phase === 'disconnected' ||
    state.phase === 'connecting' ||
    state.phase === 'negotiating' ||
    state.phase === 'reconnecting' ||
    state.phase === 'failed';
  const isSimulationRunning = state.hudState.speed > 0;
  const runtimePhaseStatus = formatRuntimePhaseStatus(state.phase);

  return {
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
  };
}

/**
 * Client-only runtime panel UI state controller.
 * Mirrors menu/dialog/window launch intent in `ref/micropolis/res/whead.tcl`.
 * Difference: this hook owns browser-local state (dialogs, drafts, open menus),
 * which has no direct C-side persistence.
 */
export function useRuntimeUiState() {
  const [activeTool, setActiveTool] = useState<PlayableToolName>('road');
  const [selectedScenarioId, setSelectedScenarioId] = useState<number>(
    PLAYABLE_SCENARIO_CHOICES[0]?.id ?? 1,
  );
  const [selectedGameLevel, setSelectedGameLevel] = useState<PlayableGameLevel>(0);
  const [hasStartedPlayableSession, setHasStartedPlayableSession] = useState(false);
  const [saveFileName, setSaveFileName] = useState('newcity.cty');
  const [lastSaveStatus, setLastSaveStatus] = useState<string>('');
  const [cityIoError, setCityIoError] = useState<string>('');
  const [openMenubarSection, setOpenMenubarSection] = useState<TopMenubarSection | null>(null);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const [graphRange, setGraphRange] = useState<10 | 120>(10);
  const [graphMask, setGraphMask] = useState(0b111);
  const [gameDialog, setGameDialog] = useState<GameDialogKind | null>(null);
  const [isBrandDialogOpen, setIsBrandDialogOpen] = useState(false);
  const [dismissedNoticeSignature, setDismissedNoticeSignature] = useState<string | null>(null);
  const [saveFileNameDraft, setSaveFileNameDraft] = useState('newcity.cty');
  const [pendingLoadFile, setPendingLoadFile] = useState<File | null>(null);
  const [isLoadingCityFile, setIsLoadingCityFile] = useState(false);
  const [selectedRuntimeTileset, setSelectedRuntimeTileset] =
    useState<RuntimeTilesetName>('classic');
  // Temporarily hide `ancientasia` because upstream tileset files are incorrect.
  // Tracking: https://github.com/SimHacker/MicropolisCore/issues/9
  const runtimeTilesetMenuChoices = useMemo(
    () => RUNTIME_TILESET_CHOICES.filter((choice) => choice.name !== 'ancientasia'),
    [],
  );

  const applyCityExportPayload = useCallback((payload: CityExportPayload): void => {
    setSaveFileName(payload.fileName);
    setLastSaveStatus(`Saved ${payload.cityName} -> ${payload.fileName}`);
    setCityIoError('');
  }, []);

  return {
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
  };
}

/**
 * Floating-window state controller for budget/evaluation/graph overlays.
 * Mirrors top-level window open/focus/drag interactions in
 * `ref/micropolis/res/whead.tcl`.
 * Difference: browser pointer event wiring manages drag updates and z-order
 * with React state/ref instead of Tk window manager primitives.
 */
export function useFloatingWindowsState() {
  const [floatingWindows, setFloatingWindows] = useState<RuntimeFloatingWindowsState>(() =>
    createInitialRuntimeFloatingWindows(),
  );
  const floatingWindowDragRef = useRef<FloatingWindowDragState | null>(null);
  const floatingWindowZCounterRef = useRef(30);

  const focusFloatingWindow = useCallback((windowId: RuntimeFloatingWindowId): void => {
    const nextZIndex = floatingWindowZCounterRef.current + 1;
    floatingWindowZCounterRef.current = nextZIndex;
    setFloatingWindows((current) => ({
      ...current,
      [windowId]: {
        ...current[windowId],
        zIndex: nextZIndex,
      },
    }));
  }, []);

  const openFloatingWindow = useCallback(
    (windowId: RuntimeFloatingWindowId): void => {
      focusFloatingWindow(windowId);
      setFloatingWindows((current) => ({
        ...current,
        [windowId]: {
          ...current[windowId],
          open: true,
        },
      }));
    },
    [focusFloatingWindow],
  );

  const closeFloatingWindow = useCallback((windowId: RuntimeFloatingWindowId): void => {
    setFloatingWindows((current) => ({
      ...current,
      [windowId]: {
        ...current[windowId],
        open: false,
      },
    }));
  }, []);

  const startFloatingWindowDrag = useCallback(
    (windowId: RuntimeFloatingWindowId, event: ReactPointerEvent<HTMLElement>): void => {
      const windowElement = event.currentTarget.closest<HTMLElement>('[data-floating-window]');
      if (windowElement === null) {
        return;
      }
      const bounds = windowElement.getBoundingClientRect();
      floatingWindowDragRef.current = {
        windowId,
        offsetX: event.clientX - bounds.left,
        offsetY: event.clientY - bounds.top,
        windowWidth: Math.max(1, Math.ceil(bounds.width)),
        windowHeight: Math.max(1, Math.ceil(bounds.height)),
      };
      focusFloatingWindow(windowId);
    },
    [focusFloatingWindow],
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = floatingWindowDragRef.current;
      if (dragState === null) {
        return;
      }

      const unclampedX = Math.trunc(event.clientX - dragState.offsetX);
      const unclampedY = Math.trunc(event.clientY - dragState.offsetY);
      const maxX = Math.max(0, window.innerWidth - dragState.windowWidth);
      const maxY = Math.max(0, window.innerHeight - dragState.windowHeight);
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

  return {
    closeFloatingWindow,
    floatingWindows,
    focusFloatingWindow,
    openFloatingWindow,
    startFloatingWindowDrag,
  };
}

interface UseRuntimeLayoutInsetsOptions {
  menubarRef: RefObject<HTMLElement | null>;
  sidebarRef: RefObject<HTMLElement | null>;
}

/**
 * Layout inset controller for map viewport positioning below menubar and right of sidebar.
 * Mirrors reserved map viewport regions in classic Tcl shell layouts
 * (`ref/micropolis/res/whead.tcl`).
 * Difference: uses browser `ResizeObserver` and DOM measurements rather than
 * fixed Tk geometry.
 */
export function useRuntimeLayoutInsets(
  options: UseRuntimeLayoutInsetsOptions,
): RuntimeLayoutInsets {
  const [layoutInsets, setLayoutInsets] = useState<RuntimeLayoutInsets>({ left: 96, top: 34 });

  useLayoutEffect(() => {
    const menubarElement = options.menubarRef.current;
    const sidebarElement = options.sidebarRef.current;
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
  }, [options.menubarRef, options.sidebarRef]);

  return layoutInsets;
}

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
