import { createContext, useContext } from 'react';

/**
 * Holds the Platinum appearance scope element rendered by `ClassicyRuntimeProvider`.
 * Not from Micropolis C: browser portal plumbing for the React runtime chrome.
 */
export const ClassicyPortalContainerContext = createContext<HTMLElement | null>(null);

/**
 * Returns the element portaled runtime overlays (tooltips, popovers) should mount
 * into so they stay inside the Platinum appearance scope, or `null` before the
 * scope element mounts (callers fall back to `document.body`).
 * Not from Micropolis C: browser portal plumbing for the React runtime chrome.
 */
export function useClassicyPortalContainer(): HTMLElement | null {
  return useContext(ClassicyPortalContainerContext);
}
