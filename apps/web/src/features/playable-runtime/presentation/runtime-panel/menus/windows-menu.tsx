import { ClassicyMenuItemButton } from '@city/classicyui';

import type { RuntimeMenuActions, RuntimeUiController } from '../runtime-panel-types.ts';
import { RuntimeTopMenuShell } from './menu-shell.tsx';

interface WindowsMenuProps {
  menuActions: RuntimeMenuActions;
  buttonClassName: string;
  openMenubarSection: RuntimeUiController['openMenubarSection'];
  panelClassName: string;
}

/**
 * Windows menu for opening floating runtime windows.
 * Mirrors window launch entries in `ref/micropolis/res/whead.tcl`.
 */
export function WindowsMenu(props: WindowsMenuProps) {
  const { menuActions, buttonClassName, openMenubarSection, panelClassName } = props;
  return (
    <RuntimeTopMenuShell
      buttonClassName={buttonClassName}
      isOpen={openMenubarSection === 'windows'}
      label="Windows"
      onToggle={() => {
        menuActions.toggleMenu('windows');
      }}
      panelClassName={`${panelClassName} min-w-51 gap-0.5`}
    >
      <ClassicyMenuItemButton
        onClick={() => {
          menuActions.openFloatingWindow('budget');
          menuActions.closeMenu();
        }}
        type="button"
      >
        Budget
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        onClick={() => {
          menuActions.openFloatingWindow('evaluation');
          menuActions.closeMenu();
        }}
        type="button"
      >
        Evaluation
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        onClick={() => {
          menuActions.openFloatingWindow('graph');
          menuActions.closeMenu();
        }}
        type="button"
      >
        Graph
      </ClassicyMenuItemButton>
    </RuntimeTopMenuShell>
  );
}
