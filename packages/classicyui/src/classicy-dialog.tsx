import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

const CLASSICY_DIALOG_SHADOW =
  '[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07),calc(var(--window-border-size)*4)_calc(var(--window-border-size)*4)_0_0_rgba(0,0,0,0.35)]';

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
        'pointer-events-auto absolute inset-0 z-[15] flex items-center justify-center bg-black/45',
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
        'border-solid [border-width:var(--window-border-size)] border-black bg-[var(--color-system-02)]',
        CLASSICY_DIALOG_SHADOW,
        className,
      )}
    >
      {children}
    </section>
  );
}
