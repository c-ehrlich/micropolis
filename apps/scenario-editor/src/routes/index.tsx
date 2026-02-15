import { createFileRoute } from '@tanstack/react-router';
import type { FormEvent } from 'react';

import {
  getScenarioEditorMetadataValidationIssues,
  parseScenarioEditorTagsInput,
  useScenarioEditorDispatch,
  useScenarioEditorState,
} from '../state/editor-state.tsx';

export const Route = createFileRoute('/')({
  component: ScenarioEditorHomeRoute,
});

/**
 * Stage 3 workbench route with metadata editing as the first shippable feature.
 * Parity note: metadata UI is editor-only, while `startYear`/`startFunds` map to
 * `LoadScenario` fields in `ref/micropolis/src/sim/s_fileio.c`.
 */
function ScenarioEditorHomeRoute() {
  const { activeView } = useScenarioEditorState();

  if (activeView === 'metadata') {
    return <ScenarioMetadataEditorCard />;
  }

  return <ScenarioMvpPlaceholderCard />;
}

/**
 * Metadata editing card for scenario bundle fields required by Stage 3.2.
 * Reuses `scenario-core` schema constraints; this has no direct 1:1 C editor equivalent.
 */
function ScenarioMetadataEditorCard() {
  const { bundle, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const issues = getScenarioEditorMetadataValidationIssues(bundle);
  const hasIssues =
    issues.key !== undefined ||
    issues.name !== undefined ||
    issues.description !== undefined ||
    issues.tags !== undefined ||
    issues.startYear !== undefined ||
    issues.startFunds !== undefined;

  return (
    <section className="editor-card" aria-label="Scenario metadata editor">
      <h1>Scenario Metadata</h1>
      <p>
        Edit canonical bundle metadata fields for key identity, player-facing labels, and scenario
        start parameters.
      </p>
      <form className="editor-form" onSubmit={preventFormSubmit}>
        <label className="editor-field">
          <span>Scenario Key</span>
          <input
            aria-invalid={issues.key !== undefined}
            onChange={(event) => {
              dispatch({ type: 'update-metadata', metadata: { key: event.currentTarget.value } });
            }}
            type="text"
            value={bundle.key}
          />
          <small className="editor-help">Must use `builtin/*` or `user/*` namespace.</small>
          {issues.key !== undefined ? <small className="editor-error">{issues.key}</small> : null}
        </label>

        <label className="editor-field">
          <span>Name</span>
          <input
            aria-invalid={issues.name !== undefined}
            onChange={(event) => {
              dispatch({ type: 'update-metadata', metadata: { name: event.currentTarget.value } });
            }}
            type="text"
            value={bundle.name}
          />
          {issues.name !== undefined ? <small className="editor-error">{issues.name}</small> : null}
        </label>

        <label className="editor-field">
          <span>Description</span>
          <textarea
            aria-invalid={issues.description !== undefined}
            onChange={(event) => {
              dispatch({
                type: 'update-metadata',
                metadata: { description: event.currentTarget.value },
              });
            }}
            rows={4}
            value={bundle.description}
          />
          {issues.description !== undefined ? (
            <small className="editor-error">{issues.description}</small>
          ) : null}
        </label>

        <label className="editor-field">
          <span>Tags</span>
          <textarea
            aria-invalid={issues.tags !== undefined}
            onChange={(event) => {
              dispatch({
                type: 'update-metadata',
                metadata: { tags: parseScenarioEditorTagsInput(event.currentTarget.value) },
              });
            }}
            placeholder="classic, tutorial"
            rows={3}
            value={bundle.tags.join(', ')}
          />
          <small className="editor-help">Comma or newline separated.</small>
          {issues.tags !== undefined ? <small className="editor-error">{issues.tags}</small> : null}
        </label>

        <div className="editor-field editor-field-inline">
          <label>
            <span>Start Year</span>
            <input
              aria-invalid={issues.startYear !== undefined}
              onChange={(event) => {
                dispatch({
                  type: 'update-metadata',
                  metadata: {
                    start: {
                      startYear: parseIntegerInput(
                        event.currentTarget.value,
                        bundle.start.startYear,
                      ),
                    },
                  },
                });
              }}
              type="number"
              value={bundle.start.startYear}
            />
            {issues.startYear !== undefined ? (
              <small className="editor-error">{issues.startYear}</small>
            ) : null}
          </label>

          <label>
            <span>Start Funds</span>
            <input
              aria-invalid={issues.startFunds !== undefined}
              min={0}
              onChange={(event) => {
                dispatch({
                  type: 'update-metadata',
                  metadata: {
                    start: {
                      startFunds: parseIntegerInput(
                        event.currentTarget.value,
                        bundle.start.startFunds,
                      ),
                    },
                  },
                });
              }}
              type="number"
              value={bundle.start.startFunds}
            />
            {issues.startFunds !== undefined ? (
              <small className="editor-error">{issues.startFunds}</small>
            ) : null}
          </label>
        </div>
      </form>

      <dl className="editor-grid">
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Validation</dt>
        <dd>{hasIssues ? 'invalid metadata' : 'metadata valid'}</dd>
      </dl>
    </section>
  );
}

/**
 * Placeholder card for Stage 3 sections not implemented by task 3.2.
 * Not from Micropolis C: this communicates staged delivery in the editor shell.
 */
function ScenarioMvpPlaceholderCard() {
  return (
    <section className="editor-card" aria-label="Pending editor sections">
      <h1>Section Pending</h1>
      <p>Metadata editing is implemented. Map and export panels are staged in later tasks.</p>
    </section>
  );
}

/**
 * Prevent accidental form submission reload while editing metadata.
 * Not from Micropolis C: browser form behavior guard for SPA workflow.
 */
function preventFormSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

/**
 * Parse integer form input with deterministic fallback.
 * Parity note: integers mirror C-style whole-number scenario fields, while fallback behavior
 * is editor-specific UI handling.
 */
function parseIntegerInput(rawValue: string, fallback: number): number {
  if (rawValue.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
