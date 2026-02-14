import { ClassicyButton } from '@city/classicyui';
import type { RefObject } from 'react';

import { getPlayableToolSpec } from '../../../../../game/runtime/index.ts';
import { DisastersMenu } from '../menus/disasters-menu.tsx';
import { MicropolisMenu } from '../menus/micropolis-menu.tsx';
import { SettingsMenu } from '../menus/settings-menu.tsx';
import { SpeedMenu } from '../menus/speed-menu.tsx';
import { WindowsMenu } from '../menus/windows-menu.tsx';
import {
  CLASSICY_INSET_BEVEL_SHADOW,
  CLASSICY_MENU_BUTTON_ACTIVE_CLASS,
  micropolisPausedIndicatorUrl,
  micropolisRunningIndicatorUrl,
} from '../runtime-panel-constants.ts';
import type {
  RuntimeOpenFloatingWindow,
  RuntimeSessionController,
  RuntimeUiController,
} from '../runtime-panel-types.ts';

interface RuntimeTopBarSectionProps {
  menubarRef: RefObject<HTMLElement | null>;
  openFloatingWindow: RuntimeOpenFloatingWindow;
  session: RuntimeSessionController;
  sessionControlsDisabled: boolean;
  speedControlRef: RefObject<HTMLDivElement | null>;
  ui: RuntimeUiController;
}

/**
 * Top menubar and transport controls for the runtime panel.
 * Mirrors high-level menu/transport interactions from
 * `ref/micropolis/res/whead.tcl` and `ref/micropolis/src/sim/w_update.c`.
 * Difference: browser menu popovers and button interactions replace Tk widgets.
 */
export function RuntimeTopBarSection(props: RuntimeTopBarSectionProps) {
  const { menubarRef, openFloatingWindow, session, sessionControlsDisabled, speedControlRef, ui } =
    props;
  const activeToolSpec = getPlayableToolSpec(ui.activeTool);
  const menubarButtonClass =
    '!m-0 min-w-[calc(var(--window-control-size)*7)] px-2 py-1 text-center';
  const menubarPanelClass = 'absolute left-0 top-[calc(100%+3px)] z-[12] grid p-1.5';

  return (
    <header
      ref={menubarRef}
      className="pointer-events-auto absolute left-0 right-0 top-0 z-10 flex min-h-(--runtime-top-bar-height) items-center justify-between gap-2 bg-[var(--color-system-02)] py-(--runtime-top-bar-padding-y) pl-2 pr-0 [border-bottom:calc(var(--window-border-size)*2)_solid_var(--color-black)] [box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07)]"
    >
      <div className="min-w-max flex items-center gap-2">
        <MicropolisMenu
          buttonClassName={menubarButtonClass}
          panelClassName={menubarPanelClass}
          session={session}
          sessionControlsDisabled={sessionControlsDisabled}
          ui={ui}
        />
        <WindowsMenu
          buttonClassName={menubarButtonClass}
          openFloatingWindow={openFloatingWindow}
          panelClassName={menubarPanelClass}
          ui={ui}
        />
        <DisastersMenu
          buttonClassName={menubarButtonClass}
          panelClassName={menubarPanelClass}
          session={session}
          sessionControlsDisabled={sessionControlsDisabled}
          ui={ui}
        />
        <SettingsMenu
          buttonClassName={menubarButtonClass}
          panelClassName={menubarPanelClass}
          session={session}
          ui={ui}
        />
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
            session.sendSimControlCommand({
              kind: 'sim-control',
              control: session.isSimulationRunning ? 'pause' : 'play',
            });
          }}
          className="!m-0 min-w-21 font-bold"
          type="button"
        >
          {session.isSimulationRunning ? 'Pause' : 'Play'}
        </ClassicyButton>
        <div ref={speedControlRef} className="relative">
          <SpeedMenu session={session} sessionControlsDisabled={sessionControlsDisabled} ui={ui} />
        </div>
        <ClassicyButton
          aria-label={session.isGameplayMuted ? 'Unmute audio' : 'Mute audio'}
          onClick={() => {
            session.toggleGameplayMuted();
          }}
          active={session.isGameplayMuted}
          activeClassName={CLASSICY_MENU_BUTTON_ACTIVE_CLASS}
          buttonShape="square"
          className="!m-0 inline-flex h-(--window-control-size) w-(--window-control-size) items-center justify-center p-0"
          title={session.isGameplayMuted ? 'Unmute' : 'Mute'}
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
            {session.isGameplayMuted ? (
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
        alt={
          session.isSimulationRunning
            ? 'Simulation running indicator'
            : 'Simulation paused indicator'
        }
        aria-label="Open Micropolis popup"
        draggable={false}
        onClick={() => {
          ui.setOpenMenubarSection(null);
          ui.setIsSpeedMenuOpen(false);
          ui.setIsBrandDialogOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            ui.setOpenMenubarSection(null);
            ui.setIsSpeedMenuOpen(false);
            ui.setIsBrandDialogOpen(true);
          }
        }}
        role="button"
        src={
          session.isSimulationRunning ? micropolisRunningIndicatorUrl : micropolisPausedIndicatorUrl
        }
        tabIndex={0}
        title="Micropolis"
        className="block self-stretch !mt-[calc((var(--runtime-top-bar-padding-y)*-1)+var(--window-border-size))] !mb-[calc(var(--runtime-top-bar-padding-y)*-1)] h-auto w-auto shrink-0 max-h-none cursor-pointer select-none [image-rendering:pixelated]"
      />
    </header>
  );
}
