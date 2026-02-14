import { ClassicyButton, ClassicyPanelTitle, ClassicySelect } from '@city/classicyui';

import { PLAYABLE_SCENARIO_CHOICES } from '../../../../../game/runtime/playable-runtime-host.ts';
import { PLAYABLE_GAME_LEVEL_CHOICES } from '../runtime-panel-constants.ts';
import type { RuntimePanelActions, RuntimeUiController } from '../runtime-panel-types.ts';

interface ScenarioDialogProps {
  actions: RuntimePanelActions;
  controlsDisabled: boolean;
  selectedGameLevel: RuntimeUiController['selectedGameLevel'];
  selectedScenarioId: RuntimeUiController['selectedScenarioId'];
}

/**
 * Scenario dialog for choosing scenario + difficulty and starting play.
 * Mirrors scenario startup controls in `ref/micropolis/res/micropolis.tcl`.
 */
export function ScenarioDialog(props: ScenarioDialogProps) {
  const { actions, controlsDisabled, selectedGameLevel, selectedScenarioId } = props;

  return (
    <section className="grid gap-2.5">
      <ClassicyPanelTitle className="text-sm">Scenario</ClassicyPanelTitle>
      <label className="grid gap-1 text-xs">
        Scenario
        <ClassicySelect
          autoFocus
          className="px-2 py-1"
          disabled={controlsDisabled}
          onChange={(event) => {
            actions.selectScenario(Number.parseInt(event.target.value, 10));
          }}
          value={selectedScenarioId}
        >
          {PLAYABLE_SCENARIO_CHOICES.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.id}. {scenario.name} ({scenario.startYear})
            </option>
          ))}
        </ClassicySelect>
      </label>
      <label className="grid gap-1 text-xs">
        Difficulty
        <ClassicySelect
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
            actions.startScenario();
          }}
          type="button"
        >
          Start Scenario
        </ClassicyButton>
      </div>
    </section>
  );
}
