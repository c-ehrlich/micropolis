import { ClassicyButton, ClassicyInput, ClassicyPanelTitle } from '@city/classicyui';
import type { FormEvent } from 'react';

import type { RuntimeDialogActions, RuntimeUiController } from '../runtime-panel-types.ts';

interface SaveCityDialogProps {
  dialogActions: RuntimeDialogActions;
  saveFileNameDraft: RuntimeUiController['saveFileNameDraft'];
  sessionControlsDisabled: boolean;
}

/**
 * Save-city dialog for exporting `.cty` files.
 * Mirrors save controls in `ref/micropolis/res/micropolis.tcl`.
 */
export function SaveCityDialog(props: SaveCityDialogProps) {
  const { dialogActions, saveFileNameDraft, sessionControlsDisabled } = props;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sessionControlsDisabled) {
      return;
    }
    dialogActions.saveCityFromDraft();
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
            dialogActions.setSaveFileNameDraft(event.target.value);
          }}
          type="text"
          value={saveFileNameDraft}
        />
      </label>
      <div className="flex justify-end gap-2">
        <ClassicyButton
          onClick={() => {
            dialogActions.closeGameDialog();
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
