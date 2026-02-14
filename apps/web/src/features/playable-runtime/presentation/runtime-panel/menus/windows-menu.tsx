import { ClassicyMenuItemButton } from '@city/classicyui';

import type { RuntimePanelActions, RuntimeUiController } from '../runtime-panel-types.ts';
import { RuntimeTopMenuShell } from './menu-shell.tsx';

interface WindowsMenuProps {
  actions: RuntimePanelActions;
  buttonClassName: string;
  openMenubarSection: RuntimeUiController['openMenubarSection'];
  panelClassName: string;
}

/**
 * Windows menu for opening floating runtime windows.
 * Mirrors window launch entries in `ref/micropolis/res/whead.tcl`.
 */
export function WindowsMenu(props: WindowsMenuProps) {
  const { actions, buttonClassName, openMenubarSection, panelClassName } = props;
  return (
    <RuntimeTopMenuShell
      buttonClassName={buttonClassName}
      isOpen={openMenubarSection === 'windows'}
      label="Windows"
      onToggle={() => {
        actions.toggleMenu('windows');
      }}
      panelClassName={`${panelClassName} min-w-51 gap-0.5`}
    >
      <ClassicyMenuItemButton
        onClick={() => {
          actions.openFloatingWindow('budget');
          actions.closeMenu();
        }}
        type="button"
      >
        Budget
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        onClick={() => {
          actions.openFloatingWindow('evaluation');
          actions.closeMenu();
        }}
        type="button"
      >
        Evaluation
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        onClick={() => {
          actions.openFloatingWindow('graph');
          actions.closeMenu();
        }}
        type="button"
      >
        Graph
      </ClassicyMenuItemButton>
    </RuntimeTopMenuShell>
  );
}
