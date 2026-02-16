import {
  getScenarioEditorMetadataValidationIssues,
  parseScenarioEditorTagsInput,
  useScenarioEditorDispatch,
  useScenarioEditorState,
} from '../state/editor-state.tsx';
import {
  EditorCard,
  EditorError,
  EditorField,
  EditorFieldInline,
  EditorForm,
  EditorHelp,
  EditorStatsGrid,
} from './-editor-ui.tsx';
import { parseIntegerInput, preventFormSubmit } from './-section-shared.ts';

/**
 * Metadata editing card for scenario bundle fields required by Stage 3.2.
 * Reuses `scenario-core` schema constraints; this has no direct 1:1 C editor equivalent.
 */
export function ScenarioMetadataEditorCard() {
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
    <EditorCard aria-label="Scenario metadata editor" className="max-w-[52rem]">
      <h1>Scenario Metadata</h1>
      <p>
        Edit canonical bundle metadata fields for key identity, player-facing labels, and scenario
        start parameters.
      </p>
      <EditorForm onSubmit={preventFormSubmit}>
        <EditorField>
          <span>Scenario Key</span>
          <input
            aria-invalid={issues.key !== undefined}
            onChange={(event) => {
              dispatch({ type: 'update-metadata', metadata: { key: event.currentTarget.value } });
            }}
            type="text"
            value={bundle.key}
          />
          <EditorHelp>Must use `builtin/*` or `user/*` namespace.</EditorHelp>
          {issues.key !== undefined ? <EditorError>{issues.key}</EditorError> : null}
        </EditorField>

        <EditorField>
          <span>Name</span>
          <input
            aria-invalid={issues.name !== undefined}
            onChange={(event) => {
              dispatch({ type: 'update-metadata', metadata: { name: event.currentTarget.value } });
            }}
            type="text"
            value={bundle.name}
          />
          {issues.name !== undefined ? <EditorError>{issues.name}</EditorError> : null}
        </EditorField>

        <EditorField>
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
            <EditorError>{issues.description}</EditorError>
          ) : null}
        </EditorField>

        <EditorField>
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
          <EditorHelp>Comma or newline separated.</EditorHelp>
          {issues.tags !== undefined ? <EditorError>{issues.tags}</EditorError> : null}
        </EditorField>

        <EditorFieldInline>
          <EditorField>
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
            {issues.startYear !== undefined ? <EditorError>{issues.startYear}</EditorError> : null}
          </EditorField>

          <EditorField>
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
              <EditorError>{issues.startFunds}</EditorError>
            ) : null}
          </EditorField>
        </EditorFieldInline>
      </EditorForm>

      <EditorStatsGrid>
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Validation</dt>
        <dd>{hasIssues ? 'invalid metadata' : 'metadata valid'}</dd>
      </EditorStatsGrid>
    </EditorCard>
  );
}
