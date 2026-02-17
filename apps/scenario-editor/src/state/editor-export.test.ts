import { describe, expect, test } from 'vitest';

import {
  buildScenarioEditorStrictExport,
  getScenarioEditorExportFileName,
} from './editor-export.ts';
import { createScenarioEditorInitialBundle } from './editor-state.tsx';

/**
 * Stage 3.4 strict-export tests for canonical JSON bundle output.
 * Parity anchor: map canonicalization reuses `saveFile` map-word persistence shape in
 * `ref/micropolis/src/sim/s_fileio.c` through `writeScenarioBundleV1CityFileBytes`.
 */
describe('scenario editor strict export', () => {
  test('exports canonical bundle JSON when validation and lint pass', () => {
    const bundle = createScenarioEditorInitialBundle();
    const result = buildScenarioEditorStrictExport(bundle);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected strict export to succeed');
    }

    expect(result.issues).toHaveLength(0);
    expect(result.canonicalBundle.map.kind).toBe('city-file-bytes');
    expect(result.jsonText.endsWith('\n')).toBe(true);

    const json = JSON.parse(result.jsonText) as { map?: { kind?: string; tileWords?: unknown } };
    expect(json.map?.kind).toBe('city-file-bytes');
    expect(json.map?.tileWords).toBeUndefined();
  });

  test('fails export on schema validation errors', () => {
    const bundle = {
      ...createScenarioEditorInitialBundle(),
      key: 'missing-namespace',
    };
    const result = buildScenarioEditorStrictExport(bundle);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected strict export to fail');
    }

    expect(
      result.issues.some(
        (issue) =>
          issue.source === 'validation' &&
          issue.path === 'key' &&
          issue.message.includes('namespace'),
      ),
    ).toBe(true);
  });

  test('fails export on lint errors', () => {
    const bundle = {
      ...createScenarioEditorInitialBundle(),
      tags: ['harbor', 'harbor'],
    };
    const result = buildScenarioEditorStrictExport(bundle);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected strict export to fail');
    }

    expect(result.issues).toContainEqual({
      source: 'lint',
      path: 'tags.1',
      message: 'duplicate tag "harbor" (already used at tags.0)',
    });
  });

  test('integrates authored objective/script drafts into strict export output', () => {
    const bundle = createScenarioEditorInitialBundle();
    const result = buildScenarioEditorStrictExport(bundle, {
      behavior: {
        enabled: true,
        // Magic number source:
        // - Scenario id `2` is San Francisco in `LoadScenario(short s)` in
        //   `ref/micropolis/src/sim/s_fileio.c`.
        // - `DoShipSprite` special-cases `ScenarioID == 2` in
        //   `ref/micropolis/src/sim/w_sprite.c`.
        profileKey: 'classic/sf-ship-honk',
      },
      objective: {
        enabled: true,
        predicate: {
          kind: 'metric',
          metric: 'traffic-average',
          op: 'lt',
          // Magic number source: Bern objective threshold `TrafficAverage < 80`
          // from `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c`.
          value: 80,
        },
      },
      script: {
        enabled: true,
        events: [
          {
            // Magic number source: Rio flood cadence checks `wait % 24 == 0`
            // in `ScenarioDisaster` (`ref/micropolis/src/sim/s_disast.c`).
            trigger: { everyTicks: 24 },
            actions: [
              { kind: 'make-flood' },
              {
                kind: 'send-message',
                // Magic number source: scenario failure message id `-200`
                // from `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c`.
                messageId: -200,
              },
            ],
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected strict export to succeed with authored drafts');
    }

    expect(result.canonicalBundle.objective).toEqual({
      kind: 'metric',
      metric: 'traffic-average',
      op: 'lt',
      value: 80,
    });
    expect(result.canonicalBundle.script).toEqual([
      {
        trigger: { everyTicks: 24 },
        actions: [{ kind: 'make-flood' }, { kind: 'send-message', messageId: -200 }],
      },
    ]);
    expect(result.canonicalBundle.behaviorProfileKey).toBe('classic/sf-ship-honk');
  });

  test('fails export when authored objective/script drafts violate semantic rules', () => {
    const bundle = createScenarioEditorInitialBundle();
    const result = buildScenarioEditorStrictExport(bundle, {
      objective: {
        enabled: true,
        predicate: {
          kind: 'all',
          predicates: [],
        },
      },
      script: {
        enabled: true,
        events: [],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected strict export to fail on semantic issues');
    }

    expect(result.issues).toContainEqual({
      source: 'lint',
      path: 'objective.predicate.predicates',
      message: 'all predicate must include at least one child predicate',
    });
    expect(result.issues).toContainEqual({
      source: 'lint',
      path: 'script.events',
      message: 'script must include at least one event',
    });
  });

  test('removes behavior profile key when behavior authoring is disabled', () => {
    const bundle = {
      ...createScenarioEditorInitialBundle(),
      behaviorProfileKey: 'classic/sf-ship-honk' as const,
    };
    const result = buildScenarioEditorStrictExport(bundle, {
      behavior: {
        enabled: false,
        profileKey: 'classic/sf-ship-honk',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected strict export to succeed with behavior disabled');
    }

    expect(result.canonicalBundle.behaviorProfileKey).toBeUndefined();
  });
});

describe('scenario editor export file naming', () => {
  test('sanitizes key text into a deterministic file name', () => {
    const fileName = getScenarioEditorExportFileName('user/Harbor Redevelopment 2026!');

    expect(fileName).toBe('user__harbor-redevelopment-2026.scenario.json');
  });
});
