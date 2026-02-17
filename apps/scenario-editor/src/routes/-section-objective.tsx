import { ClassicyCheckboxField, ClassicyDisclosure, ClassicyTextArea } from '@city/classicyui';
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
  EditorError,
  EditorField,
  EditorFieldInline,
  EditorIssuesPanel,
  EditorPreviewPanel,
} from './-editor-ui.tsx';
import { parseIntegerInput } from './-section-shared.ts';

/**
 * Objective authoring card for Stage 4.1 predicate DSL editing.
 * Parity note: metric leaves mirror `DoScenarioScore` checks in
 * `ref/micropolis/src/sim/s_msg.c`; logical nodes (`all`/`any`/`not`) are
 * declarative extensions supported by `packages/scenario-runtime`.
 */
export function ScenarioObjectiveEditorCard() {
  const { objective } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const validationIssues = useMemo(
    () => getScenarioEditorObjectiveValidationIssues(objective),
    [objective],
  );
  const validationIssueMessagesByPath = useMemo(
    () => indexValidationIssueMessagesByPath(validationIssues),
    [validationIssues],
  );
  const attributableValidationPaths = useMemo(
    () =>
      objective.enabled
        ? collectObjectiveRenderableValidationPaths(objective.predicate, 'objective.predicate')
        : new Set<string>(),
    [objective.enabled, objective.predicate],
  );
  const unattributedValidationIssues = useMemo(
    () =>
      objective.enabled
        ? validationIssues.filter((issue) => !attributableValidationPaths.has(issue.path))
        : [],
    [attributableValidationPaths, objective.enabled, validationIssues],
  );
  const objectiveJson = useMemo(
    () => JSON.stringify(objective.enabled ? objective.predicate : null, null, 2),
    [objective.enabled, objective.predicate],
  );

  return (
    <section aria-label="Scenario objective editor" className="grid gap-4">
      <h1>Scenario Objective</h1>

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
          issueMessagesByPath={validationIssueMessagesByPath}
          onChange={(predicate) => {
            dispatch({ type: 'replace-objective-predicate', predicate });
          }}
          path="objective.predicate"
          predicate={objective.predicate}
        />
      ) : (
        <p className="text-sm text-slate-600">Objective checks are disabled for this draft.</p>
      )}

      {objective.enabled && unattributedValidationIssues.length > 0 ? (
        <EditorIssuesPanel aria-label="Objective semantic issues">
          <h2>Other Objective Issues</h2>
          <ul>
            {unattributedValidationIssues.map((issue, index) => (
              <li key={`${issue.path}:${issue.message}:${index}`}>
                <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </EditorIssuesPanel>
      ) : null}

      <EditorPreviewPanel aria-label="Objective predicate preview">
        <ClassicyDisclosure defaultOpen={false} summary="Objective Predicate JSON">
          <ClassicyTextArea className="w-full" readOnly rows={10} value={objectiveJson} />
        </ClassicyDisclosure>
      </EditorPreviewPanel>
    </section>
  );
}

/**
 * Recursive node editor for one objective predicate subtree.
 * Not from Micropolis C: this is React authoring UI over runtime predicate data.
 */
function ScenarioObjectivePredicateEditor(options: {
  depth: number;
  issueMessagesByPath: ReadonlyMap<string, readonly string[]>;
  onChange: (predicate: ScenarioEditorObjectivePredicate) => void;
  path: string;
  predicate: ScenarioEditorObjectivePredicate;
}) {
  const { depth, issueMessagesByPath, onChange, path, predicate } = options;
  const nodeLabel = `Predicate depth ${depth}`;
  const nodeIssue = getFirstValidationIssueMessage(issueMessagesByPath, path);
  const kindIssue = getFirstValidationIssueMessage(issueMessagesByPath, `${path}.kind`);

  return (
    <fieldset className="my-3 rounded-md border border-slate-300 p-3 [&>legend]:px-[0.4rem] [&>legend]:text-slate-600">
      <legend>{nodeLabel}</legend>
      {nodeIssue !== undefined ? <EditorError>{nodeIssue}</EditorError> : null}
      <EditorField>
        <span>Kind</span>
        <select
          aria-invalid={kindIssue !== undefined}
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
        {kindIssue !== undefined ? <EditorError>{kindIssue}</EditorError> : null}
      </EditorField>

      {predicate.kind === 'metric' ? (
        <EditorFieldInline className="grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
          <EditorField>
            <span>Metric</span>
            <select
              aria-invalid={
                getFirstValidationIssueMessage(issueMessagesByPath, `${path}.metric`) !== undefined
              }
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
            {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.metric`) !== undefined ? (
              <EditorError>
                {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.metric`)}
              </EditorError>
            ) : null}
          </EditorField>

          <EditorField>
            <span>Operator</span>
            <select
              aria-invalid={
                getFirstValidationIssueMessage(issueMessagesByPath, `${path}.op`) !== undefined
              }
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
            {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.op`) !== undefined ? (
              <EditorError>
                {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.op`)}
              </EditorError>
            ) : null}
          </EditorField>

          <EditorField>
            <span>Value</span>
            <input
              aria-invalid={
                getFirstValidationIssueMessage(issueMessagesByPath, `${path}.value`) !== undefined
              }
              onChange={(event) => {
                onChange({
                  ...predicate,
                  value: parseIntegerInput(event.currentTarget.value, predicate.value),
                });
              }}
              type="number"
              value={predicate.value}
            />
            {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.value`) !== undefined ? (
              <EditorError>
                {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.value`)}
              </EditorError>
            ) : null}
          </EditorField>
        </EditorFieldInline>
      ) : null}

      {predicate.kind === 'all' || predicate.kind === 'any' ? (
        <div className="grid gap-3">
          {predicate.predicates.map((childPredicate, index) => (
            <div className="grid gap-2" key={index}>
              <ScenarioObjectivePredicateEditor
                depth={depth + 1}
                issueMessagesByPath={issueMessagesByPath}
                onChange={(child) => {
                  onChange(replaceScenarioObjectiveChildPredicate(predicate, index, child));
                }}
                path={`${path}.predicates.${index}`}
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
          {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.predicates`) !==
          undefined ? (
            <EditorError>
              {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.predicates`)}
            </EditorError>
          ) : null}
        </div>
      ) : null}

      {predicate.kind === 'not' ? (
        <div className="grid gap-3">
          {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.predicate`) !==
          undefined ? (
            <EditorError>
              {getFirstValidationIssueMessage(issueMessagesByPath, `${path}.predicate`)}
            </EditorError>
          ) : null}
          <ScenarioObjectivePredicateEditor
            depth={depth + 1}
            issueMessagesByPath={issueMessagesByPath}
            onChange={(child) => {
              onChange(replaceScenarioObjectiveNotChildPredicate(predicate, child));
            }}
            path={`${path}.predicate`}
            predicate={predicate.predicate}
          />
        </div>
      ) : null}
    </fieldset>
  );
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

const collectObjectiveRenderableValidationPaths = (
  predicate: ScenarioEditorObjectivePredicate,
  path: string,
): Set<string> => {
  const renderablePaths = new Set<string>([path, `${path}.kind`]);

  if (predicate.kind === 'metric') {
    renderablePaths.add(`${path}.metric`);
    renderablePaths.add(`${path}.op`);
    renderablePaths.add(`${path}.value`);
    return renderablePaths;
  }

  if (predicate.kind === 'all' || predicate.kind === 'any') {
    renderablePaths.add(`${path}.predicates`);
    for (let childIndex = 0; childIndex < predicate.predicates.length; childIndex += 1) {
      const childPredicate = predicate.predicates[childIndex];
      if (childPredicate === undefined) {
        continue;
      }

      for (const childPath of collectObjectiveRenderableValidationPaths(
        childPredicate,
        `${path}.predicates.${childIndex}`,
      )) {
        renderablePaths.add(childPath);
      }
    }
    return renderablePaths;
  }

  renderablePaths.add(`${path}.predicate`);
  for (const childPath of collectObjectiveRenderableValidationPaths(
    predicate.predicate,
    `${path}.predicate`,
  )) {
    renderablePaths.add(childPath);
  }
  return renderablePaths;
};

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
