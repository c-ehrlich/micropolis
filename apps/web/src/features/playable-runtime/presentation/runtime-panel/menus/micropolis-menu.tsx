import { ClassicyMenuItemButton, ClassicyMenuSeparator } from '@city/classicyui';

import type { RuntimePanelActions, RuntimeUiController } from '../runtime-panel-types.ts';
import { RuntimeTopMenuShell } from './menu-shell.tsx';

interface MicropolisMenuProps {
  actions: RuntimePanelActions;
  buttonClassName: string;
  controlsDisabled: boolean;
  openMenubarSection: RuntimeUiController['openMenubarSection'];
  panelClassName: string;
  saveFileName: string;
  sessionControlsDisabled: boolean;
}

/**
 * Micropolis menu with about/new/save/load/scenario entries.
 * Mirrors top-level city lifecycle menu actions in `ref/micropolis/res/whead.tcl`.
 */
export function MicropolisMenu(props: MicropolisMenuProps) {
  const {
    actions,
    buttonClassName,
    controlsDisabled,
    openMenubarSection,
    panelClassName,
    saveFileName,
    sessionControlsDisabled,
  } = props;
  return (
    <RuntimeTopMenuShell
      buttonClassName={buttonClassName}
      isOpen={openMenubarSection === 'micropolis'}
      label="Micropolis"
      onToggle={() => {
        actions.toggleMenu('micropolis');
      }}
      panelClassName={`${panelClassName} min-w-51 gap-0.5`}
    >
      <ClassicyMenuItemButton
        onClick={() => {
          actions.openBrandDialog();
        }}
        type="button"
      >
        About...
      </ClassicyMenuItemButton>
      <ClassicyMenuSeparator />
      <ClassicyMenuItemButton
        disabled={controlsDisabled}
        onClick={() => {
          actions.openGameDialog('new');
        }}
        type="button"
      >
        New
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        disabled={sessionControlsDisabled}
        onClick={() => {
          actions.setSaveFileNameDraft(saveFileName);
          actions.openGameDialog('save');
        }}
        type="button"
      >
        Save...
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        disabled={controlsDisabled}
        onClick={() => {
          actions.setPendingLoadFile(null);
          actions.openGameDialog('load');
        }}
        type="button"
      >
        Load...
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        disabled={controlsDisabled}
        onClick={() => {
          actions.openGameDialog('scenario');
        }}
        type="button"
      >
        Scenario...
      </ClassicyMenuItemButton>
    </RuntimeTopMenuShell>
  );
}
