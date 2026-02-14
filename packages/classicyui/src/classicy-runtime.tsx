import { ClassicyAppManagerProvider } from 'classicy';
import classicyCssText from 'classicy/dist/classicy.css?raw';
import type { ComponentProps } from 'react';

const CLASSICY_STYLE_ELEMENT_ID = 'classicy-runtime-style-sheet';

export interface ClassicyRuntimeProviderProps extends ComponentProps<
  typeof ClassicyAppManagerProvider
> {}

/**
 * Ensures the Classicy stylesheet is present once for runtime chrome rendering.
 * Mirrors global widget style loading used by the Micropolis Tcl UI bootstrap in
 * `ref/micropolis/res/micropolis.tcl`.
 * Parity note: this injects CSS text into the browser document instead of sourcing Tcl files.
 */
function ensureClassicyRuntimeStyles(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(CLASSICY_STYLE_ELEMENT_ID) !== null) {
    return;
  }
  const styleElement = document.createElement('style');
  styleElement.id = CLASSICY_STYLE_ELEMENT_ID;
  styleElement.textContent = classicyCssText;
  document.head.append(styleElement);
}

/**
 * Root provider for Classicy runtime state and styling.
 * Mirrors top-level app manager setup from `ref/micropolis/res/micropolis.tcl`.
 * Parity note: provider wiring is React-managed rather than Tcl command dispatch.
 */
export function ClassicyRuntimeProvider({
  children,
  ...providerProps
}: ClassicyRuntimeProviderProps) {
  ensureClassicyRuntimeStyles();
  return <ClassicyAppManagerProvider {...providerProps}>{children}</ClassicyAppManagerProvider>;
}
