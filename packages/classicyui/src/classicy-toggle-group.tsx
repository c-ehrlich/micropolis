import { clsx } from 'clsx';
import type { ReactNode } from 'react';

import { ClassicyButton } from './classicy-button.tsx';

const CLASSICY_TOGGLE_GROUP_ACTIVE_CLASS = '!text-[var(--color-white)] !bg-[var(--color-theme-04)]';

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
  const selectedValue = (
    options.find((option) => option.value === value && !option.disabled) ??
    options.find((option) => !option.disabled)
  )?.value;

  return (
    <div
      aria-label={ariaLabel}
      className={clsx('inline-flex min-w-0 items-stretch', className)}
      role="radiogroup"
    >
      {options.map((option, index) => {
        const active = option.value === selectedValue;
        const isOnlyOption = options.length === 1;
        return (
          <ClassicyButton
            active={active}
            activeClassName={CLASSICY_TOGGLE_GROUP_ACTIVE_CLASS}
            aria-checked={active}
            className={clsx(
              '!m-0 !min-h-0 min-w-0 flex-1 !px-[0.8rem] !py-[0.45rem] [font-family:var(--header-font),serif] [font-size:calc(var(--header-font-size)*0.86)]',
              !isOnlyOption && index > 0 ? '-ml-[var(--window-border-size)]' : null,
              !isOnlyOption && index === 0 ? '!rounded-r-none' : null,
              !isOnlyOption && index > 0 && index < options.length - 1 ? '!rounded-none' : null,
              !isOnlyOption && index === options.length - 1 ? '!rounded-l-none' : null,
              active ? 'relative z-10' : null,
              optionClassName,
            )}
            disabled={option.disabled}
            key={option.value}
            onClick={() => {
              if (option.disabled || option.value === selectedValue) {
                return;
              }
              onValueChange(option.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                const iterator =
                  event.key === 'Home'
                    ? options.entries()
                    : Array.from(options.entries()).reverse().values();
                for (const [, candidate] of iterator) {
                  if (candidate.disabled || candidate.value === selectedValue) {
                    continue;
                  }
                  onValueChange(candidate.value);
                  break;
                }
                return;
              }

              if (
                event.key !== 'ArrowRight' &&
                event.key !== 'ArrowDown' &&
                event.key !== 'ArrowLeft' &&
                event.key !== 'ArrowUp'
              ) {
                return;
              }

              event.preventDefault();
              if (options.length < 2) {
                return;
              }

              const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
              let cursor = index;
              for (let hop = 0; hop < options.length; hop += 1) {
                cursor = (cursor + direction + options.length) % options.length;
                const candidate = options[cursor];
                if (
                  candidate === undefined ||
                  candidate.disabled ||
                  candidate.value === selectedValue
                ) {
                  continue;
                }
                onValueChange(candidate.value);
                break;
              }
            }}
            role="radio"
            tabIndex={active ? 0 : -1}
            title={option.title}
            type="button"
          >
            {option.label}
          </ClassicyButton>
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
