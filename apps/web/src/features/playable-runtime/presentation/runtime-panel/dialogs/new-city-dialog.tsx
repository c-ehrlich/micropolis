import { ClassicyButton, ClassicyPanelTitle, ClassicySelect } from '@city/classicyui';

import { PLAYABLE_GAME_LEVEL_CHOICES } from '../runtime-panel-constants.ts';
import type { RuntimePanelActions, RuntimeUiController } from '../runtime-panel-types.ts';

interface NewCityDialogProps {
  actions: RuntimePanelActions;
  controlsDisabled: boolean;
  selectedGameLevel: RuntimeUiController['selectedGameLevel'];
}

/**
 * New-city dialog for difficulty and session bootstrap.
 * Mirrors new-city flow in `ref/micropolis/res/micropolis.tcl`.
 */
export function NewCityDialog(props: NewCityDialogProps) {
  const { actions, controlsDisabled, selectedGameLevel } = props;

  return (
    <section className="grid gap-2.5">
      <ClassicyPanelTitle className="text-sm">New Game</ClassicyPanelTitle>
      <label className="grid gap-1 text-xs">
        Difficulty
        <ClassicySelect
          autoFocus
          className="px-2 py-1"
          disabled={controlsDisabled}
          onChange={(event) => {
            const level = Number.parseInt(event.target.value, 10);
            if (level === 0 || level === 1 || level === 2) {
              actions.setGameLevel(level);
            }
          }}
          value={selectedGameLevel}
        >
          {PLAYABLE_GAME_LEVEL_CHOICES.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label} (Starting Funds: {choice.startingFundsLabel})
            </option>
          ))}
        </ClassicySelect>
      </label>
      <div className="flex justify-end gap-2">
        <ClassicyButton
          onClick={() => {
            actions.closeGameDialog();
          }}
          type="button"
        >
          Cancel
        </ClassicyButton>
        <ClassicyButton
          disabled={controlsDisabled}
          onClick={() => {
            actions.startNewCity();
          }}
          type="button"
        >
          Start New City
        </ClassicyButton>
      </div>
    </section>
  );
}
