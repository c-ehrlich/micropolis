import { ClassicyButton, ClassicyPanelTitle, ClassicySelect } from '@city/classicyui';

import { PLAYABLE_SCENARIO_CHOICES } from '../../../../../game/runtime/playable-runtime-host.ts';
import { PLAYABLE_GAME_LEVEL_CHOICES } from '../runtime-panel-constants.ts';
import type { RuntimeSessionController, RuntimeUiController } from '../runtime-panel-types.ts';

interface ScenarioDialogProps {
  session: RuntimeSessionController;
  ui: RuntimeUiController;
}

/**
 * Scenario dialog for choosing scenario + difficulty and starting play.
 * Mirrors scenario startup controls in `ref/micropolis/res/micropolis.tcl`.
 */
export function ScenarioDialog(props: ScenarioDialogProps) {
  const { session, ui } = props;

  return (
    <section className="grid gap-2.5">
      <ClassicyPanelTitle className="text-sm">Scenario</ClassicyPanelTitle>
      <label className="grid gap-1 text-xs">
        Scenario
        <ClassicySelect
          autoFocus
          className="px-2 py-1"
          disabled={session.controlsDisabled}
          onChange={(event) => {
            ui.setSelectedScenarioId(Number.parseInt(event.target.value, 10));
          }}
          value={ui.selectedScenarioId}
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
          disabled={session.controlsDisabled}
          onChange={(event) => {
            const level = Number.parseInt(event.target.value, 10);
            if (level === 0 || level === 1 || level === 2) {
              ui.setSelectedGameLevel(level);
            }
          }}
          value={ui.selectedGameLevel}
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
            ui.setGameDialog(null);
          }}
          type="button"
        >
          Cancel
        </ClassicyButton>
        <ClassicyButton
          disabled={session.controlsDisabled}
          onClick={() => {
            ui.setHasStartedPlayableSession(true);
            const scenario = PLAYABLE_SCENARIO_CHOICES.find(
              (entry) => entry.id === ui.selectedScenarioId,
            );
            if (scenario !== undefined) {
              ui.setSaveFileName(`${scenario.fileName}.cty`);
            }
            session.sendScenarioCommand({
              kind: 'scenario',
              action: 'load-scenario',
              scenarioId: ui.selectedScenarioId,
              gameLevel: ui.selectedGameLevel,
            });
            ui.setGameDialog(null);
          }}
          type="button"
        >
          Start Scenario
        </ClassicyButton>
      </div>
    </section>
  );
}
