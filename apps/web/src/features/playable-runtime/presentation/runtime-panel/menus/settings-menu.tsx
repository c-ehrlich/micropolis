import { ClassicyMenuActionButton, ClassicySelect } from '@city/classicyui';

import type { RuntimeTilesetName } from '../../../../../presentation/map/tile-sprite-atlas.ts';
import type {
  RuntimeMenuActions,
  RuntimeSessionController,
  RuntimeUiController,
} from '../runtime-panel-types.ts';
import { RuntimeTopMenuShell } from './menu-shell.tsx';

interface SettingsMenuProps {
  menuActions: RuntimeMenuActions;
  buttonClassName: string;
  cityIoError: string;
  lastSaveStatus: string;
  openMenubarSection: RuntimeUiController['openMenubarSection'];
  panelClassName: string;
  runtimeTilesetMenuChoices: RuntimeUiController['runtimeTilesetMenuChoices'];
  selectedRuntimeTileset: RuntimeUiController['selectedRuntimeTileset'];
  session: RuntimeSessionController;
}

/**
 * Settings menu for tileset/runtime status/reconnect controls.
 * Mirrors runtime shell status and reconnect controls from
 * `ref/micropolis/res/whead.tcl`, adapted for web runtime phases.
 */
export function SettingsMenu(props: SettingsMenuProps) {
  const {
    menuActions,
    buttonClassName,
    cityIoError,
    lastSaveStatus,
    openMenubarSection,
    panelClassName,
    runtimeTilesetMenuChoices,
    selectedRuntimeTileset,
    session,
  } = props;
  return (
    <RuntimeTopMenuShell
      buttonClassName={buttonClassName}
      isOpen={openMenubarSection === 'settings'}
      label="Settings"
      onToggle={() => {
        menuActions.toggleMenu('settings');
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
            menuActions.setRuntimeTileset(nextTileset);
          }}
          value={selectedRuntimeTileset}
        >
          {runtimeTilesetMenuChoices.map((choice) => (
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
      {cityIoError === '' ? null : <div className="text-xs text-red-700">{cityIoError}</div>}
      {lastSaveStatus === '' ? null : (
        <div className="text-xs text-green-700">{lastSaveStatus}</div>
      )}
      <div className="flex flex-wrap gap-2">
        <ClassicyMenuActionButton
          disabled={session.reconnectDisabled}
          onClick={() => {
            menuActions.reconnectRuntime();
          }}
          type="button"
        >
          Reconnect
        </ClassicyMenuActionButton>
        <ClassicyMenuActionButton
          disabled={session.resyncDisabled}
          onClick={() => {
            menuActions.requestResyncSnapshot();
          }}
          type="button"
        >
          Resync Snapshot
        </ClassicyMenuActionButton>
      </div>
    </RuntimeTopMenuShell>
  );
}
