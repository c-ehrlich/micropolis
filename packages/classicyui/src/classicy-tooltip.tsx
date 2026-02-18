import * as Tooltip from '@radix-ui/react-tooltip';
import { clsx } from 'clsx';
import {
  cloneElement,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from 'react';

import { ClassicyButton, type ClassicyButtonProps } from './classicy-button.tsx';

const CLASSICY_TOOLTIP_PANEL_SHADOW =
  '[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07),calc(var(--window-border-size)*2)_calc(var(--window-border-size)*2)_0_0_var(--color-black)]';

export type ClassicyTooltipVariant = 'native' | 'custom';

export interface ClassicyTooltipProps extends Omit<
  ComponentPropsWithoutRef<typeof Tooltip.Content>,
  'children' | 'content'
> {
  readonly children: ReactElement<{ title?: string }>;
  readonly content: ReactNode;
  readonly contentClassName?: string;
  readonly delayDuration?: number;
  readonly nativeTitle?: string;
  readonly variant?: ClassicyTooltipVariant;
}

/**
 * Small contextual help surface for editor/runtime controls.
 * Not from Micropolis C: browser-only helper for concise UI affordance copy.
 */
export function ClassicyTooltip({
  align = 'center',
  children,
  content,
  contentClassName,
  delayDuration = 150,
  nativeTitle,
  side = 'top',
  sideOffset = 8,
  variant = 'native',
}: ClassicyTooltipProps) {
  const resolvedNativeTitle = nativeTitle ?? (typeof content === 'string' ? content : undefined);

  if (variant === 'native') {
    return cloneElement(children, {
      title: resolvedNativeTitle,
    });
  }

  return (
    <Tooltip.Provider delayDuration={delayDuration}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            align={align}
            className={clsx(
              'z-50 max-w-[22rem] border-solid [border-width:var(--window-border-size)] border-black bg-[var(--color-system-02)] px-2 py-1.5 text-[11px] leading-snug text-[var(--color-black)]',
              CLASSICY_TOOLTIP_PANEL_SHADOW,
              contentClassName,
            )}
            side={side}
            sideOffset={sideOffset}
          >
            {content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export interface ClassicyUIGenericTooltipTriggerProps extends Omit<
  ClassicyButtonProps,
  'buttonShape' | 'children'
> {}

/**
 * Compact shared "?" tooltip trigger for explanatory helper copy.
 * Not from Micropolis C: accessibility and affordance helper for modern web UI.
 */
export function ClassicyUIGenericTooltipTrigger({
  'aria-label': ariaLabel = 'Show help',
  className,
  type = 'button',
  ...buttonProps
}: ClassicyUIGenericTooltipTriggerProps) {
  return (
    <ClassicyButton
      {...buttonProps}
      aria-label={ariaLabel}
      buttonShape="square"
      className={clsx(
        '!m-0 inline-flex h-[1.45rem] w-[1.45rem] min-h-[1.45rem] min-w-[1.45rem] items-center justify-center !rounded-full p-0 text-[0.8rem] font-bold leading-none',
        className,
      )}
      type={type}
    >
      ?
    </ClassicyButton>
  );
}
