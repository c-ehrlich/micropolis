import { clsx } from 'clsx';
import type { ComponentPropsWithoutRef } from 'react';

export interface ClassicyFieldProps extends ComponentPropsWithoutRef<'label'> {}

/**
 * Labeled form-field wrapper with consistent spacing and nested control styling.
 * Not from Micropolis C: editor-side React layout helper for authoring forms.
 */
export function ClassicyField({ className, ...props }: ClassicyFieldProps) {
  return (
    <label
      className={clsx(
        'grid gap-[0.3rem] [&_input:not([type=checkbox]):not([type=radio])]:rounded [&_input:not([type=checkbox]):not([type=radio])]:border [&_input:not([type=checkbox]):not([type=radio])]:border-slate-500 [&_input:not([type=checkbox]):not([type=radio])]:px-[0.55rem] [&_input:not([type=checkbox]):not([type=radio])]:py-[0.45rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem]',
        className,
      )}
      {...props}
    />
  );
}

export interface ClassicyFieldHintProps extends ComponentPropsWithoutRef<'small'> {}

/**
 * Low-emphasis helper text for form guidance.
 * Not from Micropolis C: editor-only text treatment.
 */
export function ClassicyFieldHint({ className, ...props }: ClassicyFieldHintProps) {
  return <small className={clsx('text-sm text-slate-600', className)} {...props} />;
}
