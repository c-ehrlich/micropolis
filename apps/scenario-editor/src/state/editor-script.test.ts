import { describe, expect, test } from 'vitest';

import {
  appendScenarioEditorScriptAction,
  appendScenarioEditorScriptEvent,
  coerceScenarioEditorScriptActionKind,
  coerceScenarioEditorScriptTriggerKind,
  createScenarioEditorDefaultScriptEvent,
  createScenarioEditorInitialScriptDraft,
  getScenarioEditorScriptTriggerKind,
  getScenarioEditorScriptValidationIssues,
  removeScenarioEditorScriptAction,
  removeScenarioEditorScriptEvent,
  replaceScenarioEditorAtTickTrigger,
  replaceScenarioEditorEveryTicksTrigger,
  replaceScenarioEditorScriptAction,
  replaceScenarioEditorScriptEvent,
  replaceScenarioEditorSendMessageId,
} from './editor-script.ts';

/**
 * Stage 4.2 script authoring tests.
 * Parity anchor: trigger timing and action domains map to `ScenarioDisaster` in
 * `ref/micropolis/src/sim/s_disast.c`, represented as declarative editor draft state.
 */
describe('scenario editor script drafting', () => {
  test('creates default event with one-shot atTick trigger and earthquake action', () => {
    const event = createScenarioEditorDefaultScriptEvent();

    // Magic number source: one-shot scenario disaster triggers compare `wait == 1`
    // in `ScenarioDisaster` (`ref/micropolis/src/sim/s_disast.c`).
    expect(event).toEqual({
      trigger: { atTick: 1 },
      actions: [{ kind: 'make-earthquake' }],
    });
  });

  test('creates initial script draft disabled with one template event', () => {
    const script = createScenarioEditorInitialScriptDraft();

    expect(script.enabled).toBe(false);
    expect(script.events).toHaveLength(1);
    expect(getScenarioEditorScriptTriggerKind(script.events[0]!.trigger)).toBe('atTick');
  });

  test('coerces trigger kinds and preserves/clamps countdown values', () => {
    const asEveryTicks = coerceScenarioEditorScriptTriggerKind(
      {
        trigger: { atTick: 0 },
        actions: [{ kind: 'make-earthquake' }],
      },
      'everyTicks',
    );
    // Magic number source: Rio flood cadence uses modulo 24 (`wait % 24 == 0`)
    // in `ScenarioDisaster` (`ref/micropolis/src/sim/s_disast.c`).
    expect(asEveryTicks.trigger).toEqual({ everyTicks: 1 });

    const asAtTick = coerceScenarioEditorScriptTriggerKind(
      {
        trigger: { everyTicks: 24 },
        actions: [{ kind: 'make-flood' }],
      },
      'atTick',
    );
    expect(asAtTick.trigger).toEqual({ atTick: 24 });
  });

  test('coerces action kinds and supports send-message payload updates', () => {
    const asSendMessage = coerceScenarioEditorScriptActionKind(
      { kind: 'make-flood' },
      'send-message',
    );
    expect(asSendMessage).toEqual({ kind: 'send-message', messageId: 0 });

    const updatedMessageId = replaceScenarioEditorSendMessageId(asSendMessage, -200);
    // Magic number source: scenario failure messaging uses id `-200` in
    // `DoScenarioScore` (`ref/micropolis/src/sim/s_msg.c`).
    expect(updatedMessageId).toEqual({ kind: 'send-message', messageId: -200 });

    const asLoseGame = coerceScenarioEditorScriptActionKind(updatedMessageId, 'lose-game');
    expect(asLoseGame).toEqual({ kind: 'lose-game' });
  });

  test('appends/replaces/removes event rows immutably', () => {
    const base = [createScenarioEditorDefaultScriptEvent()];
    const appended = appendScenarioEditorScriptEvent(base, {
      trigger: { everyTicks: 24 },
      actions: [{ kind: 'make-flood' }],
    });
    expect(appended).toHaveLength(2);

    const replaced = replaceScenarioEditorScriptEvent(appended, 1, {
      trigger: { atTick: 48 },
      actions: [{ kind: 'make-monster' }],
    });
    expect(replaced[1]).toEqual({
      trigger: { atTick: 48 },
      actions: [{ kind: 'make-monster' }],
    });

    const removed = removeScenarioEditorScriptEvent(replaced, 1);
    expect(removed).toHaveLength(1);

    const cannotRemoveLast = removeScenarioEditorScriptEvent(removed, 0);
    expect(cannotRemoveLast).toBe(removed);
  });

  test('appends/replaces/removes actions immutably while preserving one action', () => {
    const event = createScenarioEditorDefaultScriptEvent();
    const appended = appendScenarioEditorScriptAction(event, { kind: 'make-flood' });
    expect(appended.actions).toHaveLength(2);

    const replaced = replaceScenarioEditorScriptAction(appended, 1, { kind: 'make-meltdown' });
    expect(replaced.actions[1]).toEqual({ kind: 'make-meltdown' });

    const removed = removeScenarioEditorScriptAction(replaced, 1);
    expect(removed.actions).toHaveLength(1);

    const cannotRemoveLast = removeScenarioEditorScriptAction(removed, 0);
    expect(cannotRemoveLast).toBe(removed);
  });

  test('normalizes atTick/everyTicks values through direct trigger replacement helpers', () => {
    const event = createScenarioEditorDefaultScriptEvent();
    const atTick = replaceScenarioEditorAtTickTrigger(event, -99);
    expect(atTick.trigger).toEqual({ atTick: 0 });

    const everyTicks = replaceScenarioEditorEveryTicksTrigger(event, 0);
    expect(everyTicks.trigger).toEqual({ everyTicks: 1 });
  });

  test('validates enabled script drafts for known trigger/action semantics', () => {
    const issues = getScenarioEditorScriptValidationIssues({
      enabled: true,
      events: [createScenarioEditorDefaultScriptEvent()],
    });

    expect(issues).toEqual([]);
  });

  test('reports semantic issues for malformed trigger/action payloads', () => {
    const malformedEvents = [
      {
        trigger: { atTick: 1, everyTicks: 24 },
        actions: [{ kind: 'lose-game', messageId: -200 }],
      },
      {
        trigger: { everyTicks: 0 },
        actions: [],
      },
      {
        trigger: { atTick: 2 },
        actions: [{ kind: 'send-message' }],
      },
      {
        trigger: {},
        actions: [{ kind: 'unknown-action' }],
      },
    ] as unknown as ReturnType<typeof createScenarioEditorInitialScriptDraft>['events'];

    const issues = getScenarioEditorScriptValidationIssues({
      enabled: true,
      events: malformedEvents,
    });

    expect(issues).toEqual([
      {
        path: 'script.events.0.trigger',
        message: 'script trigger must use exactly one of atTick or everyTicks',
      },
      {
        path: 'script.events.0.actions.0.messageId',
        message: 'messageId payload is only valid for send-message actions',
      },
      {
        path: 'script.events.1.trigger.everyTicks',
        message: 'everyTicks must be a positive integer',
      },
      {
        path: 'script.events.1.actions',
        message: 'script event must include at least one action',
      },
      {
        path: 'script.events.2.actions.0.messageId',
        message: 'send-message actions require integer messageId payloads',
      },
      {
        path: 'script.events.3.trigger',
        message: 'script trigger kind is unknown; expected atTick or everyTicks',
      },
      {
        path: 'script.events.3.actions.0.kind',
        message:
          'action kind is unknown; expected one of: make-earthquake, drop-fire-bombs, make-monster, make-meltdown, make-flood, send-message, lose-game',
      },
    ]);
  });

  test('skips semantic validation while script authoring is disabled', () => {
    const issues = getScenarioEditorScriptValidationIssues({
      enabled: false,
      events: [],
    });

    expect(issues).toEqual([]);
  });
});
