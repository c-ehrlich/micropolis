import { ClassicyButton, ClassicyMenuPanel } from '@city/classicyui';

import type { PlayableSimSpeed } from '../../../../../game/runtime/index.ts';
import { CLASSICY_MENU_BUTTON_ACTIVE_CLASS } from '../runtime-panel-constants.ts';
import type { RuntimeSessionController, RuntimeUiController } from '../runtime-panel-types.ts';

interface SpeedMenuProps {
  session: RuntimeSessionController;
  sessionControlsDisabled: boolean;
  ui: RuntimeUiController;
}

/**
 * Simulation speed dropdown control.
 * Mirrors speed controls from `ref/micropolis/res/whead.tcl`.
 */
export function SpeedMenu(props: SpeedMenuProps) {
  const { session, sessionControlsDisabled, ui } = props;
  return (
    <>
      <ClassicyButton
        disabled={sessionControlsDisabled}
        onClick={() => {
          ui.setOpenMenubarSection(null);
          ui.setIsSpeedMenuOpen((current) => !current);
        }}
        className="!m-0 min-w-13.5 px-1.5 font-bold"
        active={ui.isSpeedMenuOpen}
        activeClassName={CLASSICY_MENU_BUTTON_ACTIVE_CLASS}
        type="button"
      >
        {session.state.hudState.speed > 0 ? `${session.state.hudState.speed}x` : '1x'} ▾
      </ClassicyButton>
      {ui.isSpeedMenuOpen ? (
        <ClassicyMenuPanel className="absolute right-0 top-[calc(100%+3px)] z-12 grid min-w-14.5 gap-0.5 p-1">
          {([1, 2, 3] as const).map((speed) => (
            <ClassicyButton
              key={speed}
              active={session.state.hudState.speed === speed}
              activeClassName={`${CLASSICY_MENU_BUTTON_ACTIVE_CLASS} font-bold`}
              className="px-2 py-1 text-left"
              disabled={sessionControlsDisabled}
              onClick={() => {
                session.sendSimControlCommand({
                  kind: 'sim-control',
                  control: 'set-speed',
                  speed: speed as PlayableSimSpeed,
                });
                ui.setIsSpeedMenuOpen(false);
              }}
              type="button"
            >
              {speed}x
            </ClassicyButton>
          ))}
        </ClassicyMenuPanel>
      ) : null}
    </>
  );
}
