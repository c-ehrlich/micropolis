import { ClassicyCheckboxField, ClassicyTextArea } from '@city/classicyui';
import { useMemo } from 'react';

import {
  appendScenarioObjectiveChildPredicate,
  coerceScenarioObjectivePredicateKind,
  getScenarioEditorObjectiveValidationIssues,
  removeScenarioObjectiveChildPredicate,
  replaceScenarioObjectiveChildPredicate,
  replaceScenarioObjectiveNotChildPredicate,
  SCENARIO_EDITOR_OBJECTIVE_COMPARISONS,
  SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS,
  SCENARIO_EDITOR_OBJECTIVE_PREDICATE_KINDS,
  type ScenarioEditorObjectivePredicate,
} from '../state/editor-objective.ts';
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
 * Objective authoring card for Stage 4.1 predicate DSL editing.
 * Parity note: metric leaves mirror `DoScenarioScore` checks in
 * `ref/micropolis/src/sim/s_msg.c`; logical nodes (`all`/`any`/`not`) are
 * declarative extensions supported by `packages/scenario-runtime`.
 */
export function ScenarioObjectiveEditorCard() {
  const { objective, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const validationIssues = useMemo(
    () => getScenarioEditorObjectiveValidationIssues(objective),
    [objective],
  );
  const objectiveJson = useMemo(
    () => JSON.stringify(objective.enabled ? objective.predicate : null, null, 2),
    [objective.enabled, objective.predicate],
  );

  return (
    <EditorCard aria-label="Scenario objective editor" className="max-w-[64rem]">
      <h1>Scenario Objective</h1>
      <p>
        Author objective predicates using the Stage 4 DSL. Metric comparisons track classic
        `DoScenarioScore` fields, while `all`/`any`/`not` allow composed checks.
      </p>

      <ClassicyCheckboxField
        checked={objective.enabled}
        detail="Objective predicate drafts are included in strict export when objective authoring is enabled."
        label="Objective Enabled"
        onChange={(event) => {
          dispatch({ type: 'set-objective-enabled', enabled: event.currentTarget.checked });
        }}
      />

      {objective.enabled ? (
        <ScenarioObjectivePredicateEditor
          depth={0}
          onChange={(predicate) => {
            dispatch({ type: 'replace-objective-predicate', predicate });
          }}
          predicate={objective.predicate}
        />
      ) : (
        <p className="text-sm text-slate-600">Objective checks are disabled for this draft.</p>
      )}

      <EditorStatsGrid>
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Objective Enabled</dt>
        <dd>{objective.enabled ? 'yes' : 'no'}</dd>
        <dt>Root Predicate</dt>
        <dd>{objective.enabled ? objective.predicate.kind : 'none'}</dd>
        <dt>Validation</dt>
        <dd>
          {!objective.enabled
            ? 'disabled'
            : validationIssues.length === 0
              ? 'valid'
              : `invalid (${validationIssues.length} issue${
                  validationIssues.length === 1 ? '' : 's'
                })`}
        </dd>
      </EditorStatsGrid>

      {objective.enabled && validationIssues.length > 0 ? (
        <EditorIssuesPanel aria-label="Objective semantic issues">
          <h2>Objective Semantic Issues</h2>
          <ul>
            {validationIssues.map((issue, index) => (
              <li key={`${issue.path}:${issue.message}:${index}`}>
                <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </EditorIssuesPanel>
      ) : null}

      <EditorPreviewPanel aria-label="Objective predicate preview">
        <h2>Objective Predicate JSON</h2>
        <ClassicyTextArea readOnly rows={10} value={objectiveJson} />
      </EditorPreviewPanel>
    </EditorCard>
  );
}

/**
 * Recursive node editor for one objective predicate subtree.
 * Not from Micropolis C: this is React authoring UI over runtime predicate data.
 */
function ScenarioObjectivePredicateEditor(options: {
  depth: number;
  onChange: (predicate: ScenarioEditorObjectivePredicate) => void;
  predicate: ScenarioEditorObjectivePredicate;
}) {
  const { depth, onChange, predicate } = options;
  const nodeLabel = `Predicate depth ${depth}`;

  return (
    <fieldset className="my-3 rounded-md border border-slate-300 p-3 [&>legend]:px-[0.4rem] [&>legend]:text-slate-600">
      <legend>{nodeLabel}</legend>
      <EditorField>
        <span>Kind</span>
        <select
          onChange={(event) => {
            onChange(
              coerceScenarioObjectivePredicateKind(
                predicate,
                event.currentTarget.value as ScenarioEditorObjectivePredicate['kind'],
              ),
            );
          }}
          value={predicate.kind}
        >
          {SCENARIO_EDITOR_OBJECTIVE_PREDICATE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {getScenarioObjectivePredicateKindLabel(kind)}
            </option>
          ))}
        </select>
      </EditorField>

      {predicate.kind === 'metric' ? (
        <EditorFieldInline className="grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
          <EditorField>
            <span>Metric</span>
            <select
              onChange={(event) => {
                onChange({
                  ...predicate,
                  metric: event.currentTarget
                    .value as (typeof SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS)[number],
                });
              }}
              value={predicate.metric}
            >
              {SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS.map((metric) => (
                <option key={metric} value={metric}>
                  {getScenarioObjectiveMetricLabel(metric)}
                </option>
              ))}
            </select>
          </EditorField>

          <EditorField>
            <span>Operator</span>
            <select
              onChange={(event) => {
                onChange({
                  ...predicate,
                  op: event.currentTarget
                    .value as (typeof SCENARIO_EDITOR_OBJECTIVE_COMPARISONS)[number],
                });
              }}
              value={predicate.op}
            >
              {SCENARIO_EDITOR_OBJECTIVE_COMPARISONS.map((comparison) => (
                <option key={comparison} value={comparison}>
                  {getScenarioObjectiveComparisonLabel(comparison)}
                </option>
              ))}
            </select>
          </EditorField>

          <EditorField>
            <span>Value</span>
            <input
              onChange={(event) => {
                onChange({
                  ...predicate,
                  value: parseIntegerInput(event.currentTarget.value, predicate.value),
                });
              }}
              type="number"
              value={predicate.value}
            />
          </EditorField>
        </EditorFieldInline>
      ) : null}

      {predicate.kind === 'all' || predicate.kind === 'any' ? (
        <div className="grid gap-3">
          {predicate.predicates.map((childPredicate, index) => (
            <div className="grid gap-2" key={index}>
              <ScenarioObjectivePredicateEditor
                depth={depth + 1}
                onChange={(child) => {
                  onChange(replaceScenarioObjectiveChildPredicate(predicate, index, child));
                }}
                predicate={childPredicate}
              />
              <EditorButton
                className="justify-self-start"
                onClick={() => {
                  onChange(removeScenarioObjectiveChildPredicate(predicate, index));
                }}
                type="button"
              >
                Remove Child
              </EditorButton>
            </div>
          ))}
          <EditorButton
            className="justify-self-start"
            onClick={() => {
              onChange(appendScenarioObjectiveChildPredicate(predicate));
            }}
            type="button"
          >
            Add Child Predicate
          </EditorButton>
        </div>
      ) : null}

      {predicate.kind === 'not' ? (
        <div className="grid gap-3">
          <ScenarioObjectivePredicateEditor
            depth={depth + 1}
            onChange={(child) => {
              onChange(replaceScenarioObjectiveNotChildPredicate(predicate, child));
            }}
            predicate={predicate.predicate}
          />
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * Render label text for one objective predicate kind.
 * Not from Micropolis C: UI-only display names for runtime predicate kinds.
 */
function getScenarioObjectivePredicateKindLabel(
  kind: ScenarioEditorObjectivePredicate['kind'],
): string {
  if (kind === 'metric') {
    return 'Metric';
  }
  if (kind === 'all') {
    return 'All';
  }
  if (kind === 'any') {
    return 'Any';
  }
  return 'Not';
}

/**
 * Render label text for one objective metric key.
 * Mirrors metric domains from `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c`.
 */
function getScenarioObjectiveMetricLabel(
  metric: (typeof SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS)[number],
): string {
  if (metric === 'city-class') {
    return 'City Class';
  }
  if (metric === 'traffic-average') {
    return 'Traffic Average';
  }
  if (metric === 'city-score') {
    return 'City Score';
  }
  return 'Crime Average';
}

/**
 * Render label text for one objective comparison operator.
 * Mirrors relational operator semantics used by `DoScenarioScore` in
 * `ref/micropolis/src/sim/s_msg.c`.
 */
function getScenarioObjectiveComparisonLabel(
  comparison: (typeof SCENARIO_EDITOR_OBJECTIVE_COMPARISONS)[number],
): string {
  if (comparison === 'gt') {
    return '>';
  }
  if (comparison === 'gte') {
    return '>=';
  }
  if (comparison === 'lt') {
    return '<';
  }
  if (comparison === 'lte') {
    return '<=';
  }
  if (comparison === 'eq') {
    return '=';
  }
  return '!=';
}
