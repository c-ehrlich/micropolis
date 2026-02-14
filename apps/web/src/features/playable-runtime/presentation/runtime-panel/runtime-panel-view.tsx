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
  RuntimeBudgetState,
  RuntimeFloatingWindowsController,
  RuntimeOpenFloatingWindow,
  RuntimeSessionController,
  RuntimeUiController,
} from './runtime-panel-types.ts';
import { RuntimeMessageFeedDock } from './sections/message-feed-dock.tsx';
import { RuntimeSidebarSection } from './sections/sidebar.tsx';
import { RuntimeTopBarSection } from './sections/top-bar.tsx';

interface RuntimePanelViewProps {
  activeNoticeSignature: string | null;
  applyBudgetControlState: (nextBudgetState: RuntimeBudgetState) => void;
  budgetWindowOriginalStateRef: MutableRefObject<RuntimeBudgetState>;
  floating: RuntimeFloatingWindowsController;
  layoutInsets: RuntimeLayoutInsets;
  loadInputRef: RefObject<HTMLInputElement | null>;
  menubarRef: RefObject<HTMLElement | null>;
  openFloatingWindow: RuntimeOpenFloatingWindow;
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
    applyBudgetControlState,
    budgetWindowOriginalStateRef,
    floating,
    layoutInsets,
    loadInputRef,
    menubarRef,
    openFloatingWindow,
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
            if (sessionControlsDisabled) {
              return;
            }
            session.sendToolCommand(ui.activeTool, x, y);
          }}
          pendingTools={session.state.pendingTools}
          realtimeObjects={session.state.realtimeState.objects}
          tileSize={MAP_TILE_SIZE}
          tilesetName={ui.selectedRuntimeTileset}
        />
      </div>

      <RuntimeTopBarSection
        menubarRef={menubarRef}
        openFloatingWindow={openFloatingWindow}
        session={session}
        sessionControlsDisabled={sessionControlsDisabled}
        speedControlRef={speedControlRef}
        ui={ui}
      />

      {visibleNotice === null ? null : (
        <NoticePanel
          notice={visibleNotice}
          onDismiss={() => {
            ui.setDismissedNoticeSignature(activeNoticeSignature);
          }}
          topInsetPx={layoutInsets.top}
        />
      )}

      <RuntimeSidebarSection
        openFloatingWindow={openFloatingWindow}
        session={session}
        sessionControlsDisabled={sessionControlsDisabled}
        sidebarRef={sidebarRef}
        topInsetPx={layoutInsets.top}
        ui={ui}
      />

      <RuntimeMessageFeedDock session={session} />

      <RuntimeFloatingWindowsLayer
        applyBudgetControlState={applyBudgetControlState}
        budgetWindowOriginalStateRef={budgetWindowOriginalStateRef}
        floating={floating}
        session={session}
        sessionControlsDisabled={sessionControlsDisabled}
        ui={ui}
      />

      <RuntimeBrandDialog ui={ui} />

      <RuntimeGameDialogs
        loadInputRef={loadInputRef}
        session={session}
        sessionControlsDisabled={sessionControlsDisabled}
        ui={ui}
      />
    </section>
  );
}
