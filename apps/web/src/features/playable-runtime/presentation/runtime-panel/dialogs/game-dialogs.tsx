import { ClassicyDialogBackdrop, ClassicyDialogPanel } from '@city/classicyui';
import type { RefObject } from 'react';

import type { RuntimeSessionController, RuntimeUiController } from '../runtime-panel-types.ts';
import { LoadCityDialog } from './load-city-dialog.tsx';
import { NewCityDialog } from './new-city-dialog.tsx';
import { SaveCityDialog } from './save-city-dialog.tsx';
import { ScenarioDialog } from './scenario-dialog.tsx';

interface RuntimeGameDialogsProps {
  loadInputRef: RefObject<HTMLInputElement | null>;
  session: RuntimeSessionController;
  sessionControlsDisabled: boolean;
  ui: RuntimeUiController;
}

/**
 * New/save/load/scenario modal set for city lifecycle commands.
 * Mirrors menu-driven city lifecycle flows from `ref/micropolis/res/micropolis.tcl`
 * and related runtime command handlers.
 * Difference: uses typed bridge commands and browser file input for `.cty` loading.
 */
export function RuntimeGameDialogs(props: RuntimeGameDialogsProps) {
  const { loadInputRef, session, sessionControlsDisabled, ui } = props;

  return (
    <>
      <input
        accept=".cty,application/octet-stream"
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0] ?? null;
          input.value = '';
          ui.setPendingLoadFile(file);
          if (file !== null) {
            ui.setCityIoError('');
          }
        }}
        ref={loadInputRef}
        className="hidden"
        type="file"
      />

      {ui.gameDialog === null ? null : (
        <ClassicyDialogBackdrop
          onClick={() => {
            if (!ui.isLoadingCityFile) {
              ui.setGameDialog(null);
            }
          }}
        >
          <ClassicyDialogPanel
            onClick={(event) => {
              event.stopPropagation();
            }}
            className="grid min-w-[320px] w-[min(420px,calc(100vw-24px))] gap-2.5 p-3"
          >
            {ui.gameDialog === 'save' ? (
              <SaveCityDialog
                session={session}
                sessionControlsDisabled={sessionControlsDisabled}
                ui={ui}
              />
            ) : null}
            {ui.gameDialog === 'new' ? <NewCityDialog session={session} ui={ui} /> : null}
            {ui.gameDialog === 'load' ? (
              <LoadCityDialog loadInputRef={loadInputRef} session={session} ui={ui} />
            ) : null}
            {ui.gameDialog === 'scenario' ? <ScenarioDialog session={session} ui={ui} /> : null}
          </ClassicyDialogPanel>
        </ClassicyDialogBackdrop>
      )}
    </>
  );
}
