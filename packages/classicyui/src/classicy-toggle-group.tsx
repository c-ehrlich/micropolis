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
  const selectedValue = (
    options.find((option) => option.value === value && !option.disabled) ??
    options.find((option) => !option.disabled)
  )?.value;

  return (
    <div
      aria-label={ariaLabel}
      className={clsx(
        'inline-grid min-w-0 overflow-hidden rounded-[0.95rem] border-solid [border-width:var(--window-border-size)] [border-color:var(--color-window-border)] [background:color-mix(in_srgb,var(--color-system-03)_92%,transparent)]',
        '[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07)]',
        className,
      )}
      role="radiogroup"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, options.length)}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => {
        const active = option.value === selectedValue;
        return (
          <button
            aria-checked={active}
            className={clsx(
              'relative cursor-pointer border-0 bg-transparent px-[0.9rem] py-[0.48rem] font-semibold leading-none [font-family:var(--header-font),serif] [font-size:calc(var(--header-font-size)*0.86)] text-[var(--color-black)] disabled:cursor-not-allowed disabled:text-[var(--color-system-07)]',
              'focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-theme-07)]',
              index < options.length - 1
                ? 'after:pointer-events-none after:absolute after:bottom-[0.3rem] after:right-0 after:top-[0.3rem] after:w-[var(--window-border-size)] after:bg-[color-mix(in_srgb,var(--color-black)_28%,transparent)]'
                : null,
              active
                ? clsx(
                    'z-10 [background:color-mix(in_srgb,var(--color-white)_82%,var(--color-system-01))]',
                    '[box-shadow:inset_0_0_0_2px_var(--color-theme-07)]',
                    index === 0 ? 'rounded-l-[0.85rem]' : null,
                    index === options.length - 1 ? 'rounded-r-[0.85rem]' : null,
                  )
                : null,
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
