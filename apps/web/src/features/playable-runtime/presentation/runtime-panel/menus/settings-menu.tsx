import { ClassicyMenuActionButton, ClassicySelect } from '@city/classicyui';

import type { RuntimeTilesetName } from '../../../../../presentation/map/tile-sprite-atlas.ts';
import type { RuntimeSessionController, RuntimeUiController } from '../runtime-panel-types.ts';
import { RuntimeTopMenuShell } from './menu-shell.tsx';

interface SettingsMenuProps {
  buttonClassName: string;
  panelClassName: string;
  session: RuntimeSessionController;
  ui: RuntimeUiController;
}

/**
 * Settings menu for tileset/runtime status/reconnect controls.
 * Mirrors runtime shell status and reconnect controls from
 * `ref/micropolis/res/whead.tcl`, adapted for web runtime phases.
 */
export function SettingsMenu(props: SettingsMenuProps) {
  const { buttonClassName, panelClassName, session, ui } = props;
  return (
    <RuntimeTopMenuShell
      buttonClassName={buttonClassName}
      isOpen={ui.openMenubarSection === 'settings'}
      label="Settings"
      onToggle={() => {
        ui.setOpenMenubarSection((current) => (current === 'settings' ? null : 'settings'));
        ui.setIsSpeedMenuOpen(false);
      }}
      panelClassName={`${panelClassName} min-w-72.5 gap-1.5 p-2`}
    >
      <label className="grid gap-0.5 text-xs" htmlFor="settings-tileset-select">
        Tileset
        <ClassicySelect
          id="settings-tileset-select"
          className="px-1.5 py-1"
          onChange={(event) => {
            const nextTileset = event.currentTarget.value as RuntimeTilesetName;
            ui.setSelectedRuntimeTileset(nextTileset);
          }}
          value={ui.selectedRuntimeTileset}
        >
          {ui.runtimeTilesetMenuChoices.map((choice) => (
            <option key={choice.name} value={choice.name}>
              {choice.label}
            </option>
          ))}
        </ClassicySelect>
      </label>
      <div className="text-xs">
        phase={session.state.phase} seq={session.state.lastAppliedServerSeq} tick=
        {session.state.lastAppliedTick}
      </div>
      <div className="text-xs">{session.runtimePhaseStatus}</div>

      {session.state.lastRejectReason === null ? null : (
        <div className="text-xs text-red-700">{`last reject: ${session.state.lastRejectReason}`}</div>
      )}
      {ui.cityIoError === '' ? null : <div className="text-xs text-red-700">{ui.cityIoError}</div>}
      {ui.lastSaveStatus === '' ? null : (
        <div className="text-xs text-green-700">{ui.lastSaveStatus}</div>
      )}
      <div className="flex flex-wrap gap-2">
        <ClassicyMenuActionButton
          disabled={session.reconnectDisabled}
          onClick={() => {
            session.reconnect();
            ui.setCityIoError('');
            ui.setLastSaveStatus('');
          }}
          type="button"
        >
          Reconnect
        </ClassicyMenuActionButton>
        <ClassicyMenuActionButton
          disabled={session.resyncDisabled}
          onClick={() => {
            session.requestResyncSnapshot();
          }}
          type="button"
        >
          Resync Snapshot
        </ClassicyMenuActionButton>
      </div>
    </RuntimeTopMenuShell>
  );
}
