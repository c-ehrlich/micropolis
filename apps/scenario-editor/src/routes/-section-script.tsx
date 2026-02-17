import { ClassicyCheckboxField, ClassicyDisclosure, ClassicyTextArea } from '@city/classicyui';
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
  EditorError,
  EditorField,
  EditorFieldInline,
  EditorIssuesPanel,
  EditorPreviewPanel,
} from './-editor-ui.tsx';
import { parseIntegerInput } from './-section-shared.ts';

/**
 * Event/action authoring card for Stage 4.2 declarative script editing.
 * Parity note: trigger patterns (`atTick`, `everyTicks`) mirror `ScenarioDisaster`
 * timing checks in `ref/micropolis/src/sim/s_disast.c`, while this React form is
 * editor-only UI over `scenario-runtime` action unions.
 */
export function ScenarioScriptEditorCard() {
  const { script } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const validationIssues = useMemo(() => getScenarioEditorScriptValidationIssues(script), [script]);
  const validationIssueMessagesByPath = useMemo(
    () => indexValidationIssueMessagesByPath(validationIssues),
    [validationIssues],
  );
  const attributableValidationPaths = useMemo(
    () =>
      script.enabled ? collectScriptRenderableValidationPaths(script.events) : new Set<string>(),
    [script.enabled, script.events],
  );
  const unattributedValidationIssues = useMemo(
    () =>
      script.enabled
        ? validationIssues.filter((issue) => !attributableValidationPaths.has(issue.path))
        : [],
    [attributableValidationPaths, script.enabled, validationIssues],
  );
  const scriptJson = useMemo(
    () => JSON.stringify(script.enabled ? script.events : [], null, 2),
    [script.enabled, script.events],
  );

  const replaceEvents = (events: readonly ScenarioEditorScriptEvent[]) => {
    dispatch({ type: 'replace-script-events', events });
  };

  return (
    <section aria-label="Scenario script editor" className="grid gap-4">
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
              issueMessagesByPath={validationIssueMessagesByPath}
              key={eventIndex}
              onChange={(nextEvent) => {
                replaceEvents(
                  replaceScenarioEditorScriptEvent(script.events, eventIndex, nextEvent),
                );
              }}
              onRemove={() => {
                replaceEvents(removeScenarioEditorScriptEvent(script.events, eventIndex));
              }}
              path={`script.events.${eventIndex}`}
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
          {getFirstValidationIssueMessage(validationIssueMessagesByPath, 'script.events') !==
          undefined ? (
            <EditorError>
              {getFirstValidationIssueMessage(validationIssueMessagesByPath, 'script.events')}
            </EditorError>
          ) : null}
        </div>
      ) : (
        <div className="grid justify-items-start gap-2">
          <p className="m-0 text-sm text-slate-600">
            Scripted event actions are disabled for this draft.
          </p>
          {script.events.length === 0 ? (
            <EditorButton
              className="justify-self-start"
              onClick={() => {
                dispatch({ type: 'set-script-enabled', enabled: true });
                replaceEvents(appendScenarioEditorScriptEvent(script.events));
              }}
              type="button"
            >
              Add Script Event
            </EditorButton>
          ) : null}
        </div>
      )}

      {script.enabled && unattributedValidationIssues.length > 0 ? (
        <EditorIssuesPanel aria-label="Script semantic issues">
          <h2>Other Script Issues</h2>
          <ul>
            {unattributedValidationIssues.map((issue, index) => (
              <li key={`${issue.path}:${issue.message}:${index}`}>
                <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </EditorIssuesPanel>
      ) : null}

      <EditorPreviewPanel aria-label="Script event preview">
        <ClassicyDisclosure defaultOpen={false} summary="Script Event JSON">
          <ClassicyTextArea className="w-full" readOnly rows={12} value={scriptJson} />
        </ClassicyDisclosure>
      </EditorPreviewPanel>
    </section>
  );
}

/**
 * One event row editor for Stage 4.2 script authoring.
 * Not from Micropolis C: this is React form wiring around declarative runtime event drafts.
 */
function ScenarioScriptEventEditor(options: {
  event: ScenarioEditorScriptEvent;
  index: number;
  issueMessagesByPath: ReadonlyMap<string, readonly string[]>;
  onChange: (event: ScenarioEditorScriptEvent) => void;
  onRemove: () => void;
  path: string;
}) {
  const { event, index, issueMessagesByPath, onChange, onRemove, path } = options;
  const triggerKind = getScenarioEditorScriptTriggerKind(event.trigger);
  const eventIssue = getFirstValidationIssueMessage(issueMessagesByPath, path);
  const triggerIssue = getFirstValidationIssueMessage(issueMessagesByPath, `${path}.trigger`);
  const actionsIssue = getFirstValidationIssueMessage(issueMessagesByPath, `${path}.actions`);

  return (
    <fieldset className="m-0 rounded-md border border-slate-300 p-[0.8rem] [&>legend]:px-[0.4rem] [&>legend]:text-slate-600">
      <legend>{`Event ${index + 1}`}</legend>
      {eventIssue !== undefined ? <EditorError>{eventIssue}</EditorError> : null}
      <EditorFieldInline className="grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
        <EditorField>
          <span>Trigger</span>
          <select
            aria-invalid={triggerIssue !== undefined}
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
          {triggerIssue !== undefined ? <EditorError>{triggerIssue}</EditorError> : null}
        </EditorField>

        {triggerKind === 'atTick' ? (
          <EditorField>
            <span>atTick</span>
            <input
              aria-invalid={
                getFirstValidationIssueMessage(issueMessagesByPath, `${path}.trigger.atTick`) !==
                undefined
              }
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
            {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.trigger.atTick`) !==
            undefined ? (
              <EditorError>
                {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.trigger.atTick`)}
              </EditorError>
            ) : null}
          </EditorField>
        ) : (
          <EditorField>
            <span>everyTicks</span>
            <input
              aria-invalid={
                getFirstValidationIssueMessage(
                  issueMessagesByPath,
                  `${path}.trigger.everyTicks`,
                ) !== undefined
              }
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
            {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.trigger.everyTicks`) !==
            undefined ? (
              <EditorError>
                {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.trigger.everyTicks`)}
              </EditorError>
            ) : null}
          </EditorField>
        )}
      </EditorFieldInline>

      <div className="mt-[0.8rem] grid gap-2 [&>h3]:m-0 [&>h3]:text-[0.95rem]">
        <h3>Actions</h3>
        {actionsIssue !== undefined ? <EditorError>{actionsIssue}</EditorError> : null}
        {event.actions.map((action, actionIndex) => (
          <div className="grid gap-1" key={`${index}:${actionIndex}`}>
            {getFirstValidationIssueMessage(
              issueMessagesByPath,
              `${path}.actions.${actionIndex}`,
            ) !== undefined ? (
              <EditorError>
                {getFirstValidationIssueMessage(
                  issueMessagesByPath,
                  `${path}.actions.${actionIndex}`,
                )}
              </EditorError>
            ) : null}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] items-end gap-x-3 gap-y-2">
              <EditorField>
                <span>Action</span>
                <select
                  aria-invalid={
                    getFirstValidationIssueMessage(
                      issueMessagesByPath,
                      `${path}.actions.${actionIndex}.kind`,
                    ) !== undefined
                  }
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
                {getFirstValidationIssueMessage(
                  issueMessagesByPath,
                  `${path}.actions.${actionIndex}.kind`,
                ) !== undefined ? (
                  <EditorError>
                    {getFirstValidationIssueMessage(
                      issueMessagesByPath,
                      `${path}.actions.${actionIndex}.kind`,
                    )}
                  </EditorError>
                ) : null}
              </EditorField>

              {action.kind === 'send-message' ? (
                <EditorField>
                  <span>messageId</span>
                  <input
                    aria-invalid={
                      getFirstValidationIssueMessage(
                        issueMessagesByPath,
                        `${path}.actions.${actionIndex}.messageId`,
                      ) !== undefined
                    }
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
                  {getFirstValidationIssueMessage(
                    issueMessagesByPath,
                    `${path}.actions.${actionIndex}.messageId`,
                  ) !== undefined ? (
                    <EditorError>
                      {getFirstValidationIssueMessage(
                        issueMessagesByPath,
                        `${path}.actions.${actionIndex}.messageId`,
                      )}
                    </EditorError>
                  ) : null}
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

const indexValidationIssueMessagesByPath = (
  issues: readonly { path: string; message: string }[],
): ReadonlyMap<string, readonly string[]> => {
  const issueMessagesByPath = new Map<string, string[]>();
  for (const issue of issues) {
    const existingMessages = issueMessagesByPath.get(issue.path);
    if (existingMessages === undefined) {
      issueMessagesByPath.set(issue.path, [issue.message]);
      continue;
    }
    existingMessages.push(issue.message);
  }
  return issueMessagesByPath;
};

const getFirstValidationIssueMessage = (
  issueMessagesByPath: ReadonlyMap<string, readonly string[]>,
  path: string,
): string | undefined => issueMessagesByPath.get(path)?.[0];

const collectScriptRenderableValidationPaths = (
  events: readonly ScenarioEditorScriptEvent[],
): Set<string> => {
  const renderablePaths = new Set<string>(['script.events']);

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    if (event === undefined) {
      continue;
    }

    const eventPath = `script.events.${eventIndex}`;
    renderablePaths.add(eventPath);
    renderablePaths.add(`${eventPath}.trigger`);
    renderablePaths.add(`${eventPath}.trigger.atTick`);
    renderablePaths.add(`${eventPath}.trigger.everyTicks`);
    renderablePaths.add(`${eventPath}.actions`);

    for (let actionIndex = 0; actionIndex < event.actions.length; actionIndex += 1) {
      const actionPath = `${eventPath}.actions.${actionIndex}`;
      renderablePaths.add(actionPath);
      renderablePaths.add(`${actionPath}.kind`);
      renderablePaths.add(`${actionPath}.messageId`);
    }
  }

  return renderablePaths;
};
