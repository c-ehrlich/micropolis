import { clsx } from 'clsx';
import { type HTMLAttributes, type ReactNode, useId, useState } from 'react';

import { ClassicyButton } from './classicy-button.tsx';
import { ClassicyInput } from './classicy-fields.tsx';

export interface ClassicyDisclosureProps extends HTMLAttributes<HTMLDivElement> {
  readonly children?: ReactNode;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly open?: boolean;
  readonly previewText?: string;
  readonly summary: ReactNode;
}

/**
 * Single-disclosure (accordion-like) section with optional preview text field.
 * Not from Micropolis C: this is browser-only UI chrome for collapsing optional
 * detail regions while keeping a one-line summary visible.
 */
export function ClassicyDisclosure({
  children,
  className,
  defaultOpen = false,
  onOpenChange,
  open,
  previewText,
  summary,
  ...containerProps
}: ClassicyDisclosureProps) {
  const previewFieldId = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const expanded = open ?? internalOpen;
  const hasPreview = previewText !== undefined;

  return (
    <div {...containerProps} className={clsx('grid gap-2', className)}>
      <div
        className={clsx(
          'grid items-center gap-2',
          hasPreview ? 'grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-[auto]',
        )}
      >
        <ClassicyButton
          aria-expanded={expanded}
          className="!m-0 px-3 py-1.5"
          onClick={() => {
            const nextOpen = !expanded;
            if (open === undefined) {
              setInternalOpen(nextOpen);
            }
            onOpenChange?.(nextOpen);
          }}
          type="button"
        >
          <span aria-hidden>{expanded ? '▾' : '▸'}</span> {summary}
        </ClassicyButton>
        {hasPreview ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
            <label className="text-xs text-slate-600" htmlFor={previewFieldId}>
              Preview
            </label>
            <ClassicyInput
              id={previewFieldId}
              readOnly
              value={previewText}
              className="w-full text-sm"
            />
          </div>
        ) : null}
      </div>
      {expanded ? <div className="min-h-0">{children}</div> : null}
    </div>
  );
}
