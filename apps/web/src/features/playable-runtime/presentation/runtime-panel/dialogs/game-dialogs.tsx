import { ClassicyDialogBackdrop, ClassicyDialogPanel } from '@city/classicyui';
import type { RefObject } from 'react';

import type { RuntimePanelActions, RuntimeUiController } from '../runtime-panel-types.ts';
import { LoadCityDialog } from './load-city-dialog.tsx';
import { NewCityDialog } from './new-city-dialog.tsx';
import { SaveCityDialog } from './save-city-dialog.tsx';
import { ScenarioDialog } from './scenario-dialog.tsx';

interface RuntimeGameDialogsProps {
  actions: RuntimePanelActions;
  controlsDisabled: boolean;
  gameDialog: RuntimeUiController['gameDialog'];
  isLoadingCityFile: boolean;
  loadInputRef: RefObject<HTMLInputElement | null>;
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
    actions,
    controlsDisabled,
    gameDialog,
    isLoadingCityFile,
    loadInputRef,
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
          actions.setPendingLoadFile(file);
        }}
        ref={loadInputRef}
        className="hidden"
        type="file"
      />

      {gameDialog === null ? null : (
        <ClassicyDialogBackdrop
          onClick={() => {
            if (!isLoadingCityFile) {
              actions.closeGameDialog();
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
                actions={actions}
                saveFileNameDraft={saveFileNameDraft}
                sessionControlsDisabled={sessionControlsDisabled}
              />
            ) : null}
            {gameDialog === 'new' ? (
              <NewCityDialog
                actions={actions}
                controlsDisabled={controlsDisabled}
                selectedGameLevel={selectedGameLevel}
              />
            ) : null}
            {gameDialog === 'load' ? (
              <LoadCityDialog
                actions={actions}
                controlsDisabled={controlsDisabled}
                isLoadingCityFile={isLoadingCityFile}
                loadInputRef={loadInputRef}
                pendingLoadFile={pendingLoadFile}
              />
            ) : null}
            {gameDialog === 'scenario' ? (
              <ScenarioDialog
                actions={actions}
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
