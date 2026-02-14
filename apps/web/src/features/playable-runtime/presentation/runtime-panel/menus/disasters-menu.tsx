import { ClassicyMenuItemButton } from '@city/classicyui';

import { PLAYABLE_DISASTER_CHOICES } from '../../../../../game/runtime/playable-runtime-host.ts';
import type { RuntimeMenuActions, RuntimeUiController } from '../runtime-panel-types.ts';
import { RuntimeTopMenuShell } from './menu-shell.tsx';

interface DisastersMenuProps {
  menuActions: RuntimeMenuActions;
  buttonClassName: string;
  openMenubarSection: RuntimeUiController['openMenubarSection'];
  panelClassName: string;
  sessionControlsDisabled: boolean;
}

/**
 * Disasters menu for manual disaster triggers.
 * Mirrors disaster-menu command entries in `ref/micropolis/res/whead.tcl`.
 */
export function DisastersMenu(props: DisastersMenuProps) {
  const {
    menuActions,
    buttonClassName,
    openMenubarSection,
    panelClassName,
    sessionControlsDisabled,
  } = props;
  return (
    <RuntimeTopMenuShell
      buttonClassName={buttonClassName}
      isOpen={openMenubarSection === 'disasters'}
      label="Disasters"
      onToggle={() => {
        menuActions.toggleMenu('disasters');
      }}
      panelClassName={`${panelClassName} min-w-51 gap-1`}
    >
      {PLAYABLE_DISASTER_CHOICES.map((choice) => (
        <ClassicyMenuItemButton
          key={choice.id}
          disabled={sessionControlsDisabled}
          onClick={() => {
            menuActions.triggerDisaster(choice.id, choice.label);
          }}
          type="button"
        >
          {choice.label.replace('Trigger ', '')}
        </ClassicyMenuItemButton>
      ))}
    </RuntimeTopMenuShell>
  );
}
