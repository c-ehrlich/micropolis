import type { HTMLAttributes, ReactNode } from 'react';

import { joinClassTokens } from './class-token-join.ts';

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
    <div {...rowProps} className={joinClassTokens('classicyRuntimeSidebarStat', className)}>
      <div className={joinClassTokens('classicyRuntimeSidebarStatLabel', labelClassName)}>
        {label}
      </div>
      <div className={joinClassTokens('classicyRuntimeSidebarStatValue', valueClassName)}>
        {value}
      </div>
    </div>
  );
}
