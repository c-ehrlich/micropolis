import './index.classicy.css';

import { createFileRoute } from '@tanstack/react-router';
import { getAllThemes, getThemeVars } from 'classicy';
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import demandGaugeBackgroundUrl from '../../../../packages/sim-assets/generated-images/images/demandg.png';
import micropolisRunningIndicatorUrl from '../../../../packages/sim-assets/generated-images/images/micropolisg.png';
import micropolisPausedIndicatorUrl from '../../../../packages/sim-assets/generated-images/images/micropoliss.png';
import { resolveSimUiToolIconAssetLookup } from '../../../../packages/sim-assets/src/sim-ui.ts';
import { createMicropolisGameplayAudioConsumer } from '../game/audio/micropolis-gameplay-audio-consumer.ts';
import { createMicropolisGameplaySoundPlaybackPolicy } from '../game/audio/micropolis-gameplay-sound-playback-policy.ts';
import { routeMicropolisGameplaySoundDeltas } from '../game/audio/micropolis-runtime-envelope-sound-routing.ts';
import { MapCanvas } from '../game/map/map-canvas.tsx';
import { createCoalescedStateDispatcher } from '../game/runtime/frame-coalescer.ts';
import {
  coalesceQueuedRuntimeMapState,
  createWebHostRuntime,
  getPlayableToolSpec,
  PLAYABLE_TOOL_SPECS,
  type PlayableSimSpeed,
  type PlayableToolName,
  type RuntimeHudMessageEvent,
  type RuntimeHudNoticeEvent,
  type WebRuntimeState,
} from '../game/runtime/index.ts';
import {
  createPlayableRuntimeHost,
  PLAYABLE_DISASTER_CHOICES,
  PLAYABLE_SCENARIO_CHOICES,
  type PlayableDisasterChoiceId,
  readCityExportPayload,
  triggerPlayableRuntimeDisaster,
} from '../game/runtime/playable-runtime-host.ts';
import { type CoreHost, type PlayableGameLevel } from '../game/runtime/protocol.ts';

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
type TopMenubarSection = 'game' | 'disasters' | 'runtime';
type GameDialogKind = 'new' | 'save' | 'load' | 'scenario';
const PLAYABLE_GAME_LEVEL_CHOICES: ReadonlyArray<{
  id: PlayableGameLevel;
  label: 'Easy' | 'Medium' | 'Hard';
  startingFundsLabel: string;
}> = [
  { id: 0, label: 'Easy', startingFundsLabel: '$20,000' },
  { id: 1, label: 'Medium', startingFundsLabel: '$10,000' },
  { id: 2, label: 'Hard', startingFundsLabel: '$5,000' },
];

/**
 * Triggers one playable-route manual disaster control click and returns status text.
 * Mirrors Disasters menu entrypoint ownership in `ref/micropolis/res/whead.tcl`,
 * with runtime disaster handling in `ref/micropolis/src/sim/s_disast.c` and
 * `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: this keeps route `/` disaster controls host-agnostic by delegating
 * to the structural host capability adapter instead of concrete host classes.
 */
export function triggerRouteDisasterControl(
  host: CoreHost,
  disasterId: PlayableDisasterChoiceId,
  disasterLabel: string,
): string {
  if (triggerPlayableRuntimeDisaster(host, disasterId)) {
    return `${disasterLabel}.`;
  }

  return 'Disaster trigger is unavailable on this host.';
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
  const [gameDialog, setGameDialog] = useState<GameDialogKind | null>(null);
  const [dismissedNoticeSignature, setDismissedNoticeSignature] = useState<string | null>(null);
  const [saveFileNameDraft, setSaveFileNameDraft] = useState('newcity.cty');
  const [pendingLoadFile, setPendingLoadFile] = useState<File | null>(null);
  const [isLoadingCityFile, setIsLoadingCityFile] = useState(false);
  const [layoutInsets, setLayoutInsets] = useState({ left: 96, top: 34 });
  const menubarRef = useRef<HTMLElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const speedControlRef = useRef<HTMLDivElement | null>(null);
  const loadInputRef = useRef<HTMLInputElement | null>(null);
  const handledLoseNoticeServerSeq = useRef(0);
  const commandCounter = useRef(1);

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
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenubarSection, isSpeedMenuOpen]);

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
  const menubarButtonClass = 'classicyButton classicyRuntimeMenuButton px-2 py-1 text-left';
  const menubarPanelClass =
    'classicyRuntimeMenuPanel absolute left-0 top-[calc(100%+3px)] z-[12] grid p-1.5';
  const runtimeTheme = useMemo(() => {
    const theme = getAllThemes()[0];
    if (theme === undefined) {
      return {};
    }
    return getThemeVars(theme);
  }, []);

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
      className="classicyRuntimePanel relative h-full w-full overflow-hidden"
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
        />
      </div>

      <header
        ref={menubarRef}
        className="classicyRuntimeMenuBar classicyRuntimeTopBar pointer-events-auto absolute left-0 right-0 top-0 z-10 flex items-center justify-between gap-2 px-2"
      >
        <div className="classicyRuntimeTopLeft flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => {
                setOpenMenubarSection((current) => (current === 'game' ? null : 'game'));
                setIsSpeedMenuOpen(false);
              }}
              className={`${menubarButtonClass} ${openMenubarSection === 'game' ? 'classicyRuntimeMenuButtonActive' : ''}`}
              type="button"
            >
              Game
            </button>
            {openMenubarSection !== 'game' ? null : (
              <section className={`${menubarPanelClass} min-w-[204px] gap-0.5`}>
                <button
                  disabled={controlsDisabled}
                  onClick={() => {
                    setGameDialog('new');
                    setOpenMenubarSection(null);
                  }}
                  className="classicyButton classicyRuntimeMenuItem text-left"
                  type="button"
                >
                  New
                </button>
                <button
                  disabled={sessionControlsDisabled}
                  onClick={() => {
                    setSaveFileNameDraft(saveFileName);
                    setGameDialog('save');
                    setOpenMenubarSection(null);
                  }}
                  className="classicyButton classicyRuntimeMenuItem text-left"
                  type="button"
                >
                  Save...
                </button>
                <button
                  disabled={controlsDisabled}
                  onClick={() => {
                    setPendingLoadFile(null);
                    setGameDialog('load');
                    setOpenMenubarSection(null);
                  }}
                  className="classicyButton classicyRuntimeMenuItem text-left"
                  type="button"
                >
                  Load...
                </button>
                <button
                  disabled={controlsDisabled}
                  onClick={() => {
                    setGameDialog('scenario');
                    setOpenMenubarSection(null);
                  }}
                  className="classicyButton classicyRuntimeMenuItem text-left"
                  type="button"
                >
                  Scenario...
                </button>
              </section>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => {
                setOpenMenubarSection((current) => (current === 'disasters' ? null : 'disasters'));
                setIsSpeedMenuOpen(false);
              }}
              className={`${menubarButtonClass} ${openMenubarSection === 'disasters' ? 'classicyRuntimeMenuButtonActive' : ''}`}
              type="button"
            >
              Disasters
            </button>
            {openMenubarSection !== 'disasters' ? null : (
              <section className={`${menubarPanelClass} min-w-[204px] gap-1`}>
                {PLAYABLE_DISASTER_CHOICES.map((choice) => (
                  <button
                    key={choice.id}
                    disabled={sessionControlsDisabled}
                    onClick={() => {
                      setDisasterStatus(triggerRouteDisasterControl(host, choice.id, choice.label));
                      setOpenMenubarSection(null);
                    }}
                    className="classicyButton classicyRuntimeMenuItem text-left"
                    type="button"
                  >
                    {choice.label.replace('Trigger ', '')}
                  </button>
                ))}
              </section>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => {
                setOpenMenubarSection((current) => (current === 'runtime' ? null : 'runtime'));
                setIsSpeedMenuOpen(false);
              }}
              className={`${menubarButtonClass} ${openMenubarSection === 'runtime' ? 'classicyRuntimeMenuButtonActive' : ''}`}
              type="button"
            >
              Runtime
            </button>
            {openMenubarSection !== 'runtime' ? null : (
              <section className={`${menubarPanelClass} min-w-[290px] gap-1.5 p-2`}>
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
                  <button
                    disabled={reconnectDisabled}
                    onClick={() => {
                      runtime.reconnect();
                      setCityIoError('');
                      setLastSaveStatus('');
                    }}
                    className="classicyButton classicyRuntimeRuntimeAction"
                    type="button"
                  >
                    Reconnect
                  </button>
                  <button
                    disabled={resyncDisabled}
                    onClick={() => {
                      runtime.requestSnapshot('resync');
                    }}
                    className="classicyButton classicyRuntimeRuntimeAction"
                    type="button"
                  >
                    Resync Snapshot
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
        <div className="classicyRuntimeTopStatus pointer-events-none absolute left-1/2 top-1/2 z-[11] flex -translate-x-1/2 -translate-y-1/2 flex-col px-2 py-0.5">
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
          <button
            disabled={sessionControlsDisabled}
            onClick={() => {
              runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
                kind: 'sim-control',
                control: isSimulationRunning ? 'pause' : 'play',
              });
            }}
            className="classicyButton classicyRuntimeTopControlButton min-w-[84px] font-bold"
            type="button"
          >
            {isSimulationRunning ? 'Pause' : 'Play'}
          </button>
          <div ref={speedControlRef} className="relative">
            <button
              disabled={sessionControlsDisabled}
              onClick={() => {
                setOpenMenubarSection(null);
                setIsSpeedMenuOpen((current) => !current);
              }}
              className={`classicyButton classicyRuntimeTopControlButton min-w-[54px] px-1.5 font-bold ${
                isSpeedMenuOpen ? 'classicyRuntimeMenuButtonActive' : ''
              }`}
              type="button"
            >
              {state.hudState.speed > 0 ? `${state.hudState.speed}x` : '1x'} ▾
            </button>
            {isSpeedMenuOpen ? (
              <section className="classicyRuntimeMenuPanel absolute right-0 top-[calc(100%+3px)] z-[12] grid min-w-[58px] gap-0.5 p-1">
                {([1, 2, 3] as const).map((speed) => (
                  <button
                    key={speed}
                    className={`classicyButton px-2 py-1 text-left ${
                      state.hudState.speed === speed
                        ? 'classicyRuntimeMenuButtonActive font-bold'
                        : ''
                    }`}
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
                  </button>
                ))}
              </section>
            ) : null}
          </div>
          <button
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
            className={`classicyButton classicyRuntimeTopControlButton classicyButtonShapeSquare inline-flex h-[var(--window-control-size)] w-[var(--window-control-size)] items-center justify-center p-0 ${
              isGameplayMuted ? 'classicyRuntimeMenuButtonActive' : ''
            }`}
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
          </button>
        </div>
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
        className="classicyRuntimeSidebar classicyRuntimePanelChrome pointer-events-auto absolute bottom-0 left-0 z-[6] grid gap-1.5 overflow-y-auto px-2 py-3"
        style={{ top: layoutInsets.top }}
      >
        <div className="mx-auto grid grid-cols-2 justify-center gap-1.5">
          <div className="col-span-2 flex justify-center pb-0.5">
            <img
              alt={
                isSimulationRunning ? 'Simulation running indicator' : 'Simulation paused indicator'
              }
              draggable={false}
              src={
                isSimulationRunning ? micropolisRunningIndicatorUrl : micropolisPausedIndicatorUrl
              }
              className="block h-[47px] w-[37px] [image-rendering:pixelated]"
            />
          </div>
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
        <DemandHeadsWidget
          demandC={state.hudState.demandC}
          demandI={state.hudState.demandI}
          demandR={state.hudState.demandR}
        />
        <div className="grid gap-0.5 text-center text-[11px]">
          <div>{state.hudState.fundsLabel}</div>
          <div>{state.hudState.dateDisplayLabel}</div>
          <div>{`Population: ${state.hudState.cityPopulation.toLocaleString('en-US')}`}</div>
          <div>{`Class: ${state.hudState.cityClassLabel}`}</div>
        </div>
      </section>

      <section className="classicyRuntimeBottomFeed classicyRuntimePanelChrome pointer-events-auto absolute left-1/2 z-[6] grid w-[min(560px,calc(100vw-24px))] -translate-x-1/2 gap-1 p-2">
        <strong className="classicyRuntimePanelTitle text-center text-[11px] uppercase tracking-[0.4px]">
          Message Feed
        </strong>
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

      {gameDialog === null ? null : (
        <div
          onClick={() => {
            if (!isLoadingCityFile) {
              setGameDialog(null);
            }
          }}
          className="classicyRuntimeDialogBackdrop pointer-events-auto absolute inset-0 z-[15] flex items-center justify-center"
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

/**
 * Authoritative Runtime notice panel.
 * Mirrors `UIShowPictureOn` + `NoticeMessageOn` rendering and local dismiss behavior
 * in `ref/micropolis/res/micropolis.tcl` and `ref/micropolis/res/wnotice.tcl`.
 * Parity note: dismiss is UI-only and does not send a simulation command.
 */
function NoticePanel({
  notice,
  onDismiss,
  topInsetPx,
}: {
  notice: RuntimeHudNoticeEvent;
  onDismiss: () => void;
  topInsetPx: number;
}) {
  return (
    <section
      className="classicyRuntimeNoticePanel classicyRuntimePanelChrome pointer-events-auto absolute right-3 z-[13] grid max-h-[min(45vh,320px)] w-[min(520px,calc(100vw-24px))] max-w-[min(520px,calc(100vw-24px))] gap-2.5 overflow-hidden p-2.5"
      style={{ top: `calc(${topInsetPx}px + var(--window-padding-size))` }}
    >
      <header
        className="flex items-center justify-between border px-2 py-1.5"
        style={{ background: notice.color }}
      >
        <strong className="text-xs">{notice.title}</strong>
        <span className="text-[11px]">#{notice.id}</span>
      </header>
      <pre className="classicyRuntimeMessageFeed m-0 overflow-auto whitespace-pre-wrap p-2 text-xs leading-[18px]">
        {notice.body}
      </pre>
      <div className="flex justify-end">
        <button className="classicyButton" onClick={onDismiss} type="button">
          Dismiss
        </button>
      </div>
    </section>
  );
}

/**
 * Demand heads widget shown in the Build tool rail.
 * Mirrors demand canvas composition in `ref/micropolis/res/whead.tcl` and
 * bar updates from `UISetDemand` in `ref/micropolis/res/micropolis.tcl`.
 * Parity note: this uses PNG conversions of the original XPM art and CSS
 * absolutely positioned bars instead of Tk canvas primitives.
 */
function DemandHeadsWidget({
  demandR,
  demandC,
  demandI,
}: {
  demandR: number;
  demandC: number;
  demandI: number;
}) {
  const demandBars = [
    { channel: 'r', demand: demandR, left: 8, fillColor: '#1b8f3a' },
    { channel: 'c', demand: demandC, left: 17, fillColor: '#1b2fe0' },
    { channel: 'i', demand: demandI, left: 26, fillColor: '#ff7a1a' },
  ] as const;

  return (
    <div
      className="flex w-full justify-center"
      title={`Demand R/C/I: ${demandR}/${demandC}/${demandI}`}
    >
      <div
        aria-label={`Demand heads R ${demandR}, C ${demandC}, I ${demandI}`}
        role="img"
        className="relative h-[110px] w-[78px]"
      >
        <div className="absolute left-0 top-0 h-[55px] w-[39px] origin-top-left [transform:scale(2)]">
          <img
            alt=""
            aria-hidden
            draggable={false}
            src={demandGaugeBackgroundUrl}
            className="pointer-events-none absolute left-0 top-1 block h-[47px] w-[39px] [image-rendering:pixelated]"
          />
          {demandBars.map((bar) => (
            <div
              key={bar.channel}
              className="pointer-events-none absolute w-[7px]"
              style={resolveDemandBarStyle({
                demand: bar.demand,
                fillColor: bar.fillColor,
                left: bar.left,
              })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Computes one vertical demand-bar segment style.
 * Mirrors the Tcl `UISetDemand` branch and coordinate math in
 * `ref/micropolis/res/micropolis.tcl` (1:1 baseline and endpoint behavior).
 */
function resolveDemandBarStyle({
  demand,
  left,
  fillColor,
}: {
  demand: number;
  left: number;
  fillColor: string;
}): CSSProperties {
  const clampedDemand = Math.max(-15, Math.min(15, Math.trunc(demand)));
  const baseline = clampedDemand <= 0 ? 32 : 24;
  const endpoint = baseline - clampedDemand;
  const top = Math.min(baseline, endpoint);
  const bottom = Math.max(baseline, endpoint);
  return {
    background: fillColor,
    height: Math.max(1, bottom - top),
    left,
    top,
  };
}

/**
 * Normalizes Save dialog file-name input to one classic `.cty` target.
 * Mirrors `SaveCityAs` naming flow in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: browser UI keeps user-entered names but appends `.cty`
 * when no extension is provided.
 */
function normalizeCitySaveFileName(fileNameInput: string): string {
  const trimmedName = fileNameInput.trim();
  if (trimmedName === '') {
    return 'newcity.cty';
  }
  if (trimmedName.toLowerCase().endsWith('.cty')) {
    return trimmedName;
  }
  return `${trimmedName}.cty`;
}

/**
 * Triggers a browser download for exported `.cty` payload bytes.
 * Mirrors `SaveCityAs` user-selected output intent in `ref/micropolis/src/sim/s_fileio.c`.
 */
function downloadCityBytes(fileName: string, cityBytes: Uint8Array): void {
  const blobBytes = new Uint8Array(cityBytes.byteLength);
  blobBytes.set(cityBytes);
  const blob = new Blob([blobBytes.buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';

  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Deterministically builds command ids for runtime command sends.
 * Mirrors `commandId`-based host correlation requirements from Stage plans.
 */
function nextCommandId(counter: { current: number }, prefix: string): string {
  const nextValue = counter.current;
  counter.current = nextValue + 1;
  return `${prefix}-${nextValue}`;
}

/**
 * Runtime phase status text shown above Authoritative Runtime reconnect/resync controls.
 * Mirrors reconnect/resync lifecycle intent from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
function formatRuntimePhaseStatus(phase: WebRuntimeState['phase']): string {
  if (phase === 'reconnecting') {
    return 'Reconnecting to host...';
  }
  if (phase === 'resyncing') {
    return 'Resyncing authoritative snapshot...';
  }
  if (phase === 'negotiating') {
    return 'Negotiating hello handshake...';
  }
  if (phase === 'connecting') {
    return 'Connecting to host...';
  }
  if (phase === 'failed') {
    return 'Connection failed. Reconnect to retry.';
  }
  if (phase === 'disconnected') {
    return 'Disconnected.';
  }
  return 'Connected.';
}

/**
 * Authoritative Runtime message feed view.
 * Mirrors user-visible message surface from `UISetMessage` in
 * `ref/micropolis/src/sim/s_msg.c`, with a bounded reverse-chronological list.
 */
function MessageFeed({ messages }: { messages: readonly RuntimeHudMessageEvent[] }) {
  return (
    <div className="classicyRuntimeMessageFeed h-[58px] overflow-y-auto px-1.5 py-1 text-xs">
      {messages.length === 0 ? (
        <div className="leading-4">No messages yet.</div>
      ) : (
        [...messages].reverse().map((message) => {
          const coordinateSuffix =
            message.dispatch === 'sendMesAt' && message.x !== null && message.y !== null
              ? ` @ (${message.x}, ${message.y})`
              : '';
          return (
            <div
              key={`${message.serverSeq}:${message.id}:${message.tick}:${message.x ?? 'na'}:${message.y ?? 'na'}`}
              className="overflow-hidden text-ellipsis whitespace-nowrap leading-4"
            >
              <span className="text-blue-700">[{message.serverSeq}]</span> {message.text}
              {coordinateSuffix}
            </div>
          );
        })
      )}
    </div>
  );
}
