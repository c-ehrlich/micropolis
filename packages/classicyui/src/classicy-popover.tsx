import { clsx } from 'clsx';
import {
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { ClassicyMenuPanel, type ClassicyMenuPanelProps } from './classicy-menu.tsx';

export type ClassicyPopoverPlacement =
  | 'bottom-start'
  | 'bottom-end'
  | 'top-start'
  | 'top-end'
  | 'right-start'
  | 'left-start';

export interface ClassicyPopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  readonly anchorPoint?: { x: number; y: number };
  readonly anchorRef?: { current: HTMLElement | null };
  readonly children?: ReactNode;
  readonly offsetPx?: number;
  readonly onRequestClose?: () => void;
  readonly open: boolean;
  readonly placement?: ClassicyPopoverPlacement;
  readonly viewportMarginPx?: number;
}

interface ClassicyPopoverPosition {
  readonly ready: boolean;
  readonly x: number;
  readonly y: number;
}

const CLASSICY_POPOVER_DEFAULT_POSITION: ClassicyPopoverPosition = {
  ready: false,
  x: 0,
  y: 0,
};

/**
 * Positioned floating layer anchored to a point or element.
 * Not from Micropolis C: browser layout utility for editor context menus and popovers.
 */
export function ClassicyPopover({
  anchorPoint,
  anchorRef,
  children,
  className,
  offsetPx = 6,
  onRequestClose,
  open,
  placement = 'bottom-start',
  style,
  viewportMarginPx = 8,
  ...panelProps
}: ClassicyPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<ClassicyPopoverPosition>(
    CLASSICY_POPOVER_DEFAULT_POSITION,
  );

  const resolvePosition = useCallback(() => {
    if (!open || typeof window === 'undefined') {
      return;
    }
    const panelElement = panelRef.current;
    if (panelElement === null) {
      return;
    }
    const anchorRect = resolvePopoverAnchorRect(anchorPoint, anchorRef?.current);
    if (anchorRect === null) {
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();
    const resolvedPoint = resolvePopoverPlacementPoint(anchorRect, panelRect, placement, offsetPx);
    const clampedPoint = clampPopoverPointToViewport(
      resolvedPoint,
      panelRect,
      { width: window.innerWidth, height: window.innerHeight },
      viewportMarginPx,
    );

    setPosition({
      ready: true,
      x: clampedPoint.x,
      y: clampedPoint.y,
    });
  }, [anchorPoint, anchorRef, offsetPx, open, placement, viewportMarginPx]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    resolvePosition();
  }, [open, resolvePosition]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') {
      return;
    }
    const onViewportUpdate = (): void => {
      resolvePosition();
    };
    window.addEventListener('resize', onViewportUpdate);
    window.addEventListener('scroll', onViewportUpdate, true);
    return () => {
      window.removeEventListener('resize', onViewportUpdate);
      window.removeEventListener('scroll', onViewportUpdate, true);
    };
  }, [open, resolvePosition]);

  useEffect(() => {
    if (!open || onRequestClose === undefined || typeof window === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        onRequestClose();
        return;
      }
      if (panelRef.current?.contains(target)) {
        return;
      }
      if (anchorRef?.current?.contains(target)) {
        return;
      }
      onRequestClose();
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onRequestClose();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [anchorRef, onRequestClose, open]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  const resolvedStyle: CSSProperties = {
    ...style,
    left: `${position.x}px`,
    top: `${position.y}px`,
    visibility: position.ready ? 'visible' : 'hidden',
  };

  return createPortal(
    <div
      {...panelProps}
      className={clsx('fixed z-50', className)}
      ref={panelRef}
      style={resolvedStyle}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface ClassicyPopoverMenuProps
  extends Omit<ClassicyPopoverProps, 'children'>, Pick<ClassicyMenuPanelProps, 'className'> {
  readonly children?: ReactNode;
}

/**
 * Popover surface that renders Classicy menu-panel chrome.
 * Not from Micropolis C: React composition helper for menu-like overlays.
 */
export function ClassicyPopoverMenu({
  children,
  className,
  ...popoverProps
}: ClassicyPopoverMenuProps) {
  return (
    <ClassicyPopover {...popoverProps}>
      <ClassicyMenuPanel className={className}>{children}</ClassicyMenuPanel>
    </ClassicyPopover>
  );
}

/**
 * Resolve one anchor rectangle from either viewport point or element ref.
 * Not from Micropolis C: browser geometry helper for overlay positioning.
 */
function resolvePopoverAnchorRect(
  anchorPoint: ClassicyPopoverProps['anchorPoint'],
  anchorElement: HTMLElement | null | undefined,
): DOMRect | null {
  if (anchorPoint !== undefined) {
    return new DOMRect(anchorPoint.x, anchorPoint.y, 0, 0);
  }
  if (anchorElement === null || anchorElement === undefined) {
    return null;
  }
  return anchorElement.getBoundingClientRect();
}

/**
 * Resolve one target popover point for a placement strategy.
 * Not from Micropolis C: browser geometry helper for popover anchoring.
 */
function resolvePopoverPlacementPoint(
  anchorRect: DOMRect,
  panelRect: DOMRect,
  placement: ClassicyPopoverPlacement,
  offsetPx: number,
): { x: number; y: number } {
  if (placement === 'bottom-start') {
    return {
      x: anchorRect.left,
      y: anchorRect.bottom + offsetPx,
    };
  }
  if (placement === 'bottom-end') {
    return {
      x: anchorRect.right - panelRect.width,
      y: anchorRect.bottom + offsetPx,
    };
  }
  if (placement === 'top-start') {
    return {
      x: anchorRect.left,
      y: anchorRect.top - panelRect.height - offsetPx,
    };
  }
  if (placement === 'top-end') {
    return {
      x: anchorRect.right - panelRect.width,
      y: anchorRect.top - panelRect.height - offsetPx,
    };
  }
  if (placement === 'left-start') {
    return {
      x: anchorRect.left - panelRect.width - offsetPx,
      y: anchorRect.top,
    };
  }
  return {
    x: anchorRect.right + offsetPx,
    y: anchorRect.top,
  };
}

/**
 * Clamp one popover point so the full panel stays visible in viewport bounds.
 * Not from Micropolis C: browser geometry safety helper.
 */
function clampPopoverPointToViewport(
  point: { x: number; y: number },
  panelRect: DOMRect,
  viewport: { width: number; height: number },
  marginPx: number,
): { x: number; y: number } {
  const maxX = Math.max(marginPx, viewport.width - panelRect.width - marginPx);
  const maxY = Math.max(marginPx, viewport.height - panelRect.height - marginPx);
  return {
    x: Math.min(Math.max(point.x, marginPx), maxX),
    y: Math.min(Math.max(point.y, marginPx), maxY),
  };
}
