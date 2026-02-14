import { ClassicyMenuItemButton } from '@city/classicyui';

import { PLAYABLE_DISASTER_CHOICES } from '../../../../../game/runtime/playable-runtime-host.ts';
import { triggerRouteDisasterControl } from '../../../behavior/runtime-panel-behavior.ts';
import type { RuntimeSessionController, RuntimeUiController } from '../runtime-panel-types.ts';
import { RuntimeTopMenuShell } from './menu-shell.tsx';

interface DisastersMenuProps {
  buttonClassName: string;
  panelClassName: string;
  session: RuntimeSessionController;
  sessionControlsDisabled: boolean;
  ui: RuntimeUiController;
}

/**
 * Disasters menu for manual disaster triggers.
 * Mirrors disaster-menu command entries in `ref/micropolis/res/whead.tcl`.
 */
export function DisastersMenu(props: DisastersMenuProps) {
  const { buttonClassName, panelClassName, session, sessionControlsDisabled, ui } = props;
  return (
    <RuntimeTopMenuShell
      buttonClassName={buttonClassName}
      isOpen={ui.openMenubarSection === 'disasters'}
      label="Disasters"
      onToggle={() => {
        ui.setOpenMenubarSection((current) => (current === 'disasters' ? null : 'disasters'));
        ui.setIsSpeedMenuOpen(false);
      }}
      panelClassName={`${panelClassName} min-w-51 gap-1`}
    >
      {PLAYABLE_DISASTER_CHOICES.map((choice) => (
        <ClassicyMenuItemButton
          key={choice.id}
          disabled={sessionControlsDisabled}
          onClick={() => {
            triggerRouteDisasterControl(session.host, choice.id, choice.label);
            ui.setOpenMenubarSection(null);
          }}
          type="button"
        >
          {choice.label.replace('Trigger ', '')}
        </ClassicyMenuItemButton>
      ))}
    </RuntimeTopMenuShell>
  );
}
