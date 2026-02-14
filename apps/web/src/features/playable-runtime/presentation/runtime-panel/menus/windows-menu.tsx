import { ClassicyMenuItemButton } from '@city/classicyui';

import type { RuntimeOpenFloatingWindow, RuntimeUiController } from '../runtime-panel-types.ts';
import { RuntimeTopMenuShell } from './menu-shell.tsx';

interface WindowsMenuProps {
  buttonClassName: string;
  openFloatingWindow: RuntimeOpenFloatingWindow;
  panelClassName: string;
  ui: RuntimeUiController;
}

/**
 * Windows menu for opening floating runtime windows.
 * Mirrors window launch entries in `ref/micropolis/res/whead.tcl`.
 */
export function WindowsMenu(props: WindowsMenuProps) {
  const { buttonClassName, openFloatingWindow, panelClassName, ui } = props;
  return (
    <RuntimeTopMenuShell
      buttonClassName={buttonClassName}
      isOpen={ui.openMenubarSection === 'windows'}
      label="Windows"
      onToggle={() => {
        ui.setOpenMenubarSection((current) => (current === 'windows' ? null : 'windows'));
        ui.setIsSpeedMenuOpen(false);
      }}
      panelClassName={`${panelClassName} min-w-51 gap-0.5`}
    >
      <ClassicyMenuItemButton
        onClick={() => {
          openFloatingWindow('budget');
          ui.setOpenMenubarSection(null);
        }}
        type="button"
      >
        Budget
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        onClick={() => {
          openFloatingWindow('evaluation');
          ui.setOpenMenubarSection(null);
        }}
        type="button"
      >
        Evaluation
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        onClick={() => {
          openFloatingWindow('graph');
          ui.setOpenMenubarSection(null);
        }}
        type="button"
      >
        Graph
      </ClassicyMenuItemButton>
    </RuntimeTopMenuShell>
  );
}
