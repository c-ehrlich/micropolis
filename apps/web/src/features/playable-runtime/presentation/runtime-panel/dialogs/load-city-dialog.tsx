import { ClassicyButton, ClassicyPanelTitle } from '@city/classicyui';
import type { RefObject } from 'react';

import type { RuntimeSessionController, RuntimeUiController } from '../runtime-panel-types.ts';

interface LoadCityDialogProps {
  loadInputRef: RefObject<HTMLInputElement | null>;
  session: RuntimeSessionController;
  ui: RuntimeUiController;
}

/**
 * Load-city dialog for selecting and reading `.cty` files.
 * Mirrors city-load flow in `ref/micropolis/res/micropolis.tcl`.
 * Difference: browser file APIs replace Tcl file dialogs.
 */
export function LoadCityDialog(props: LoadCityDialogProps) {
  const { loadInputRef, session, ui } = props;

  return (
    <section className="grid gap-2.5">
      <ClassicyPanelTitle className="text-sm">Load City</ClassicyPanelTitle>
      <div className="text-xs text-slate-700">
        {ui.pendingLoadFile === null ? 'No file selected.' : `Selected: ${ui.pendingLoadFile.name}`}
      </div>
      <div className="flex flex-wrap gap-2">
        <ClassicyButton
          disabled={session.controlsDisabled || ui.isLoadingCityFile}
          onClick={() => {
            loadInputRef.current?.click();
          }}
          type="button"
        >
          Choose .cty File...
        </ClassicyButton>
        <ClassicyButton
          disabled={session.controlsDisabled || ui.pendingLoadFile === null || ui.isLoadingCityFile}
          onClick={async () => {
            if (ui.pendingLoadFile === null || session.controlsDisabled) {
              return;
            }

            ui.setIsLoadingCityFile(true);
            try {
              const cityBytes = new Uint8Array(await ui.pendingLoadFile.arrayBuffer());
              ui.setHasStartedPlayableSession(true);
              ui.setSaveFileName(ui.pendingLoadFile.name);
              session.sendCityIoCommand({
                kind: 'city-io',
                action: 'load-city',
                fileName: ui.pendingLoadFile.name,
                cityBytes,
              });
              ui.setCityIoError('');
              ui.setPendingLoadFile(null);
              ui.setGameDialog(null);
            } catch {
              ui.setCityIoError('Failed to read selected city file.');
            } finally {
              ui.setIsLoadingCityFile(false);
            }
          }}
          type="button"
        >
          {ui.isLoadingCityFile ? 'Loading...' : 'Load'}
        </ClassicyButton>
      </div>
      <div className="flex justify-end">
        <ClassicyButton
          disabled={ui.isLoadingCityFile}
          onClick={() => {
            ui.setGameDialog(null);
          }}
          type="button"
        >
          Close
        </ClassicyButton>
      </div>
    </section>
  );
}
