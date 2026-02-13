import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { joinClassTokens } from './class-token-join.ts';

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
        className={joinClassTokens('classicyRuntimePanelChrome', className)}
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
    <strong {...titleProps} className={joinClassTokens('classicyRuntimePanelTitle', className)}>
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
    <div {...surfaceProps} className={joinClassTokens('classicyRuntimeMessageFeed', className)}>
      {children}
    </div>
  );
}
