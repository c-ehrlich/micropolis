import { ClassicyMenuItemButton, ClassicyMenuSeparator } from '@city/classicyui';

import type { RuntimeSessionController, RuntimeUiController } from '../runtime-panel-types.ts';
import { RuntimeTopMenuShell } from './menu-shell.tsx';

interface MicropolisMenuProps {
  buttonClassName: string;
  panelClassName: string;
  session: RuntimeSessionController;
  sessionControlsDisabled: boolean;
  ui: RuntimeUiController;
}

/**
 * Micropolis menu with about/new/save/load/scenario entries.
 * Mirrors top-level city lifecycle menu actions in `ref/micropolis/res/whead.tcl`.
 */
export function MicropolisMenu(props: MicropolisMenuProps) {
  const { buttonClassName, panelClassName, session, sessionControlsDisabled, ui } = props;
  return (
    <RuntimeTopMenuShell
      buttonClassName={buttonClassName}
      isOpen={ui.openMenubarSection === 'micropolis'}
      label="Micropolis"
      onToggle={() => {
        ui.setOpenMenubarSection((current) => (current === 'micropolis' ? null : 'micropolis'));
        ui.setIsSpeedMenuOpen(false);
      }}
      panelClassName={`${panelClassName} min-w-51 gap-0.5`}
    >
      <ClassicyMenuItemButton
        onClick={() => {
          ui.setIsBrandDialogOpen(true);
          ui.setOpenMenubarSection(null);
        }}
        type="button"
      >
        About...
      </ClassicyMenuItemButton>
      <ClassicyMenuSeparator />
      <ClassicyMenuItemButton
        disabled={session.controlsDisabled}
        onClick={() => {
          ui.setGameDialog('new');
          ui.setOpenMenubarSection(null);
        }}
        type="button"
      >
        New
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        disabled={sessionControlsDisabled}
        onClick={() => {
          ui.setSaveFileNameDraft(ui.saveFileName);
          ui.setGameDialog('save');
          ui.setOpenMenubarSection(null);
        }}
        type="button"
      >
        Save...
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        disabled={session.controlsDisabled}
        onClick={() => {
          ui.setPendingLoadFile(null);
          ui.setGameDialog('load');
          ui.setOpenMenubarSection(null);
        }}
        type="button"
      >
        Load...
      </ClassicyMenuItemButton>
      <ClassicyMenuItemButton
        disabled={session.controlsDisabled}
        onClick={() => {
          ui.setGameDialog('scenario');
          ui.setOpenMenubarSection(null);
        }}
        type="button"
      >
        Scenario...
      </ClassicyMenuItemButton>
    </RuntimeTopMenuShell>
  );
}
