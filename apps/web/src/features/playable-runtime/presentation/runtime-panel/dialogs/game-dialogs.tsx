import { ClassicyDialogBackdrop, ClassicyDialogPanel } from '@city/classicyui';
import type { RefObject } from 'react';

import type { RuntimeDialogActions, RuntimeUiController } from '../runtime-panel-types.ts';
import { LoadCityDialog } from './load-city-dialog.tsx';
import { NewCityDialog } from './new-city-dialog.tsx';
import { SaveCityDialog } from './save-city-dialog.tsx';
import { ScenarioDialog } from './scenario-dialog.tsx';

interface RuntimeGameDialogsProps {
  dialogActions: RuntimeDialogActions;
  controlsDisabled: boolean;
  gameDialog: RuntimeUiController['gameDialog'];
  isLoadingCityFile: boolean;
  loadInputRef: RefObject<HTMLInputElement | null>;
  newCityTerrainSeed: RuntimeUiController['newCityTerrainSeed'];
  pendingLoadFile: RuntimeUiController['pendingLoadFile'];
  saveFileNameDraft: RuntimeUiController['saveFileNameDraft'];
  selectedGameLevel: RuntimeUiController['selectedGameLevel'];
  selectedScenarioId: RuntimeUiController['selectedScenarioId'];
  sessionControlsDisabled: boolean;
}

/**
 * New/save/load/scenario modal set for city lifecycle commands.
 * Mirrors menu-driven city lifecycle flows from `ref/micropolis/res/micropolis.tcl`
 * and related runtime command handlers.
 * Difference: uses typed bridge commands and browser file input for `.cty` loading.
 */
export function RuntimeGameDialogs(props: RuntimeGameDialogsProps) {
  const {
    dialogActions,
    controlsDisabled,
    gameDialog,
    isLoadingCityFile,
    loadInputRef,
    newCityTerrainSeed,
    pendingLoadFile,
    saveFileNameDraft,
    selectedGameLevel,
    selectedScenarioId,
    sessionControlsDisabled,
  } = props;

  return (
    <>
      <input
        accept=".cty,application/octet-stream"
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0] ?? null;
          input.value = '';
          dialogActions.setPendingLoadFile(file);
        }}
        ref={loadInputRef}
        className="hidden"
        type="file"
      />

      {gameDialog === null ? null : (
        <ClassicyDialogBackdrop
          onClick={() => {
            if (!isLoadingCityFile) {
              dialogActions.closeGameDialog();
            }
          }}
        >
          <ClassicyDialogPanel
            onClick={(event) => {
              event.stopPropagation();
            }}
            className="grid min-w-[320px] w-[min(420px,calc(100vw-24px))] gap-2.5 p-3"
          >
            {gameDialog === 'save' ? (
              <SaveCityDialog
                dialogActions={dialogActions}
                saveFileNameDraft={saveFileNameDraft}
                sessionControlsDisabled={sessionControlsDisabled}
              />
            ) : null}
            {gameDialog === 'new' ? (
              <NewCityDialog
                dialogActions={dialogActions}
                controlsDisabled={controlsDisabled}
                newCityTerrainSeed={newCityTerrainSeed}
                selectedGameLevel={selectedGameLevel}
              />
            ) : null}
            {gameDialog === 'load' ? (
              <LoadCityDialog
                dialogActions={dialogActions}
                controlsDisabled={controlsDisabled}
                isLoadingCityFile={isLoadingCityFile}
                loadInputRef={loadInputRef}
                pendingLoadFile={pendingLoadFile}
              />
            ) : null}
            {gameDialog === 'scenario' ? (
              <ScenarioDialog
                dialogActions={dialogActions}
                controlsDisabled={controlsDisabled}
                selectedGameLevel={selectedGameLevel}
                selectedScenarioId={selectedScenarioId}
              />
            ) : null}
          </ClassicyDialogPanel>
        </ClassicyDialogBackdrop>
      )}
    </>
  );
}
