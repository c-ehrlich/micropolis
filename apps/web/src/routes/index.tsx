import { getAllThemes, getThemeVars } from '@city/classicyui';
import { createFileRoute } from '@tanstack/react-router';
import { type CSSProperties, useCallback, useEffect, useRef } from 'react';

import { downloadCityBytes } from '../features/playable-runtime/behavior/runtime-panel-behavior.ts';
import {
  type RuntimeFloatingWindowId,
  useFloatingWindowsState,
  useRuntimeLayoutInsets,
  useRuntimeSession,
  useRuntimeUiState,
} from '../features/playable-runtime/behavior/runtime-panel-controller.ts';
import { RuntimePanelView } from '../features/playable-runtime/presentation/runtime-panel/runtime-panel-view.tsx';
import { type CityExportPayload } from '../game/runtime/playable-runtime-host.ts';

export const Route = createFileRoute('/')({
  component: HomePage,
});

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
    isSpeedMenuOpen,
    openMenubarSection,
    setGameDialog,
    setHasStartedPlayableSession,
    setIsBrandDialogOpen,
    setIsSpeedMenuOpen,
    setOpenMenubarSection,
  } = ui;

  const onCityExport = useCallback(
    (payload: CityExportPayload): void => {
      downloadCityBytes(payload.fileName, payload.cityBytes);
      applyCityExportPayload(payload);
    },
    [applyCityExportPayload],
  );

  const session = useRuntimeSession({ onCityExport });
  const { controlsDisabled, sendSimControlCommand, state } = session;
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
    isSpeedMenuOpen,
    openMenubarSection,
    setGameDialog,
    setIsBrandDialogOpen,
    setIsSpeedMenuOpen,
    setOpenMenubarSection,
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
      applyBudgetControlState={applyBudgetControlState}
      budgetWindowOriginalStateRef={budgetWindowOriginalStateRef}
      floating={floating}
      layoutInsets={layoutInsets}
      loadInputRef={loadInputRef}
      menubarRef={menubarRef}
      openFloatingWindow={openFloatingWindow}
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
