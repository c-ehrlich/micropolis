import type { HTMLAttributes } from 'react';
import { clsx } from 'clsx';

import { ClassicyButton, type ClassicyButtonProps } from './classicy-button.tsx';

export interface ClassicyMenuPanelProps extends HTMLAttributes<HTMLElement> {}

/**
 * Dropdown menu panel chrome for runtime menubars.
 * Mirrors menu popup panel framing from `ref/micropolis/res/whead.tcl`.
 * Parity note: this is a React wrapper over CSS classes, not a Tcl widget port.
 */
export function ClassicyMenuPanel({ children, className, ...panelProps }: ClassicyMenuPanelProps) {
  return (
    <section {...panelProps} className={clsx('classicyRuntimeMenuPanel', className)}>
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
      className={clsx('classicyRuntimeMenuItem text-left', className)}
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
    <ClassicyButton {...buttonProps} className={clsx('classicyRuntimeRuntimeAction', className)}>
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
