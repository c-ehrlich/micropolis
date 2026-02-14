import { ClassicyButton, ClassicyPanelTitle, ClassicySelect } from '@city/classicyui';
import { useMemo } from 'react';

import { buildNewCityPreviewMap } from '../../../../../game/runtime/new-city.ts';
import { PLAYABLE_GAME_LEVEL_CHOICES } from '../runtime-panel-constants.ts';
import type { RuntimeDialogActions, RuntimeUiController } from '../runtime-panel-types.ts';
import { NewCityMapPreview } from './new-city-map-preview.tsx';

interface NewCityDialogProps {
  dialogActions: RuntimeDialogActions;
  controlsDisabled: boolean;
  newCityTerrainSeed: RuntimeUiController['newCityTerrainSeed'];
  selectedGameLevel: RuntimeUiController['selectedGameLevel'];
}

/**
 * New-city dialog for difficulty and session bootstrap.
 * Mirrors new-city flow in `ref/micropolis/res/micropolis.tcl`.
 */
export function NewCityDialog(props: NewCityDialogProps) {
  const { dialogActions, controlsDisabled, newCityTerrainSeed, selectedGameLevel } = props;
  const previewMap = useMemo(() => {
    if (newCityTerrainSeed === null) {
      return null;
    }
    return buildNewCityPreviewMap(newCityTerrainSeed);
  }, [newCityTerrainSeed]);

  return (
    <section className="grid gap-2.5">
      <ClassicyPanelTitle className="text-sm">New Game</ClassicyPanelTitle>
      {previewMap === null ? (
        <div className="rounded border border-(--color-window-frame) bg-white px-2 py-1 text-xs">
          Generating terrain preview...
        </div>
      ) : (
        <NewCityMapPreview
          height={previewMap.height}
          tileWords={previewMap.tileWords}
          width={previewMap.width}
        />
      )}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate">Seed: {newCityTerrainSeed ?? 'pending'}</span>
        <ClassicyButton
          onClick={() => {
            dialogActions.regenerateNewCityTerrainSeed();
          }}
          type="button"
        >
          Regenerate Map
        </ClassicyButton>
      </div>
      <label className="grid gap-1 text-xs">
        Difficulty
        <ClassicySelect
          autoFocus
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
          disabled={controlsDisabled || newCityTerrainSeed === null}
          onClick={() => {
            dialogActions.startNewCity();
          }}
          type="button"
        >
          Start New City
        </ClassicyButton>
      </div>
    </section>
  );
}
