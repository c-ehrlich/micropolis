import {
  ClassicyButton,
  ClassicyDialogBackdrop,
  ClassicyDialogPanel,
  ClassicyPanelTitle,
} from '@city/classicyui';

import type { RuntimeUiController } from '../runtime-panel-types.ts';

interface RuntimeBrandDialogProps {
  ui: RuntimeUiController;
}

/**
 * Brand/about modal for the route shell.
 * No direct Micropolis C equivalent; this is web-only metadata and credits UI.
 */
export function RuntimeBrandDialog(props: RuntimeBrandDialogProps) {
  if (!props.ui.isBrandDialogOpen) {
    return null;
  }

  return (
    <ClassicyDialogBackdrop
      onClick={() => {
        props.ui.setIsBrandDialogOpen(false);
      }}
    >
      <ClassicyDialogPanel
        modalWindow
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="grid min-w-70 w-[min(420px,calc(100vw-24px))] !p-2 gap-2.5"
        style={{ position: 'relative' }}
      >
        <ClassicyPanelTitle className="text-sm">Micropolis</ClassicyPanelTitle>
        <div className="grid gap-1 text-sm">
          <p>
            Developed by Christopher Ehrlich using gpt 5.3-codex:{' '}
            <a
              className="underline"
              href="https://github.com/c-ehrlich/micropolis"
              rel="noreferrer"
              target="_blank"
            >
              github.com/c-ehrlich/micropolis
            </a>
          </p>
          <p>
            Based on the TCL/X11 version of Micropolis (open-source SimCity):{' '}
            <a
              className="underline"
              href="https://github.com/SimHacker/micropolis"
              rel="noreferrer"
              target="_blank"
            >
              github.com/SimHacker/micropolis
            </a>
          </p>
          <p>
            Twitter:{' '}
            <a
              className="underline"
              href="https://x.com/ccccjjjjeeee"
              rel="noreferrer"
              target="_blank"
            >
              x.com/ccccjjjjeeee
            </a>
          </p>
        </div>
        <div className="flex justify-end">
          <ClassicyButton
            onClick={() => {
              props.ui.setIsBrandDialogOpen(false);
            }}
            type="button"
          >
            Dismiss
          </ClassicyButton>
        </div>
      </ClassicyDialogPanel>
    </ClassicyDialogBackdrop>
  );
}
