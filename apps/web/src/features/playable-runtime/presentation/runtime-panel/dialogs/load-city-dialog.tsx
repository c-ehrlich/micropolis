import { ClassicyButton, ClassicyPanelTitle } from '@city/classicyui';
import type { RefObject } from 'react';

import type { RuntimeDialogActions, RuntimeUiController } from '../runtime-panel-types.ts';

interface LoadCityDialogProps {
  dialogActions: RuntimeDialogActions;
  controlsDisabled: boolean;
  isLoadingCityFile: boolean;
  loadInputRef: RefObject<HTMLInputElement | null>;
  pendingLoadFile: RuntimeUiController['pendingLoadFile'];
}

/**
 * Load-city dialog for selecting and reading `.cty` files.
 * Mirrors city-load flow in `ref/micropolis/res/micropolis.tcl`.
 * Difference: browser file APIs replace Tcl file dialogs.
 */
export function LoadCityDialog(props: LoadCityDialogProps) {
  const { dialogActions, controlsDisabled, isLoadingCityFile, loadInputRef, pendingLoadFile } =
    props;

  return (
    <section className="grid gap-2.5">
      <ClassicyPanelTitle className="text-sm">Load City</ClassicyPanelTitle>
      <div className="text-xs text-slate-700">
        {pendingLoadFile === null ? 'No file selected.' : `Selected: ${pendingLoadFile.name}`}
      </div>
      <div className="flex flex-wrap gap-2">
        <ClassicyButton
          disabled={controlsDisabled || isLoadingCityFile}
          onClick={() => {
            loadInputRef.current?.click();
          }}
          type="button"
        >
          Choose .cty File...
        </ClassicyButton>
        <ClassicyButton
          disabled={controlsDisabled || pendingLoadFile === null || isLoadingCityFile}
          onClick={async () => {
            if (pendingLoadFile === null || controlsDisabled) {
              return;
            }
            await dialogActions.loadPendingCityFile();
          }}
          type="button"
        >
          {isLoadingCityFile ? 'Loading...' : 'Load'}
        </ClassicyButton>
      </div>
      <div className="flex justify-end">
        <ClassicyButton
          disabled={isLoadingCityFile}
          onClick={() => {
            dialogActions.closeGameDialog();
          }}
          type="button"
        >
          Close
        </ClassicyButton>
      </div>
    </section>
  );
}
