import { ClassicyCheckboxField, ClassicyDisclosure, ClassicyTextArea } from '@city/classicyui';
import { useMemo } from 'react';

import {
  getScenarioEditorBehaviorValidationIssue,
  SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS,
} from '../state/editor-behavior.ts';
import { useScenarioEditorDispatch, useScenarioEditorState } from '../state/editor-state.tsx';
import { EditorError, EditorField, EditorPreviewPanel, EditorStatsGrid } from './-editor-ui.tsx';

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
  const sfShipHonkEnabled = behavior.enabled && normalizedProfileKey === 'classic/sf-ship-honk';
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
    <section aria-label="Scenario behavior profile editor" className="grid gap-4">
      <h1>Scenario Behavior Profile</h1>
      <p>
        Configure the San Francisco ship-horn behavior override. This preserves deterministic parity
        by allowing only registered runtime profile variants.
      </p>

      <EditorField>
        <ClassicyCheckboxField
          checked={sfShipHonkEnabled}
          detail="When checked, strict export writes `behaviorProfileKey: classic/sf-ship-honk` to mirror the San Francisco `ScenarioID == 2` ship-honk branch from `DoShipSprite`."
          label="Use San Francisco Ship Horn Behavior"
          onChange={(event) => {
            dispatch({
              type: 'set-behavior-profile-key',
              profileKey: event.currentTarget.checked ? 'classic/sf-ship-honk' : 'classic/default',
            });
            dispatch({ type: 'set-behavior-enabled', enabled: event.currentTarget.checked });
          }}
        />
        <small className="text-sm text-slate-600">
          Current key: {behavior.profileKey || '(empty)'}.
          <br />
          Closed profile keys only: {SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS.join(', ')}.
        </small>
        {validationIssue !== undefined ? <EditorError>{validationIssue}</EditorError> : null}
      </EditorField>

      <EditorStatsGrid>
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Assignment Enabled</dt>
        <dd>{behavior.enabled ? 'yes' : 'no'}</dd>
        <dt>SF Horn Behavior</dt>
        <dd>{behavior.enabled && sfShipHonkEnabled ? 'yes' : 'no'}</dd>
        <dt>Profile Key</dt>
        <dd>{behavior.enabled ? behavior.profileKey : 'none'}</dd>
        <dt>Validation</dt>
        <dd>{validationIssue === undefined ? 'valid' : 'invalid'}</dd>
      </EditorStatsGrid>

      <EditorPreviewPanel aria-label="Behavior profile preview">
        <ClassicyDisclosure defaultOpen={false} summary="Behavior Assignment JSON">
          <ClassicyTextArea readOnly rows={6} value={behaviorJson} className="w-full" />
        </ClassicyDisclosure>
      </EditorPreviewPanel>
    </section>
  );
}
