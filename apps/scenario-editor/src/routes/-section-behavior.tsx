import { ClassicyTextArea } from '@city/classicyui';
import { useMemo } from 'react';

import {
  getScenarioEditorBehaviorValidationIssue,
  isScenarioEditorBehaviorProfileKey,
  SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS,
} from '../state/editor-behavior.ts';
import { useScenarioEditorDispatch, useScenarioEditorState } from '../state/editor-state.tsx';
import {
  EditorCard,
  EditorError,
  EditorField,
  EditorPreviewPanel,
  EditorStatsGrid,
} from './-editor-ui.tsx';

/**
 * Behavior-profile assignment card for Stage 4.3 closed-profile authoring.
 * Parity note: profile keys map to closed `ScenarioID` behavior variants in `DoShipSprite`
 * (`ref/micropolis/src/sim/w_sprite.c`), with declarative selection via
 * `packages/scenario-runtime/src/behavior-profiles.ts`.
 */
export function ScenarioBehaviorProfileEditorCard() {
  const { behavior, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const validationIssue = getScenarioEditorBehaviorValidationIssue(behavior);
  const normalizedProfileKey = behavior.profileKey.trim();
  const hasClosedProfileKey = isScenarioEditorBehaviorProfileKey(normalizedProfileKey);
  const selectedProfileKey = hasClosedProfileKey ? normalizedProfileKey : behavior.profileKey;
  const behaviorJson = useMemo(
    () =>
      JSON.stringify(
        behavior.enabled ? { behaviorProfileKey: behavior.profileKey } : null,
        null,
        2,
      ),
    [behavior.enabled, behavior.profileKey],
  );

  return (
    <EditorCard aria-label="Scenario behavior profile editor" className="max-w-[64rem]">
      <h1>Scenario Behavior Profile</h1>
      <p>
        Assign one closed runtime behavior profile key. This preserves deterministic parity by
        allowing only registered profile variants.
      </p>

      <EditorField>
        <span>Behavior Profile Assignment Enabled</span>
        <input
          className="justify-self-start"
          checked={behavior.enabled}
          onChange={(event) => {
            dispatch({ type: 'set-behavior-enabled', enabled: event.currentTarget.checked });
          }}
          type="checkbox"
        />
        <small className="text-sm text-slate-600">
          This Stage 4.3 draft editor captures profile assignment only; export integration lands in
          Stage 4.5.
        </small>
      </EditorField>

      {behavior.enabled ? (
        <EditorField>
          <span>Behavior Profile Key</span>
          <select
            aria-invalid={validationIssue !== undefined}
            onChange={(event) => {
              dispatch({
                type: 'set-behavior-profile-key',
                profileKey: event.currentTarget.value,
              });
            }}
            value={selectedProfileKey}
          >
            {hasClosedProfileKey ? null : (
              <option value={selectedProfileKey}>
                {`Unrecognized key: ${behavior.profileKey || '(empty)'}`}
              </option>
            )}
            {SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS.map((profileKey) => (
              <option key={profileKey} value={profileKey}>
                {getScenarioBehaviorProfileLabel(profileKey)}
              </option>
            ))}
          </select>
          <small className="text-sm text-slate-600">
            Closed profile keys only: {SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS.join(', ')}.
          </small>
          {validationIssue !== undefined ? <EditorError>{validationIssue}</EditorError> : null}
        </EditorField>
      ) : (
        <p className="text-sm text-slate-600">
          Behavior profile override is disabled for this draft.
        </p>
      )}

      <EditorStatsGrid>
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Assignment Enabled</dt>
        <dd>{behavior.enabled ? 'yes' : 'no'}</dd>
        <dt>Profile Key</dt>
        <dd>{behavior.enabled ? behavior.profileKey : 'none'}</dd>
        <dt>Validation</dt>
        <dd>{validationIssue === undefined ? 'valid' : 'invalid'}</dd>
      </EditorStatsGrid>

      <EditorPreviewPanel aria-label="Behavior profile preview">
        <h2>Behavior Assignment JSON</h2>
        <ClassicyTextArea readOnly rows={6} value={behaviorJson} />
      </EditorPreviewPanel>
    </EditorCard>
  );
}

/**
 * Render label text for one closed behavior-profile key.
 * Mirrors runtime profile keyspace from `packages/scenario-runtime` registry.
 */
function getScenarioBehaviorProfileLabel(
  profileKey: (typeof SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS)[number],
): string {
  if (profileKey === 'classic/default') {
    return 'Classic Default';
  }
  if (profileKey === 'classic/sf-ship-honk') {
    return 'Classic SF Ship Honk';
  }
  return profileKey;
}
