// Importing the Platinum package registers it with the Classicy core and injects
// its stylesheet and fonts. The core injects its own base stylesheet on import.
import { PLATINUM_APPEARANCE_PACKAGE_ID } from '@classicy/appearance-platinum';
import { ClassicyAppManagerProvider } from '@classicy/classicy';
import { type ComponentProps, useState } from 'react';

import { ClassicyPortalContainerContext } from './classicy-portal-container.ts';

export interface ClassicyRuntimeProviderProps extends ComponentProps<
  typeof ClassicyAppManagerProvider
> {}

const CLASSICY_LAYER_ORDER_STYLE_ELEMENT_ID = 'classicy-runtime-layer-order';

/**
 * Pins the cascade layer order so Classicy outranks every Tailwind layer.
 * Not from Micropolis C: browser CSS plumbing for the React runtime chrome.
 *
 * Classicy 3 wraps its CSS in `@layer classicy.*` and prepends its `<style>`
 * tags to `<head>`, so its layers are declared first and rank lowest, letting
 * Tailwind's preflight (`button { border: 0; background: transparent }`) erase
 * the Platinum bevels and disabled faces. Layer order is fixed by the first
 * declaration in the document, so this statement is prepended after the
 * Classicy imports above have injected their styles.
 *
 * Classicy goes last (not just above `base`) to keep the precedence the runtime
 * chrome was written against: Classicy 0.x CSS was unlayered, so it beat all
 * non-important utilities, and call sites use `!`-important utilities (`!m-0`,
 * `!min-w-5`, ...) to override it. Important utilities still win here, because
 * for `!important` declarations earlier layers take precedence.
 */
function ensureClassicyCascadeLayerOrder(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(CLASSICY_LAYER_ORDER_STYLE_ELEMENT_ID) !== null) {
    return;
  }
  const styleElement = document.createElement('style');
  styleElement.id = CLASSICY_LAYER_ORDER_STYLE_ELEMENT_ID;
  styleElement.textContent = '@layer theme, base, components, utilities, classicy;';
  document.head.prepend(styleElement);
}

ensureClassicyCascadeLayerOrder();

/**
 * Root provider for Classicy runtime state and styling.
 * Mirrors top-level app manager setup from `ref/micropolis/res/micropolis.tcl`.
 * Parity note: provider wiring is React-managed rather than Tcl command dispatch.
 *
 * Classicy 3 scopes every Appearance Package rule under
 * `.classicyDesktop[data-classicy-appearance=<id>]`, which `ClassicyDesktop`
 * normally renders. The runtime does not use `ClassicyDesktop`, so this renders
 * that scope itself with `display: contents`: descendants match the Platinum
 * selectors and inherit its custom properties, while the core's desktop box
 * rules (full-size, overflow hidden, wallpaper) have no box to apply to.
 */
export function ClassicyRuntimeProvider({
  children,
  ...providerProps
}: ClassicyRuntimeProviderProps) {
  const [scopeElement, setScopeElement] = useState<HTMLDivElement | null>(null);
  return (
    <ClassicyAppManagerProvider {...providerProps}>
      <div
        className="classicyDesktop"
        data-classicy-appearance={PLATINUM_APPEARANCE_PACKAGE_ID}
        ref={setScopeElement}
        style={{ display: 'contents' }}
      >
        <ClassicyPortalContainerContext.Provider value={scopeElement}>
          {children}
        </ClassicyPortalContainerContext.Provider>
      </div>
    </ClassicyAppManagerProvider>
  );
}
