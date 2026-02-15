import { ClassicyButton, ClassicyPanelTitle, ClassicySelect } from '@city/classicyui';

import { PLAYABLE_SCENARIO_CHOICES } from '../../../../../game/runtime/playable-runtime-host.ts';
import type { ExternalScenarioBundleFile } from '../../../behavior/scenario-bundle-file.ts';
import { PLAYABLE_GAME_LEVEL_CHOICES } from '../runtime-panel-constants.ts';
import type { RuntimeDialogActions, RuntimeUiController } from '../runtime-panel-types.ts';

interface ScenarioDialogProps {
  dialogActions: RuntimeDialogActions;
  controlsDisabled: boolean;
  loadedExternalScenarioBundle: ExternalScenarioBundleFile | null;
  selectedGameLevel: RuntimeUiController['selectedGameLevel'];
  selectedScenarioKey: RuntimeUiController['selectedScenarioKey'];
}

/**
 * Scenario dialog for choosing scenario + difficulty and starting play.
 * Mirrors scenario startup controls in `ref/micropolis/res/micropolis.tcl`.
 */
export function ScenarioDialog(props: ScenarioDialogProps) {
  const { dialogActions, controlsDisabled, loadedExternalScenarioBundle, selectedGameLevel } =
    props;
  const selectedScenarioKey = props.selectedScenarioKey;
  const selectedBuiltinScenario = PLAYABLE_SCENARIO_CHOICES.find(
    (scenario) => scenario.scenarioKey === selectedScenarioKey,
  );
  const selectedExternalScenario =
    loadedExternalScenarioBundle?.bundle.key === selectedScenarioKey
      ? loadedExternalScenarioBundle
      : null;
  const shouldShowExternalOption =
    loadedExternalScenarioBundle !== null &&
    !PLAYABLE_SCENARIO_CHOICES.some(
      (scenario) => scenario.scenarioKey === loadedExternalScenarioBundle.bundle.key,
    );

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
            dialogActions.selectScenarioKey(event.target.value);
          }}
          value={selectedScenarioKey}
        >
          {shouldShowExternalOption ? (
            <option
              key={loadedExternalScenarioBundle.bundle.key}
              value={loadedExternalScenarioBundle.bundle.key}
            >
              External: {loadedExternalScenarioBundle.bundle.name} (
              {loadedExternalScenarioBundle.bundle.key})
            </option>
          ) : null}
          {PLAYABLE_SCENARIO_CHOICES.map((scenario) => (
            <option key={scenario.scenarioKey} value={scenario.scenarioKey}>
              {scenario.id}. {scenario.name} ({scenario.startYear})
            </option>
          ))}
        </ClassicySelect>
      </label>
      {selectedExternalScenario === null ? null : (
        <section className="grid gap-1 rounded border border-black/20 bg-white/50 p-2 text-[11px] leading-4">
          <h3 className="font-semibold">Loaded Scenario Review</h3>
          <p>
            <span className="font-semibold">Name:</span> {selectedExternalScenario.bundle.name}
          </p>
          <p>
            <span className="font-semibold">Key:</span> {selectedExternalScenario.bundle.key}
          </p>
          <p>
            <span className="font-semibold">Source:</span> {selectedExternalScenario.fileName}
          </p>
          <p>
            <span className="font-semibold">Start:</span>{' '}
            {selectedExternalScenario.bundle.start.startYear}, $
            {selectedExternalScenario.bundle.start.startFunds}
          </p>
          <p>
            <span className="font-semibold">Tags:</span>{' '}
            {selectedExternalScenario.bundle.tags.length === 0
              ? 'none'
              : selectedExternalScenario.bundle.tags.join(', ')}
          </p>
          <p>
            <span className="font-semibold">Description:</span>{' '}
            {selectedExternalScenario.bundle.description}
          </p>
        </section>
      )}
      {selectedExternalScenario !== null || selectedBuiltinScenario === undefined ? null : (
        <p className="text-[11px] text-black/70">
          {selectedBuiltinScenario.name} starts in {selectedBuiltinScenario.startYear}.
        </p>
      )}
      <label className="grid gap-1 text-xs">
        Difficulty
        <ClassicySelect
          className="px-2 py-1"
          disabled={controlsDisabled}
          onChange={(event) => {
            const level = Number.parseInt(event.target.value, 10);
            if (level === 0 || level === 1 || level === 2) {
              dialogActions.setGameLevel(level);
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
            dialogActions.closeGameDialog();
          }}
          type="button"
        >
          Cancel
        </ClassicyButton>
        <ClassicyButton
          disabled={controlsDisabled}
          onClick={() => {
            dialogActions.startScenario();
          }}
          type="button"
        >
          Start Scenario
        </ClassicyButton>
      </div>
    </section>
  );
}
