import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface ClassicyToggleGroupOption<Value extends string = string> {
  readonly disabled?: boolean;
  readonly label: ReactNode;
  readonly title?: string;
  readonly value: Value;
}

export interface ClassicyToggleGroupProps<Value extends string = string> {
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly onValueChange: (value: Value) => void;
  readonly optionClassName?: string;
  readonly options: readonly ClassicyToggleGroupOption<Value>[];
  readonly value: Value;
}

/**
 * Segmented single-select toggle group for compact mode pickers.
 * Not from Micropolis C: editor-only interaction wrapper that reuses Classicy button chrome.
 */
export function ClassicyToggleGroup<Value extends string>({
  ariaLabel,
  className,
  onValueChange,
  optionClassName,
  options,
  value,
}: ClassicyToggleGroupProps<Value>) {
  return (
    <div
      aria-label={ariaLabel}
      className={clsx(
        'grid overflow-hidden rounded-[10px] border border-slate-500 bg-slate-100',
        className,
      )}
      role="tablist"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, options.length)}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            aria-selected={active}
            className={clsx(
              'cursor-pointer bg-slate-100 px-[0.55rem] py-[0.35rem] font-semibold text-inherit',
              index < options.length - 1 ? 'border-r border-slate-500' : null,
              active ? 'bg-sky-200' : null,
              optionClassName,
            )}
            disabled={option.disabled}
            key={option.value}
            onClick={() => {
              if (option.disabled || option.value === value) {
                return;
              }
              onValueChange(option.value);
            }}
            role="tab"
            title={option.title}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface ClassicyRadioGroupProps<Value extends string = string> {
  readonly className?: string;
  readonly description?: ReactNode;
  readonly descriptionClassName?: string;
  readonly legend?: ReactNode;
  readonly legendClassName?: string;
  readonly name: string;
  readonly onValueChange: (value: Value) => void;
  readonly options: readonly ClassicyToggleGroupOption<Value>[];
  readonly value: Value;
}

/**
 * Radio-group wrapper with Classicy-styled radio inputs.
 * Not from Micropolis C: browser form grouping helper for editor configuration panels.
 */
export function ClassicyRadioGroup<Value extends string>({
  className,
  description,
  descriptionClassName,
  legend,
  legendClassName,
  name,
  onValueChange,
  options,
  value,
}: ClassicyRadioGroupProps<Value>) {
  return (
    <fieldset className={clsx('m-0 border-0 p-0', className)}>
      {legend === undefined ? null : (
        <legend className={clsx('mb-[0.25rem] px-0 font-semibold', legendClassName)}>
          {legend}
        </legend>
      )}
      <div className="grid gap-[0.35rem]" role="radiogroup">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              className={clsx(
                'inline-flex items-center gap-[0.45rem] text-[var(--color-black)]',
                option.disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
              )}
              key={option.value}
              title={option.title}
            >
              <input
                checked={checked}
                className={clsx(
                  'classicyRadioInput',
                  option.disabled ? 'classicyRadioInputDisabled' : null,
                )}
                disabled={option.disabled}
                name={name}
                onChange={() => {
                  if (option.disabled || checked) {
                    return;
                  }
                  onValueChange(option.value);
                }}
                type="radio"
                value={option.value}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
      {description === undefined ? null : (
        <small
          className={clsx('mt-[0.2rem] block text-[0.82rem] text-slate-700', descriptionClassName)}
        >
          {description}
        </small>
      )}
    </fieldset>
  );
}
