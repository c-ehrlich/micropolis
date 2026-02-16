import { clsx } from 'clsx';
import type { ComponentPropsWithoutRef } from 'react';

/**
 * Shared scenario-editor card container.
 * Not from Micropolis C: editor-only presentation wrapper for route sections.
 */
export function EditorCard({ className, ...props }: ComponentPropsWithoutRef<'section'>) {
  return (
    <section
      className={clsx(
        'rounded-md border border-slate-300 bg-white p-4 [&>h1]:mb-3 [&>h1]:mt-0 [&>p]:mb-4 [&>p]:mt-0',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Shared scenario-editor form wrapper.
 * Not from Micropolis C: editor-only browser form layout helper.
 */
export function EditorForm({ className, ...props }: ComponentPropsWithoutRef<'form'>) {
  return <form className={clsx('mb-4 grid gap-[0.9rem]', className)} {...props} />;
}

/**
 * Shared scenario-editor labeled field wrapper.
 * Not from Micropolis C: editor-only React field layout plus input theming.
 */
export function EditorField({ className, ...props }: ComponentPropsWithoutRef<'label'>) {
  return (
    <label
      className={clsx(
        'grid gap-[0.3rem] [&_input:not([type=checkbox])]:rounded [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-slate-500 [&_input:not([type=checkbox])]:px-[0.55rem] [&_input:not([type=checkbox])]:py-[0.45rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Shared inline field-grid wrapper used for grouped field rows.
 * Not from Micropolis C: editor-only responsive layout helper.
 */
export function EditorFieldInline({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={clsx(
        'grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3 [&_label]:grid [&_label]:gap-[0.3rem]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Shared low-emphasis helper text style.
 * Not from Micropolis C: editor-only authoring guidance text.
 */
export function EditorHelp({ className, ...props }: ComponentPropsWithoutRef<'small'>) {
  return <small className={clsx('text-sm text-slate-600', className)} {...props} />;
}

/**
 * Shared validation/error text style.
 * Not from Micropolis C: editor-only validation feedback UI.
 */
export function EditorError({ className, ...props }: ComponentPropsWithoutRef<'small'>) {
  return <small className={clsx('text-sm text-red-700', className)} {...props} />;
}

/**
 * Shared definition-list layout for editor status summary rows.
 * Not from Micropolis C: editor-only status panel layout.
 */
export function EditorStatsGrid({ className, ...props }: ComponentPropsWithoutRef<'dl'>) {
  return (
    <dl
      className={clsx(
        'm-0 grid grid-cols-[12rem_1fr] gap-x-4 gap-y-2 [&_dt]:text-slate-600',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Shared warning/issues panel container.
 * Not from Micropolis C: editor-only diagnostics presentation.
 */
export function EditorIssuesPanel({ className, ...props }: ComponentPropsWithoutRef<'section'>) {
  return (
    <section
      className={clsx(
        'mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 [&>h2]:mb-2 [&>h2]:mt-0 [&>h2]:text-base [&_ul]:m-0 [&_ul]:pl-5',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Shared JSON preview panel container.
 * Not from Micropolis C: editor-only preview formatting for authoring output.
 */
export function EditorPreviewPanel({ className, ...props }: ComponentPropsWithoutRef<'section'>) {
  return (
    <section
      className={clsx(
        'mt-4 [&>h2]:mb-2 [&>h2]:mt-0 [&>h2]:text-base [&_textarea]:w-full [&_textarea]:resize-y [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-slate-500 [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem] [&_textarea]:font-mono [&_textarea]:text-xs [&_textarea]:leading-[1.4]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Shared neutral editor action button style.
 * Not from Micropolis C: editor-only control styling.
 */
export function EditorButton({ className, ...props }: ComponentPropsWithoutRef<'button'>) {
  return (
    <button
      className={clsx(
        'cursor-pointer rounded border border-slate-500 bg-slate-100 px-[0.6rem] py-[0.35rem] text-inherit disabled:cursor-not-allowed disabled:opacity-65',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Shared secondary action button style (neutral border/background).
 * Not from Micropolis C: editor-only file/open action styling.
 */
export function EditorSecondaryButton({ className, ...props }: ComponentPropsWithoutRef<'button'>) {
  return (
    <button
      className={clsx(
        'cursor-pointer rounded border border-slate-500 bg-slate-100 px-3 py-[0.45rem]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Shared primary action button style (accent border/background).
 * Not from Micropolis C: editor-only export action styling.
 */
export function EditorPrimaryButton({ className, ...props }: ComponentPropsWithoutRef<'button'>) {
  return (
    <button
      className={clsx(
        'cursor-pointer rounded border border-blue-600 bg-sky-100 px-3 py-[0.45rem] text-[#0c2d6b]',
        className,
      )}
      {...props}
    />
  );
}
