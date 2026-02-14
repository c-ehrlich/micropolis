import { ClassicyButton, ClassicyInput, ClassicyPanelTitle } from '@city/classicyui';
import type { FormEvent } from 'react';

import { normalizeCitySaveFileName } from '../../../behavior/runtime-panel-behavior.ts';
import type { RuntimeSessionController, RuntimeUiController } from '../runtime-panel-types.ts';

interface SaveCityDialogProps {
  session: RuntimeSessionController;
  sessionControlsDisabled: boolean;
  ui: RuntimeUiController;
}

/**
 * Save-city dialog for exporting `.cty` files.
 * Mirrors save controls in `ref/micropolis/res/micropolis.tcl`.
 */
export function SaveCityDialog(props: SaveCityDialogProps) {
  const { session, sessionControlsDisabled, ui } = props;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sessionControlsDisabled) {
      return;
    }
    const fileName = normalizeCitySaveFileName(ui.saveFileNameDraft);
    ui.setSaveFileName(fileName);
    session.sendCityIoCommand({
      kind: 'city-io',
      action: 'save-city',
      fileName,
    });
    ui.setGameDialog(null);
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-2.5">
      <ClassicyPanelTitle className="text-sm">Save City</ClassicyPanelTitle>
      <label className="grid gap-1 text-xs">
        File name
        <ClassicyInput
          autoFocus
          className="px-2 py-1"
          disabled={sessionControlsDisabled}
          onChange={(event) => {
            ui.setSaveFileNameDraft(event.target.value);
          }}
          type="text"
          value={ui.saveFileNameDraft}
        />
      </label>
      <div className="flex justify-end gap-2">
        <ClassicyButton
          onClick={() => {
            ui.setGameDialog(null);
          }}
          type="button"
        >
          Cancel
        </ClassicyButton>
        <ClassicyButton disabled={sessionControlsDisabled} type="submit">
          Save
        </ClassicyButton>
      </div>
    </form>
  );
}
