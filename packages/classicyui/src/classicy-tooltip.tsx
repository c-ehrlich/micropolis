import * as Tooltip from '@radix-ui/react-tooltip';
import { clsx } from 'clsx';
import {
  cloneElement,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';

const CLASSICY_TOOLTIP_PANEL_SHADOW =
  '[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07),calc(var(--window-border-size)*2)_calc(var(--window-border-size)*2)_0_0_var(--color-black)]';
const CLASSICY_TOOLTIP_PANEL_BOX_SHADOW =
  'inset calc(var(--window-border-size, 1px) * -1) calc(var(--window-border-size, 1px) * -1) 0 0 var(--color-system-05, #9a9a9a), inset calc(var(--window-border-size, 1px) * 1) calc(var(--window-border-size, 1px) * 1) 0 0 var(--color-system-07, #f5f5f5), calc(var(--window-border-size, 1px) * 2) calc(var(--window-border-size, 1px) * 2) 0 0 var(--color-black, #000)';
const CLASSICY_TOOLTIP_CONTENT_STYLE: CSSProperties = {
  backgroundColor: 'var(--color-system-02, #d6d6d6)',
  borderColor: 'var(--color-black, #000)',
  borderStyle: 'solid',
  borderWidth: 'var(--window-border-size, 1px)',
  boxShadow: CLASSICY_TOOLTIP_PANEL_BOX_SHADOW,
  color: 'var(--color-black, #000)',
  fontFamily: 'var(--ui-font), sans-serif',
  fontSize: '11px',
  lineHeight: 1.3,
  maxWidth: '22rem',
  padding: '0.375rem 0.5rem',
  zIndex: 50,
};
const CLASSICY_TOOLTIP_ROOT_STYLE: CSSProperties = {
  zIndex: 50,
};
const CLASSICY_TOOLTIP_TRIGGER_STYLE: CSSProperties = {
  alignItems: 'center',
  backgroundColor: 'var(--color-system-02, #d6d6d6)',
  border: 'var(--window-border-size, 1px) solid var(--color-black, #000)',
  borderRadius: '9999px',
  boxShadow: CLASSICY_TOOLTIP_PANEL_BOX_SHADOW,
  color: 'var(--color-black, #000)',
  cursor: 'help',
  display: 'inline-flex',
  flexShrink: 0,
  fontFamily: 'var(--ui-font), sans-serif',
  fontSize: '0.8rem',
  fontWeight: 700,
  height: '1.45rem',
  justifyContent: 'center',
  lineHeight: 1,
  margin: 0,
  maxHeight: '1.45rem',
  maxWidth: '1.45rem',
  minHeight: '1.45rem',
  minWidth: '1.45rem',
  padding: 0,
  userSelect: 'none',
  width: '1.45rem',
};

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
  className,
  content,
  contentClassName,
  delayDuration = 150,
  nativeTitle,
  side = 'top',
  sideOffset = 8,
  style,
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
            className={clsx(className)}
            side={side}
            sideOffset={sideOffset}
            style={{
              ...CLASSICY_TOOLTIP_ROOT_STYLE,
              ...style,
            }}
          >
            <div
              className={clsx(CLASSICY_TOOLTIP_PANEL_SHADOW, contentClassName)}
              style={CLASSICY_TOOLTIP_CONTENT_STYLE}
            >
              {content}
            </div>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export interface ClassicyUIGenericTooltipTriggerProps extends HTMLAttributes<HTMLSpanElement> {}

/**
 * Compact shared "?" tooltip trigger for explanatory helper copy.
 * Not from Micropolis C: accessibility and affordance helper for modern web UI.
 */
export function ClassicyUIGenericTooltipTrigger({
  'aria-label': ariaLabel = 'Show help',
  className,
  role = 'img',
  style,
  ...triggerProps
}: ClassicyUIGenericTooltipTriggerProps) {
  return (
    <span
      {...triggerProps}
      aria-label={ariaLabel}
      className={clsx(className)}
      role={role}
      style={{
        ...CLASSICY_TOOLTIP_TRIGGER_STYLE,
        ...style,
      }}
    >
      ?
    </span>
  );
}
