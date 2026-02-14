import { ClassicyButton, ClassicyMenuPanel } from '@city/classicyui';
import type { ReactNode } from 'react';

import { CLASSICY_MENU_BUTTON_ACTIVE_CLASS } from '../runtime-panel-constants.ts';

export interface RuntimeTopMenuShellProps {
  buttonClassName: string;
  children: ReactNode;
  isOpen: boolean;
  label: string;
  panelClassName: string;
  onToggle: () => void;
}

/**
 * Shared shell for top menubar dropdown menus.
 * Mirrors menu-button and popup ownership in `ref/micropolis/res/whead.tcl`.
 */
export function RuntimeTopMenuShell(props: RuntimeTopMenuShellProps) {
  const { buttonClassName, children, isOpen, label, onToggle, panelClassName } = props;
  return (
    <div className="relative">
      <ClassicyButton
        onClick={onToggle}
        className={`${buttonClassName} ${isOpen ? CLASSICY_MENU_BUTTON_ACTIVE_CLASS : ''}`}
        active={isOpen}
        activeClassName={CLASSICY_MENU_BUTTON_ACTIVE_CLASS}
        type="button"
      >
        {label}
      </ClassicyButton>
      {isOpen ? <ClassicyMenuPanel className={panelClassName}>{children}</ClassicyMenuPanel> : null}
    </div>
  );
}
