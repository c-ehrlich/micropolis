import { ClassicyCheckboxField, ClassicyTextArea } from '@city/classicyui';
import { useMemo } from 'react';

import {
  appendScenarioEditorScriptAction,
  appendScenarioEditorScriptEvent,
  coerceScenarioEditorScriptActionKind,
  coerceScenarioEditorScriptTriggerKind,
  getScenarioEditorScriptTriggerKind,
  getScenarioEditorScriptValidationIssues,
  removeScenarioEditorScriptAction,
  removeScenarioEditorScriptEvent,
  replaceScenarioEditorAtTickTrigger,
  replaceScenarioEditorEveryTicksTrigger,
  replaceScenarioEditorScriptAction,
  replaceScenarioEditorScriptEvent,
  replaceScenarioEditorSendMessageId,
  SCENARIO_EDITOR_SCRIPT_ACTION_KINDS,
  SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS,
  type ScenarioEditorScriptAction,
  type ScenarioEditorScriptEvent,
} from '../state/editor-script.ts';
import { useScenarioEditorDispatch, useScenarioEditorState } from '../state/editor-state.tsx';
import {
  EditorButton,
  EditorCard,
  EditorField,
  EditorFieldInline,
  EditorIssuesPanel,
  EditorPreviewPanel,
  EditorStatsGrid,
} from './-editor-ui.tsx';
import { parseIntegerInput } from './-section-shared.ts';

/**
 * Event/action authoring card for Stage 4.2 declarative script editing.
 * Parity note: trigger patterns (`atTick`, `everyTicks`) mirror `ScenarioDisaster`
 * timing checks in `ref/micropolis/src/sim/s_disast.c`, while this React form is
 * editor-only UI over `scenario-runtime` action unions.
 */
export function ScenarioScriptEditorCard() {
  const { script, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const validationIssues = useMemo(() => getScenarioEditorScriptValidationIssues(script), [script]);
  const scriptJson = useMemo(
    () => JSON.stringify(script.enabled ? script.events : [], null, 2),
    [script.enabled, script.events],
  );

  const replaceEvents = (events: readonly ScenarioEditorScriptEvent[]) => {
    dispatch({ type: 'replace-script-events', events });
  };

  return (
    <EditorCard aria-label="Scenario script editor" className="max-w-[68rem]">
      <h1>Scenario Scripts</h1>
      <p>
        Author declarative event scripts with one-shot (`atTick`) and interval (`everyTicks`)
        triggers plus runtime action unions for disasters/messages.
      </p>

      <ClassicyCheckboxField
        checked={script.enabled}
        detail="Script event/action drafts are included in strict export when script authoring is enabled."
        label="Scripts Enabled"
        onChange={(event) => {
          dispatch({ type: 'set-script-enabled', enabled: event.currentTarget.checked });
        }}
      />

      {script.enabled ? (
        <div className="grid gap-[0.85rem]">
          {script.events.map((event, eventIndex) => (
            <ScenarioScriptEventEditor
              event={event}
              index={eventIndex}
              key={eventIndex}
              onChange={(nextEvent) => {
                replaceEvents(
                  replaceScenarioEditorScriptEvent(script.events, eventIndex, nextEvent),
                );
              }}
              onRemove={() => {
                replaceEvents(removeScenarioEditorScriptEvent(script.events, eventIndex));
              }}
            />
          ))}
          <EditorButton
            className="justify-self-start"
            onClick={() => {
              replaceEvents(appendScenarioEditorScriptEvent(script.events));
            }}
            type="button"
          >
            Add Script Event
          </EditorButton>
        </div>
      ) : (
        <p className="text-sm text-slate-600">
          Scripted event actions are disabled for this draft.
        </p>
      )}

      <EditorStatsGrid>
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Scripts Enabled</dt>
        <dd>{script.enabled ? 'yes' : 'no'}</dd>
        <dt>Event Rows</dt>
        <dd>{script.events.length}</dd>
        <dt>Validation</dt>
        <dd>
          {!script.enabled
            ? 'disabled'
            : validationIssues.length === 0
              ? 'valid'
              : `invalid (${validationIssues.length} issue${validationIssues.length === 1 ? '' : 's'})`}
        </dd>
      </EditorStatsGrid>

      {script.enabled && validationIssues.length > 0 ? (
        <EditorIssuesPanel aria-label="Script semantic issues">
          <h2>Script Semantic Issues</h2>
          <ul>
            {validationIssues.map((issue, index) => (
              <li key={`${issue.path}:${issue.message}:${index}`}>
                <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </EditorIssuesPanel>
      ) : null}

      <EditorPreviewPanel aria-label="Script event preview">
        <h2>Script Event JSON</h2>
        <ClassicyTextArea readOnly rows={12} value={scriptJson} />
      </EditorPreviewPanel>
    </EditorCard>
  );
}

/**
 * One event row editor for Stage 4.2 script authoring.
 * Not from Micropolis C: this is React form wiring around declarative runtime event drafts.
 */
function ScenarioScriptEventEditor(options: {
  event: ScenarioEditorScriptEvent;
  index: number;
  onChange: (event: ScenarioEditorScriptEvent) => void;
  onRemove: () => void;
}) {
  const { event, index, onChange, onRemove } = options;
  const triggerKind = getScenarioEditorScriptTriggerKind(event.trigger);

  return (
    <fieldset className="m-0 rounded-md border border-slate-300 p-[0.8rem] [&>legend]:px-[0.4rem] [&>legend]:text-slate-600">
      <legend>{`Event ${index + 1}`}</legend>
      <EditorFieldInline className="grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
        <EditorField>
          <span>Trigger</span>
          <select
            onChange={(changeEvent) => {
              onChange(
                coerceScenarioEditorScriptTriggerKind(
                  event,
                  changeEvent.currentTarget
                    .value as (typeof SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS)[number],
                ),
              );
            }}
            value={triggerKind}
          >
            {SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {getScenarioScriptTriggerKindLabel(kind)}
              </option>
            ))}
          </select>
        </EditorField>

        {triggerKind === 'atTick' ? (
          <EditorField>
            <span>atTick</span>
            <input
              min={0}
              onChange={(changeEvent) => {
                onChange(
                  replaceScenarioEditorAtTickTrigger(
                    event,
                    parseIntegerInput(
                      changeEvent.currentTarget.value,
                      'atTick' in event.trigger ? event.trigger.atTick : 0,
                    ),
                  ),
                );
              }}
              type="number"
              value={'atTick' in event.trigger ? event.trigger.atTick : 0}
            />
          </EditorField>
        ) : (
          <EditorField>
            <span>everyTicks</span>
            <input
              min={1}
              onChange={(changeEvent) => {
                onChange(
                  replaceScenarioEditorEveryTicksTrigger(
                    event,
                    parseIntegerInput(
                      changeEvent.currentTarget.value,
                      'everyTicks' in event.trigger ? event.trigger.everyTicks : 1,
                    ),
                  ),
                );
              }}
              type="number"
              value={'everyTicks' in event.trigger ? event.trigger.everyTicks : 1}
            />
          </EditorField>
        )}
      </EditorFieldInline>

      <div className="mt-[0.8rem] grid gap-2 [&>h3]:m-0 [&>h3]:text-[0.95rem]">
        <h3>Actions</h3>
        {event.actions.map((action, actionIndex) => (
          <div
            className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] items-end gap-x-3 gap-y-2"
            key={`${index}:${actionIndex}`}
          >
            <EditorField>
              <span>Action</span>
              <select
                onChange={(changeEvent) => {
                  onChange(
                    replaceScenarioEditorScriptAction(
                      event,
                      actionIndex,
                      coerceScenarioEditorScriptActionKind(
                        action,
                        changeEvent.currentTarget.value as ScenarioEditorScriptAction['kind'],
                      ),
                    ),
                  );
                }}
                value={action.kind}
              >
                {SCENARIO_EDITOR_SCRIPT_ACTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {getScenarioScriptActionKindLabel(kind)}
                  </option>
                ))}
              </select>
            </EditorField>

            {action.kind === 'send-message' ? (
              <EditorField>
                <span>messageId</span>
                <input
                  onChange={(changeEvent) => {
                    onChange(
                      replaceScenarioEditorScriptAction(
                        event,
                        actionIndex,
                        replaceScenarioEditorSendMessageId(
                          action,
                          parseIntegerInput(changeEvent.currentTarget.value, action.messageId),
                        ),
                      ),
                    );
                  }}
                  type="number"
                  value={action.messageId}
                />
              </EditorField>
            ) : null}

            <EditorButton
              className="justify-self-start"
              onClick={() => {
                onChange(removeScenarioEditorScriptAction(event, actionIndex));
              }}
              type="button"
            >
              Remove Action
            </EditorButton>
          </div>
        ))}
        <EditorButton
          className="justify-self-start"
          onClick={() => {
            onChange(appendScenarioEditorScriptAction(event));
          }}
          type="button"
        >
          Add Action
        </EditorButton>
      </div>

      <EditorButton className="justify-self-start" onClick={onRemove} type="button">
        Remove Event
      </EditorButton>
    </fieldset>
  );
}

/**
 * Render label text for one script trigger selector value.
 * Mirrors `ScenarioDisaster` trigger styles in `ref/micropolis/src/sim/s_disast.c`.
 */
function getScenarioScriptTriggerKindLabel(
  kind: (typeof SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS)[number],
): string {
  if (kind === 'atTick') {
    return 'At Tick';
  }
  return 'Every Ticks';
}

/**
 * Render label text for one script action kind.
 * Mirrors action side-effect categories represented by `ScenarioRuntimeAction`.
 */
function getScenarioScriptActionKindLabel(
  kind: (typeof SCENARIO_EDITOR_SCRIPT_ACTION_KINDS)[number],
): string {
  if (kind === 'make-earthquake') {
    return 'Make Earthquake';
  }
  if (kind === 'drop-fire-bombs') {
    return 'Drop Fire Bombs';
  }
  if (kind === 'make-monster') {
    return 'Make Monster';
  }
  if (kind === 'make-meltdown') {
    return 'Make Meltdown';
  }
  if (kind === 'make-flood') {
    return 'Make Flood';
  }
  if (kind === 'send-message') {
    return 'Send Message';
  }
  return 'Lose Game';
}
