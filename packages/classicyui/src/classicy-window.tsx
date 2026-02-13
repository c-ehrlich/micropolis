import type {
  HTMLAttributes,
  PointerEvent as ReactPointerEvent,
  PointerEventHandler,
  ReactNode,
} from 'react';

import { ClassicyButton } from './classicy-button.tsx';
import { joinClassTokens } from './class-token-join.ts';

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
      className={joinClassTokens(
        'classicyWindow classicyWindowActive classicyRuntimeFloatingWindow pointer-events-auto absolute grid',
        className,
      )}
    >
      <header
        onPointerDown={onHeaderPointerDown}
        className={joinClassTokens(
          'classicyRuntimeFloatingWindowTitleBar classicyRuntimeFloatingWindowMenuTitleBar flex cursor-move items-center justify-between gap-2',
          headerClassName,
        )}
      >
        <strong
          className={joinClassTokens('classicyRuntimeFloatingWindowMenuTitle', titleClassName)}
        >
          {windowTitle}
        </strong>
        <div className="flex items-center gap-1">
          {headerRight}
          <ClassicyButton
            className="classicyRuntimeFloatingWindowClose"
            onPointerDown={stopPropagationOnPointerDown}
            onClick={onClose}
            title={closeButtonTitle}
            type="button"
          >
            {closeButtonLabel}
          </ClassicyButton>
        </div>
      </header>
      <div className={joinClassTokens('classicyRuntimeFloatingWindowBody', bodyClassName)}>
        {children}
      </div>
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
