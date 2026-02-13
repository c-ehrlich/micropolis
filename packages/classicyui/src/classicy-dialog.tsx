import type { HTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';

export interface ClassicyDialogBackdropProps extends HTMLAttributes<HTMLDivElement> {
  readonly children?: ReactNode;
}

/**
 * Modal backdrop layer for runtime dialogs.
 * Mirrors modal shading and focus isolation from `ref/micropolis/res/micropolis.tcl`.
 * Parity note: open/close state is external; this component only renders backdrop structure.
 */
export function ClassicyDialogBackdrop({
  children,
  className,
  ...backdropProps
}: ClassicyDialogBackdropProps) {
  return (
    <div
      {...backdropProps}
      className={clsx(
        'classicyRuntimeDialogBackdrop pointer-events-auto absolute inset-0 z-15 flex items-center justify-center',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface ClassicyDialogPanelProps extends HTMLAttributes<HTMLElement> {
  readonly children?: ReactNode;
  readonly modalWindow?: boolean;
}

/**
 * Dialog surface panel for runtime modals.
 * Mirrors centered dialog surfaces in `ref/micropolis/res/micropolis.tcl`.
 * Parity note: this wrapper can optionally include Classicy window modal classes.
 */
export function ClassicyDialogPanel({
  children,
  className,
  modalWindow = false,
  ...panelProps
}: ClassicyDialogPanelProps) {
  return (
    <section
      {...panelProps}
      className={clsx(
        modalWindow ? 'classicyWindow classicyWindowActive classicyWindowModal' : null,
        'classicyRuntimeDialog',
        className,
      )}
    >
      {children}
    </section>
  );
}
