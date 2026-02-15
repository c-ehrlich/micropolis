import type { ScenarioRuntimeAction } from '@city/scenario-runtime';

/**
 * Declarative script trigger union for Stage 4.2 event authoring.
 * Maps to `ScenarioDisaster` trigger styles in `ref/micropolis/src/sim/s_disast.c`:
 * - `atTick` mirrors one-shot `wait == 1`-style checks.
 * - `everyTicks` mirrors periodic `wait % 24 == 0`-style checks.
 */
export type ScenarioEditorScriptTrigger =
  | { readonly atTick: number }
  | { readonly everyTicks: number };

/**
 * Trigger selector values exposed by the Stage 4.2 script editor UI.
 * Not from Micropolis C: this powers modern form-state switching between trigger unions.
 */
export const SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS = ['atTick', 'everyTicks'] as const;

/**
 * Trigger selector discriminant for Stage 4.2 script editor controls.
 * Not from Micropolis C: TypeScript convenience type for UI form branching.
 */
export type ScenarioEditorScriptTriggerKind = (typeof SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS)[number];

/**
 * Declarative script action union exposed by Stage 4.2 authoring UI.
 * Mirrors `ScenarioRuntimeAction` from `packages/scenario-runtime/src/runtime-state.ts`,
 * which represents C side effects emitted by `ScenarioDisaster`/`DoScenarioScore`.
 */
export type ScenarioEditorScriptAction = ScenarioRuntimeAction;

/**
 * All action kinds supported by the Stage 4.2 script editor.
 * Mirrors runtime action kinds mapped from `ScenarioDisaster` in
 * `ref/micropolis/src/sim/s_disast.c` and objective-failure lose-game flow in
 * `ref/micropolis/src/sim/s_msg.c`.
 */
export const SCENARIO_EDITOR_SCRIPT_ACTION_KINDS = [
  'make-earthquake',
  'drop-fire-bombs',
  'make-monster',
  'make-meltdown',
  'make-flood',
  'send-message',
  'lose-game',
] as const satisfies readonly ScenarioEditorScriptAction['kind'][];

/**
 * One authored script event row for Stage 4.2.
 * Parity note: this is editor-side draft state; Stage 4.5 integrates it with export/runtime
 * event definitions that mirror `ScenarioDisaster` countdown checks.
 */
export interface ScenarioEditorScriptEvent {
  readonly trigger: ScenarioEditorScriptTrigger;
  readonly actions: readonly ScenarioEditorScriptAction[];
}

/**
 * Stage 4.2 editor draft model for optional event/action script authoring.
 * Parity note: classic scenarios used hardcoded disaster switch branches; this stores
 * declarative event drafts to replace numeric-id branching in later integration stages.
 */
export interface ScenarioEditorScriptDraft {
  readonly enabled: boolean;
  readonly events: readonly ScenarioEditorScriptEvent[];
}

/**
 * Creates a default script action template for new event rows.
 * Uses earthquake because `ScenarioDisaster` triggers earthquake on `wait == 1`
 * for San Francisco in `ref/micropolis/src/sim/s_disast.c`.
 */
export function createScenarioEditorDefaultScriptAction(): ScenarioEditorScriptAction {
  return {
    kind: 'make-earthquake',
  };
}

/**
 * Creates a default script event template for new drafts/event rows.
 * Magic number mapping: `atTick: 1` mirrors one-shot `wait == 1` branches in
 * `ScenarioDisaster` (`ref/micropolis/src/sim/s_disast.c`).
 */
export function createScenarioEditorDefaultScriptEvent(): ScenarioEditorScriptEvent {
  return {
    trigger: { atTick: 1 },
    actions: [createScenarioEditorDefaultScriptAction()],
  };
}

/**
 * Creates initial Stage 4.2 script draft state for a new editor session.
 * Parity note: script authoring is opt-in (`enabled: false`) because classic scenarios were
 * pre-authored in C; enabling and export integration are explicit editor workflow steps.
 */
export function createScenarioEditorInitialScriptDraft(): ScenarioEditorScriptDraft {
  return {
    enabled: false,
    events: [createScenarioEditorDefaultScriptEvent()],
  };
}

/**
 * Returns trigger kind discriminator for one script trigger union member.
 * Not from Micropolis C: editor helper for stable form rendering over union state.
 */
export function getScenarioEditorScriptTriggerKind(
  trigger: ScenarioEditorScriptTrigger,
): ScenarioEditorScriptTriggerKind {
  return 'atTick' in trigger ? 'atTick' : 'everyTicks';
}

/**
 * Coerces one script event trigger to the requested trigger union member.
 * Preserves existing interval/tick where possible while enforcing integer bounds expected by
 * runtime countdown checks in `ScenarioDisaster` (`ref/micropolis/src/sim/s_disast.c`).
 */
export function coerceScenarioEditorScriptTriggerKind(
  event: ScenarioEditorScriptEvent,
  nextKind: ScenarioEditorScriptTriggerKind,
): ScenarioEditorScriptEvent {
  if (nextKind === 'atTick') {
    const nextAtTick =
      'atTick' in event.trigger
        ? normalizeNonNegativeInteger(event.trigger.atTick, 1)
        : normalizeNonNegativeInteger(event.trigger.everyTicks, 1);

    if ('atTick' in event.trigger && event.trigger.atTick === nextAtTick) {
      return event;
    }

    return {
      ...event,
      trigger: { atTick: nextAtTick },
    };
  }

  const nextEveryTicks =
    'everyTicks' in event.trigger
      ? normalizePositiveInteger(event.trigger.everyTicks, 24)
      : normalizePositiveInteger(event.trigger.atTick, 24);
  if ('everyTicks' in event.trigger && event.trigger.everyTicks === nextEveryTicks) {
    return event;
  }

  return {
    ...event,
    trigger: { everyTicks: nextEveryTicks },
  };
}

/**
 * Coerces one script action to a requested runtime action kind.
 * Preserves `send-message.messageId` when available; defaults message id to `0` for new
 * `send-message` actions because classic scenario event paths did not use this payload directly.
 */
export function coerceScenarioEditorScriptActionKind(
  action: ScenarioEditorScriptAction,
  nextKind: ScenarioEditorScriptAction['kind'],
): ScenarioEditorScriptAction {
  if (action.kind === nextKind) {
    return action;
  }

  if (nextKind === 'send-message') {
    return {
      kind: 'send-message',
      messageId: action.kind === 'send-message' ? action.messageId : 0,
    };
  }

  return { kind: nextKind };
}

/**
 * Appends one script event row to the authored event list.
 * Not from Micropolis C: immutable editor list helper for Stage 4.2 form updates.
 */
export function appendScenarioEditorScriptEvent(
  events: readonly ScenarioEditorScriptEvent[],
  event: ScenarioEditorScriptEvent = createScenarioEditorDefaultScriptEvent(),
): readonly ScenarioEditorScriptEvent[] {
  return [...events, event];
}

/**
 * Replaces one script event row by index.
 * Returns the input unchanged when index is out of range.
 */
export function replaceScenarioEditorScriptEvent(
  events: readonly ScenarioEditorScriptEvent[],
  index: number,
  event: ScenarioEditorScriptEvent,
): readonly ScenarioEditorScriptEvent[] {
  if (!Number.isInteger(index) || index < 0 || index >= events.length) {
    return events;
  }

  return events.map((current, currentIndex) => (currentIndex === index ? event : current));
}

/**
 * Removes one script event row by index while preserving at least one row.
 * Not from Micropolis C: keeps editor draft form valid during incremental editing.
 */
export function removeScenarioEditorScriptEvent(
  events: readonly ScenarioEditorScriptEvent[],
  index: number,
): readonly ScenarioEditorScriptEvent[] {
  if (!Number.isInteger(index) || index < 0 || index >= events.length || events.length <= 1) {
    return events;
  }

  return events.filter((_, currentIndex) => currentIndex !== index);
}

/**
 * Appends one action to a script event action list.
 * Not from Micropolis C: immutable authoring helper for event action arrays.
 */
export function appendScenarioEditorScriptAction(
  event: ScenarioEditorScriptEvent,
  action: ScenarioEditorScriptAction = createScenarioEditorDefaultScriptAction(),
): ScenarioEditorScriptEvent {
  return {
    ...event,
    actions: [...event.actions, action],
  };
}

/**
 * Replaces one action on a script event by index.
 * Returns the input event unchanged when index is out of range.
 */
export function replaceScenarioEditorScriptAction(
  event: ScenarioEditorScriptEvent,
  index: number,
  action: ScenarioEditorScriptAction,
): ScenarioEditorScriptEvent {
  if (!Number.isInteger(index) || index < 0 || index >= event.actions.length) {
    return event;
  }

  return {
    ...event,
    actions: event.actions.map((current, currentIndex) =>
      currentIndex === index ? action : current,
    ),
  };
}

/**
 * Removes one action from a script event while preserving at least one action row.
 * Not from Micropolis C: form guard to avoid empty action arrays during editing.
 */
export function removeScenarioEditorScriptAction(
  event: ScenarioEditorScriptEvent,
  index: number,
): ScenarioEditorScriptEvent {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= event.actions.length ||
    event.actions.length <= 1
  ) {
    return event;
  }

  return {
    ...event,
    actions: event.actions.filter((_, currentIndex) => currentIndex !== index),
  };
}

/**
 * Replaces one script event trigger payload with a normalized `atTick` value.
 * Enforces non-negative integers, matching runtime countdown-equals domains.
 */
export function replaceScenarioEditorAtTickTrigger(
  event: ScenarioEditorScriptEvent,
  atTick: number,
): ScenarioEditorScriptEvent {
  const nextAtTick = normalizeNonNegativeInteger(atTick, 0);
  if ('atTick' in event.trigger && event.trigger.atTick === nextAtTick) {
    return event;
  }
  return {
    ...event,
    trigger: { atTick: nextAtTick },
  };
}

/**
 * Replaces one script event trigger payload with a normalized `everyTicks` value.
 * Enforces positive integers because modulo intervals in C disaster checks use `> 0`.
 */
export function replaceScenarioEditorEveryTicksTrigger(
  event: ScenarioEditorScriptEvent,
  everyTicks: number,
): ScenarioEditorScriptEvent {
  const nextEveryTicks = normalizePositiveInteger(everyTicks, 1);
  if ('everyTicks' in event.trigger && event.trigger.everyTicks === nextEveryTicks) {
    return event;
  }
  return {
    ...event,
    trigger: { everyTicks: nextEveryTicks },
  };
}

/**
 * Replaces `send-message.messageId` on one action entry when the action kind supports it.
 * Returns input action unchanged for non-message action kinds.
 */
export function replaceScenarioEditorSendMessageId(
  action: ScenarioEditorScriptAction,
  messageId: number,
): ScenarioEditorScriptAction {
  if (action.kind !== 'send-message') {
    return action;
  }

  return {
    kind: 'send-message',
    messageId: normalizeInteger(messageId, action.messageId),
  };
}

const normalizeInteger = (value: number, fallback: number): number => {
  if (!Number.isInteger(value)) {
    return fallback;
  }
  return value;
};

const normalizeNonNegativeInteger = (value: number, fallback: number): number => {
  const normalized = normalizeInteger(value, fallback);
  return normalized < 0 ? 0 : normalized;
};

const normalizePositiveInteger = (value: number, fallback: number): number => {
  const normalized = normalizeInteger(value, fallback);
  return normalized <= 0 ? 1 : normalized;
};
