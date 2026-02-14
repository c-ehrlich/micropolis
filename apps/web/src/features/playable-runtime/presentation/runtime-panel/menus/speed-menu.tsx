import { ClassicyButton, ClassicyMenuPanel } from '@city/classicyui';

import { CLASSICY_MENU_BUTTON_ACTIVE_CLASS } from '../runtime-panel-constants.ts';
import type { RuntimeSessionController, RuntimeSpeedActions } from '../runtime-panel-types.ts';

interface SpeedMenuProps {
  speedActions: RuntimeSpeedActions;
  isOpen: boolean;
  sessionControlsDisabled: boolean;
  speed: RuntimeSessionController['state']['hudState']['speed'];
}

/**
 * Simulation speed dropdown control.
 * Mirrors speed controls from `ref/micropolis/res/whead.tcl`.
 */
export function SpeedMenu(props: SpeedMenuProps) {
  const { speedActions, isOpen, sessionControlsDisabled, speed } = props;
  return (
    <>
      <ClassicyButton
        disabled={sessionControlsDisabled}
        onClick={() => {
          speedActions.toggleSpeedMenu();
        }}
        className="!m-0 min-w-13.5 px-1.5 font-bold"
        active={isOpen}
        activeClassName={CLASSICY_MENU_BUTTON_ACTIVE_CLASS}
        type="button"
      >
        {speed > 0 ? `${speed}x` : '1x'} ▾
      </ClassicyButton>
      {isOpen ? (
        <ClassicyMenuPanel className="absolute right-0 top-[calc(100%+3px)] z-12 grid min-w-14.5 gap-0.5 p-1">
          {([1, 2, 3] as const).map((speed) => (
            <ClassicyButton
              key={speed}
              active={props.speed === speed}
              activeClassName={`${CLASSICY_MENU_BUTTON_ACTIVE_CLASS} font-bold`}
              className="px-2 py-1 text-left"
              disabled={sessionControlsDisabled}
              onClick={() => {
                speedActions.setSimulationSpeed(speed);
                speedActions.closeSpeedMenu();
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
