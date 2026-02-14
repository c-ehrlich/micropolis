import { clsx } from 'clsx';
import type {
  HTMLAttributes,
  PointerEvent as ReactPointerEvent,
  PointerEventHandler,
  ReactNode,
} from 'react';

import { ClassicyButton } from './classicy-button.tsx';

const CLASSICY_FLOATING_WINDOW_SHADOW =
  '[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07),calc(var(--window-border-size)*3)_calc(var(--window-border-size)*3)_0_0_rgba(0,0,0,0.3)]';

export interface ClassicyWindowFrameProps extends HTMLAttributes<HTMLElement> {
  readonly bodyClassName?: string;
  readonly children?: ReactNode;
  readonly closeButtonLabel?: string;
  readonly closeButtonTitle?: string;
  readonly headerClassName?: string;
  readonly headerRight?: ReactNode;
  readonly onClose: () => void;
  readonly onHeaderPointerDown?: PointerEventHandler<HTMLElement>;
  readonly windowTitle: ReactNode;
  readonly titleClassName?: string;
}

/**
 * Floating runtime window shell with shared title bar and close control.
 * Mirrors detached budget/evaluation/graph window chrome in `ref/micropolis/res/whead.tcl`.
 * Parity note: this wraps shared frame structure while callers own placement, z-order, and content.
 * The `classicyWindowActive` class is intentionally omitted because upstream CSS
 * pins `z-index` with `!important`, which breaks caller-managed stacking order.
 */
export function ClassicyWindowFrame({
  bodyClassName,
  children,
  className,
  closeButtonLabel = 'x',
  closeButtonTitle = 'Close window',
  headerClassName,
  headerRight,
  onClose,
  onHeaderPointerDown,
  windowTitle,
  titleClassName,
  ...windowProps
}: ClassicyWindowFrameProps) {
  return (
    <section
      {...windowProps}
      className={clsx(
        'classicyWindow pointer-events-auto absolute grid',
        'border-solid [border-width:var(--window-border-size)] border-black bg-[var(--color-system-02)]',
        CLASSICY_FLOATING_WINDOW_SHADOW,
        className,
      )}
    >
      <header
        onPointerDown={onHeaderPointerDown}
        className={clsx(
          'flex cursor-move select-none items-center justify-between gap-2',
          '[border-bottom:var(--window-border-size)_solid_var(--color-black)]',
          '[background:color-mix(in_srgb,var(--color-system-03)_88%,transparent)] px-1.5 py-0.5',
          headerClassName,
        )}
      >
        <strong
          className={clsx(
            '[font-family:var(--ui-font),sans-serif] [font-size:var(--ui-font-size)] leading-none text-left',
            titleClassName,
          )}
        >
          {windowTitle}
        </strong>
        <div className="flex items-center gap-1">
          {headerRight}
          <ClassicyButton
            className="!m-0 min-w-5 !px-1.5 [line-height:1.2]"
            onPointerDown={stopPropagationOnPointerDown}
            onClick={onClose}
            title={closeButtonTitle}
            type="button"
          >
            {closeButtonLabel}
          </ClassicyButton>
        </div>
      </header>
      <div className={clsx('bg-[var(--color-system-02)]', bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * Prevents close-button pointer events from bubbling to drag handlers on window headers.
 * Mirrors drag-stop behavior around close controls in `ref/micropolis/res/whead.tcl`.
 * Parity note: this is browser event plumbing; Tcl used separate widget bindings.
 */
function stopPropagationOnPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
  event.stopPropagation();
}
