import { clsx } from 'clsx';
import type { ReactNode } from 'react';

import { ClassicyButton, type ClassicyButtonProps } from './classicy-button.tsx';

export interface ClassicyIconButtonProps extends Omit<ClassicyButtonProps, 'children'> {
  readonly ariaLabel?: string;
  readonly icon?: ReactNode;
  readonly iconClassName?: string;
  readonly srLabel?: string;
}

/**
 * Square icon-first button for compact toolbar and panel actions.
 * Not from Micropolis C: editor-only convenience wrapper over `ClassicyButton`.
 */
export function ClassicyIconButton({
  ariaLabel,
  buttonShape = 'square',
  buttonSize = 'medium',
  className,
  icon = '🛠',
  iconClassName,
  srLabel,
  ...buttonProps
}: ClassicyIconButtonProps) {
  const resolvedAriaLabel = ariaLabel ?? srLabel;
  return (
    <ClassicyButton
      {...buttonProps}
      aria-label={resolvedAriaLabel}
      buttonShape={buttonShape}
      buttonSize={buttonSize}
      className={clsx(
        '!m-0 inline-flex items-center justify-center p-0 text-[1rem] leading-none align-middle',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'inline-flex h-full w-full items-center justify-center text-center leading-none',
          iconClassName,
        )}
      >
        {icon}
      </span>
      {srLabel === undefined ? null : <span className="sr-only">{srLabel}</span>}
    </ClassicyButton>
  );
}
