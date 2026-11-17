import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ClassicyButtonShape = 'rectangle' | 'square';
type ClassicyButtonSize = 'medium' | 'small';

export interface ClassicyButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  readonly active?: boolean;
  readonly activeClassName?: string;
  readonly buttonShape?: ClassicyButtonShape;
  readonly buttonSize?: ClassicyButtonSize;
  readonly children?: ReactNode;
  readonly isDefault?: boolean;
}

/**
 * Reusable runtime command button for gameplay controls and menus.
 * Mirrors the clickable command widgets from `ref/micropolis/res/micropolis.tcl`
 * and `ref/micropolis/res/whead.tcl`.
 * Parity note: this is not a 1:1 port of Tcl widget internals; it composes
 * Classicy CSS contract classes into a typed React primitive, applying the same
 * default (`md`) padding and margin variant classes as Classicy 3's own
 * `ClassicyButton` (padding is skipped for square buttons, as upstream does).
 */
export function ClassicyButton({
  active = false,
  activeClassName,
  buttonShape = 'rectangle',
  buttonSize = 'medium',
  children,
  className,
  isDefault = false,
  type = 'button',
  ...buttonProps
}: ClassicyButtonProps) {
  return (
    <button
      {...buttonProps}
      className={clsx(
        'classicyButton',
        // Classicy 3 marks the default button with a bare `default` class (the
        // ring is drawn by the Platinum appearance package).
        isDefault ? 'default' : null,
        buttonShape === 'square' ? 'classicyButtonShapeSquare' : null,
        buttonSize === 'small' ? 'classicyButtonSmall' : null,
        buttonShape === 'square' ? null : 'classicyButtonPaddingMd',
        'classicyButtonMarginMd',
        active ? activeClassName : null,
        className,
      )}
      type={type}
    >
      {children}
    </button>
  );
}
