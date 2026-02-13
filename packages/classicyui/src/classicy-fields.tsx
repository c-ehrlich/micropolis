import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

import { joinClassTokens } from './class-token-join.ts';

export interface ClassicyInputProps extends InputHTMLAttributes<HTMLInputElement> {}

/**
 * Text input primitive styled to match Classicy runtime dialogs.
 * Mirrors form input presentation from `ref/micropolis/res/micropolis.tcl`.
 * Parity note: browser input behavior is preserved; this wrapper only applies classes.
 */
export function ClassicyInput({ className, ...inputProps }: ClassicyInputProps) {
  return (
    <input
      {...inputProps}
      className={joinClassTokens('classicyRuntimeInput', className)}
    />
  );
}

export interface ClassicySelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly children?: ReactNode;
}

/**
 * Select control primitive styled to match Classicy runtime dialogs and settings.
 * Mirrors option menu presentation from `ref/micropolis/res/micropolis.tcl`.
 * Parity note: this does not emulate Tcl menu internals; it uses native HTML select semantics.
 */
export function ClassicySelect({ children, className, ...selectProps }: ClassicySelectProps) {
  return (
    <select
      {...selectProps}
      className={joinClassTokens('classicyRuntimeSelect', className)}
    >
      {children}
    </select>
  );
}

export interface ClassicyRangeProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {}

/**
 * Range slider primitive for budget and tax controls.
 * Mirrors adjustable percentage controls from `ref/micropolis/res/w_budget.tcl`.
 * Parity note: value-to-command mapping is managed by callers; this component only styles the slider.
 */
export function ClassicyRange({ className, ...rangeProps }: ClassicyRangeProps) {
  return (
    <input
      {...rangeProps}
      className={joinClassTokens('classicyRuntimeRange', className)}
      type="range"
    />
  );
}
