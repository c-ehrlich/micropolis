import { createFileRoute } from '@tanstack/react-router';

import { useScenarioEditorState } from '../state/editor-state.tsx';

export const Route = createFileRoute('/')({
  component: ScenarioEditorHomeRoute,
});

function ScenarioEditorHomeRoute() {
  const { activeView, bundle, isDirty } = useScenarioEditorState();
  const mapKindLabel = bundle.map.kind;
  const tileCount = bundle.map.kind === 'tile-words' ? bundle.map.tileWords.length : 0;

  return (
    <section className="editor-card" aria-label="Scenario editor state summary">
      <h1>Editor Foundation Ready</h1>
      <p>
        Stage 3.1 scaffold is active. Metadata/map/export editing behavior will be implemented in
        follow-up tasks.
      </p>
      <dl className="editor-grid">
        <dt>Scenario Key</dt>
        <dd>{bundle.key}</dd>
        <dt>Active View</dt>
        <dd>{activeView}</dd>
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Map Kind</dt>
        <dd>{mapKindLabel}</dd>
        <dt>Map Size</dt>
        <dd>
          {bundle.map.width}x{bundle.map.height}
        </dd>
        <dt>Tile Words</dt>
        <dd>{tileCount}</dd>
      </dl>
    </section>
  );
}
