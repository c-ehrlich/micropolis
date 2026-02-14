import { clsx } from 'clsx';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

const CLASSICY_INSET_BEVEL_SHADOW =
  '[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07)]';

export interface ClassicyPanelChromeProps extends HTMLAttributes<HTMLElement> {
  readonly children?: ReactNode;
}

/**
 * Panel container with Classicy chrome (border, bevel, and background).
 * Mirrors panel framing patterns from `ref/micropolis/res/whead.tcl`.
 * Parity note: this wraps CSS classes only; geometry remains caller-controlled.
 */
export const ClassicyPanelChrome = forwardRef<HTMLElement, ClassicyPanelChromeProps>(
  /**
   * Ref-forwarding implementation for panel chrome sections.
   * Mirrors panel container use-sites from `ref/micropolis/res/whead.tcl`.
   * Parity note: forwards browser element refs for layout observers in React.
   */
  function ClassicyPanelChromeWithRef({ children, className, ...panelProps }, ref) {
    return (
      <section
        {...panelProps}
        ref={ref}
        className={clsx(
          'border-solid [border-width:var(--window-border-size)] border-black',
          '[background:color-mix(in_srgb,var(--color-system-02)_92%,transparent)]',
          CLASSICY_INSET_BEVEL_SHADOW,
          '[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07),calc(var(--window-border-size)*2)_calc(var(--window-border-size)*2)_0_0_rgba(0,0,0,0.45)]',
          className,
        )}
      >
        {children}
      </section>
    );
  },
);

export interface ClassicyPanelTitleProps extends HTMLAttributes<HTMLElement> {
  readonly children?: ReactNode;
}

/**
 * Runtime panel title typography used by dialogs and floating windows.
 * Mirrors title styling intent from `ref/micropolis/res/micropolis.tcl`.
 * Parity note: typography and spacing are CSS-driven, not Tcl-managed fonts.
 */
export function ClassicyPanelTitle({
  children,
  className,
  ...titleProps
}: ClassicyPanelTitleProps) {
  return (
    <strong
      {...titleProps}
      className={clsx(
        '[font-family:var(--header-font),serif] [font-size:var(--header-font-size)]',
        className,
      )}
    >
      {children}
    </strong>
  );
}

export interface ClassicyMessageSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  readonly children?: ReactNode;
}

/**
 * Message/feed surface with inset document styling.
 * Mirrors message/log framing from `ref/micropolis/res/whead.tcl`.
 * Parity note: this is a shared surface style and does not impose list behavior.
 */
export function ClassicyMessageSurface({
  children,
  className,
  ...surfaceProps
}: ClassicyMessageSurfaceProps) {
  return (
    <div
      {...surfaceProps}
      className={clsx(
        'text-[var(--color-black)] border-solid [border-width:var(--window-border-size)] [border-color:var(--color-window-border)]',
        '[background:color-mix(in_srgb,var(--color-system-03)_90%,transparent)]',
        CLASSICY_INSET_BEVEL_SHADOW,
        className,
      )}
    >
      {children}
    </div>
  );
}
