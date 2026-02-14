import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export interface ClassicyStatRowProps extends HTMLAttributes<HTMLDivElement> {
  readonly label: ReactNode;
  readonly labelClassName?: string;
  readonly value: ReactNode;
  readonly valueClassName?: string;
}

/**
 * Sidebar stat row with standard label/value layout.
 * Mirrors HUD stat rows from `ref/micropolis/res/whead.tcl`.
 * Parity note: caller supplies formatted values; this component only renders layout/chrome.
 */
export function ClassicyStatRow({
  className,
  label,
  labelClassName,
  value,
  valueClassName,
  ...rowProps
}: ClassicyStatRowProps) {
  return (
    <div
      {...rowProps}
      className={clsx(
        '[--runtime-sidebar-stat-value-height:22px] grid min-w-0 content-start grid-rows-[auto_var(--runtime-sidebar-stat-value-height)] gap-y-px',
        className,
      )}
    >
      <div
        className={clsx(
          '[font-family:var(--ui-font),sans-serif] [font-size:var(--ui-font-size)] leading-none p-0 text-left',
          labelClassName,
        )}
      >
        {label}
      </div>
      <div
        className={clsx(
          'flex min-w-0 h-(--runtime-sidebar-stat-value-height) items-center justify-end whitespace-nowrap overflow-hidden text-ellipsis px-1 leading-none',
          'border-solid [border-width:var(--window-border-size)] [border-color:var(--color-window-border)] [background:color-mix(in_srgb,var(--color-system-03)_90%,transparent)]',
          '[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07)]',
          valueClassName,
        )}
      >
        {value}
      </div>
    </div>
  );
}
