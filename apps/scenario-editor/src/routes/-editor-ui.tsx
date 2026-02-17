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
        'rounded-md border border-solid [border-width:var(--window-border-size)] [border-color:var(--color-window-border)] bg-[var(--color-system-02)] p-4 [box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07)] [&>h1]:mb-3 [&>h1]:mt-0 [&>p]:mb-4 [&>p]:mt-0',
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
        '[&_input:not([type=checkbox]):not([type=radio])]:[font-family:var(--ui-font),sans-serif] [&_input:not([type=checkbox]):not([type=radio])]:[font-size:var(--ui-font-size)] [&_input:not([type=checkbox]):not([type=radio])]:border-solid [&_input:not([type=checkbox]):not([type=radio])]:[border-width:var(--window-border-size)] [&_input:not([type=checkbox]):not([type=radio])]:[border-color:var(--color-window-border)] [&_input:not([type=checkbox]):not([type=radio])]:bg-[var(--color-white)] [&_input:not([type=checkbox]):not([type=radio])]:[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-03)] [&_input:not([type=checkbox]):not([type=radio])]:px-[0.55rem] [&_input:not([type=checkbox]):not([type=radio])]:py-[0.45rem] [&_select]:[font-family:var(--ui-font),sans-serif] [&_select]:[font-size:var(--ui-font-size)] [&_select]:border-solid [&_select]:[border-width:var(--window-border-size)] [&_select]:[border-color:var(--color-window-border)] [&_select]:bg-[var(--color-white)] [&_select]:[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-03)] [&_select]:px-[0.55rem] [&_select]:py-[0.45rem] [&_textarea]:resize-y [&_textarea]:[font-family:var(--ui-font),sans-serif] [&_textarea]:[font-size:var(--ui-font-size)] [&_textarea]:border-solid [&_textarea]:[border-width:var(--window-border-size)] [&_textarea]:[border-color:var(--color-window-border)] [&_textarea]:bg-[var(--color-white)] [&_textarea]:[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-03)] [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem] grid gap-[0.3rem]',
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
  return <small className={clsx('text-sm text-[var(--color-system-07)]', className)} {...props} />;
}

/**
 * Shared validation/error text style.
 * Not from Micropolis C: editor-only validation feedback UI.
 */
export function EditorError({ className, ...props }: ComponentPropsWithoutRef<'small'>) {
  return <small className={clsx('text-sm text-[#8f1d1d]', className)} {...props} />;
}

/**
 * Shared definition-list layout for editor status summary rows.
 * Not from Micropolis C: editor-only status panel layout.
 */
export function EditorStatsGrid({ className, ...props }: ComponentPropsWithoutRef<'dl'>) {
  return (
    <dl
      className={clsx(
        'm-0 grid grid-cols-[12rem_1fr] gap-x-4 gap-y-2 [&_dt]:text-[var(--color-system-07)]',
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
        'mt-4 rounded-md border border-[#8f1d1d]/35 bg-[#ffe8e8] p-3 [&>h2]:mb-2 [&>h2]:mt-0 [&>h2]:text-base [&_ul]:m-0 [&_ul]:pl-5',
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
        '[&_textarea]:w-full [&_textarea]:resize-y [&_textarea]:[font-family:var(--ui-font),sans-serif] [&_textarea]:[font-size:var(--ui-font-size)] [&_textarea]:border-solid [&_textarea]:[border-width:var(--window-border-size)] [&_textarea]:[border-color:var(--color-window-border)] [&_textarea]:bg-[var(--color-white)] [&_textarea]:[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-03)] [&_textarea]:px-[0.55rem] [&_textarea]:py-[0.45rem] [&_textarea]:font-mono [&_textarea]:text-xs [&_textarea]:leading-[1.4] mt-4 [&>h2]:mb-2 [&>h2]:mt-0 [&>h2]:text-base',
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
        'classicyButton !m-0 disabled:cursor-not-allowed disabled:opacity-65',
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
  return <button className={clsx('classicyButton !m-0', className)} {...props} />;
}

/**
 * Shared primary action button style (accent border/background).
 * Not from Micropolis C: editor-only export action styling.
 */
export function EditorPrimaryButton({ className, ...props }: ComponentPropsWithoutRef<'button'>) {
  return (
    <button className={clsx('classicyButton classicyButtonDefault !m-0', className)} {...props} />
  );
}
