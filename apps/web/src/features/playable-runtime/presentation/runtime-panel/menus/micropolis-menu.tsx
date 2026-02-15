import { ClassicyMenuItemButton, ClassicyMenuSeparator } from '@city/classicyui';

import type { RuntimeMenuActions, RuntimeUiController } from '../runtime-panel-types.ts';
import { RuntimeTopMenuShell } from './menu-shell.tsx';

interface MicropolisMenuProps {
  menuActions: RuntimeMenuActions;
  buttonClassName: string;
  controlsDisabled: boolean;
  openMenubarSection: RuntimeUiController['openMenubarSection'];
  panelClassName: string;
  saveFileName: string;
  sessionControlsDisabled: boolean;
}

/**
 * Micropolis menu with about/new/save/load/scenario actions.
 * Mirrors top-level city lifecycle menu actions in `ref/micropolis/res/whead.tcl`.
 */
export function MicropolisMenu(props: MicropolisMenuProps) {
  const {
    menuActions,
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
        menuActions.toggleMenu('micropolis');
      }}
      panelClassName={`${panelClassName} min-w-51 gap-0.5`}
    >
      <ClassicyMenuItemButton
        onClick={() => {
          menuActions.openBrandDialog();
        }}
        type="button"
      >
        About...
      </ClassicyMenuItemButton>
      <ClassicyMenuSeparator />
      <ClassicyMenuItemButton
        disabled={controlsDisabled}
        onClick={() => {
          menuActions.openGameDialog('new');
        }}
        type="button"
      >
        New
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        disabled={sessionControlsDisabled}
        onClick={() => {
          menuActions.setSaveFileNameDraft(saveFileName);
          menuActions.openGameDialog('save');
        }}
        type="button"
      >
        Save...
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        disabled={controlsDisabled}
        onClick={() => {
          menuActions.setPendingLoadFile(null);
          menuActions.openGameDialog('load');
        }}
        type="button"
      >
        Load...
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        disabled={controlsDisabled}
        onClick={() => {
          menuActions.openScenarioFilePicker();
        }}
        type="button"
      >
        Load Scenario...
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        disabled={controlsDisabled}
        onClick={() => {
          menuActions.openGameDialog('scenario');
        }}
        type="button"
      >
        Scenario...
      </ClassicyMenuItemButton>
    </RuntimeTopMenuShell>
  );
}
