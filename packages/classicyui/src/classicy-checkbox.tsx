import { clsx } from 'clsx';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

export interface ClassicyCheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'size'
> {
  readonly label?: ReactNode;
  readonly mixed?: boolean;
  readonly wrapperClassName?: string;
}

/**
 * Checkbox primitive styled to match Classicy runtime controls.
 * Not from Micropolis C: this is a React form-control wrapper for editor UIs.
 * Parity note: checked/mixed state stays browser-native and controlled by props.
 */
export function ClassicyCheckbox({
  checked,
  className,
  disabled,
  id,
  label,
  mixed = false,
  onChange,
  wrapperClassName,
  ...inputProps
}: ClassicyCheckboxProps) {
  const generatedId = useId();
  const resolvedId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current === null) {
      return;
    }
    inputRef.current.indeterminate = mixed;
  }, [mixed]);

  return (
    <label
      className={clsx(
        'inline-flex items-center gap-[0.45rem] text-[var(--color-black)]',
        disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
        wrapperClassName,
      )}
      htmlFor={resolvedId}
    >
      <input
        {...inputProps}
        checked={checked}
        className={clsx('ClassicyCheckbox', mixed ? 'ClassicyCheckboxMixed' : null, className)}
        disabled={disabled}
        id={resolvedId}
        onChange={onChange}
        ref={inputRef}
        type="checkbox"
      />
      {label === undefined ? null : <span>{label}</span>}
    </label>
  );
}

export interface ClassicyCheckboxFieldProps extends ClassicyCheckboxProps {
  readonly detail?: ReactNode;
  readonly detailClassName?: string;
  readonly fieldClassName?: string;
}

/**
 * Labeled checkbox field with optional helper/detail text.
 * Not from Micropolis C: editor-side layout helper for compact form rows.
 */
export function ClassicyCheckboxField({
  detail,
  detailClassName,
  fieldClassName,
  ...checkboxProps
}: ClassicyCheckboxFieldProps) {
  return (
    <div className={clsx('grid gap-[0.2rem]', fieldClassName)}>
      <ClassicyCheckbox {...checkboxProps} />
      {detail === undefined ? null : (
        <small className={clsx('text-[0.82rem] text-slate-700', detailClassName)}>{detail}</small>
      )}
    </div>
  );
}
