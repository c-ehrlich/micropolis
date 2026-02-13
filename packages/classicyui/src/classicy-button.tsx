import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { joinClassTokens } from './class-token-join.ts';

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
 * Classicy CSS contract classes into a typed React primitive.
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
      className={joinClassTokens(
        'classicyButton',
        isDefault ? 'classicyButtonDefault' : null,
        buttonShape === 'square' ? 'classicyButtonShapeSquare' : null,
        buttonSize === 'small' ? 'classicyButtonSmall' : null,
        active ? activeClassName : null,
        className,
      )}
      type={type}
    >
      {children}
    </button>
  );
}
