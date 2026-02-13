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
    <div {...rowProps} className={clsx('classicyRuntimeSidebarStat', className)}>
      <div className={clsx('classicyRuntimeSidebarStatLabel', labelClassName)}>{label}</div>
      <div className={clsx('classicyRuntimeSidebarStatValue', valueClassName)}>{value}</div>
    </div>
  );
}
