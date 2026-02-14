import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

import { ClassicyButton, type ClassicyButtonProps } from './classicy-button.tsx';

const CLASSICY_MENU_PANEL_SHADOW =
  '[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07),calc(var(--window-border-size)*2)_calc(var(--window-border-size)*2)_0_0_var(--color-black)]';

export interface ClassicyMenuPanelProps extends HTMLAttributes<HTMLElement> {}

/**
 * Dropdown menu panel chrome for runtime menubars.
 * Mirrors menu popup panel framing from `ref/micropolis/res/whead.tcl`.
 * Parity note: this is a React wrapper over CSS classes, not a Tcl widget port.
 */
export function ClassicyMenuPanel({ children, className, ...panelProps }: ClassicyMenuPanelProps) {
  return (
    <section
      {...panelProps}
      className={clsx(
        'border-solid [border-width:var(--window-border-size)] border-black bg-[var(--color-system-02)]',
        CLASSICY_MENU_PANEL_SHADOW,
        className,
      )}
    >
      {children}
    </section>
  );
}

export interface ClassicyMenuItemButtonProps extends ClassicyButtonProps {}

/**
 * Menu item button used in top menubar dropdown sections.
 * Mirrors command entries in `ref/micropolis/res/micropolis.tcl`.
 * Parity note: this keeps styling parity while delegating interaction to React handlers.
 */
export function ClassicyMenuItemButton({
  children,
  className,
  ...buttonProps
}: ClassicyMenuItemButtonProps) {
  return (
    <ClassicyButton
      {...buttonProps}
      className={clsx('!m-[calc(var(--window-padding-size)/2)] text-left', className)}
    >
      {children}
    </ClassicyButton>
  );
}

export interface ClassicyMenuActionButtonProps extends ClassicyButtonProps {}

/**
 * Menu action button for runtime utility commands such as reconnect/resync.
 * Mirrors control action rows from `ref/micropolis/res/micropolis.tcl`.
 * Parity note: this is presentational; command dispatch remains in route logic.
 */
export function ClassicyMenuActionButton({
  children,
  className,
  ...buttonProps
}: ClassicyMenuActionButtonProps) {
  return (
    <ClassicyButton
      {...buttonProps}
      className={clsx('!m-[calc(var(--window-padding-size)/2)]', className)}
    >
      {children}
    </ClassicyButton>
  );
}

export interface ClassicyMenuSeparatorProps extends HTMLAttributes<HTMLDivElement> {}

/**
 * Horizontal separator row within runtime dropdown menus.
 * Mirrors separator lines in menu layouts from `ref/micropolis/res/whead.tcl`.
 * Parity note: this is a static divider and does not map to a Tcl command surface.
 */
export function ClassicyMenuSeparator({
  className,
  ...separatorProps
}: ClassicyMenuSeparatorProps) {
  return <div {...separatorProps} className={clsx('mx-1 h-px bg-black/35', className)} />;
}
