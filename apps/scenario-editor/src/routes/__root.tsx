import { createRootRoute, Outlet } from '@tanstack/react-router';

import {
  SCENARIO_EDITOR_MVP_VIEWS,
  ScenarioEditorStateProvider,
  type ScenarioEditorWorkbenchView,
  useScenarioEditorDispatch,
  useScenarioEditorState,
} from '../state/editor-state.tsx';

export const Route = createRootRoute({
  component: RootRouteLayout,
});

function RootRouteLayout() {
  return (
    <ScenarioEditorStateProvider>
      <div className="editor-shell">
        <header className="editor-header">Scenario Editor</header>
        <EditorTopNav />
        <main className="editor-main">
          <Outlet />
        </main>
      </div>
    </ScenarioEditorStateProvider>
  );
}

function EditorTopNav() {
  const { activeView } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();

  return (
    <nav aria-label="Editor sections" className="editor-nav">
      {SCENARIO_EDITOR_MVP_VIEWS.map((view) => (
        <EditorViewButton
          key={view}
          activeView={activeView}
          label={getScenarioEditorWorkbenchViewLabel(view)}
          nextView={view}
          onSelect={(nextView) => {
            dispatch({ type: 'set-active-view', view: nextView });
          }}
        />
      ))}
    </nav>
  );
}

function EditorViewButton(options: {
  activeView: ScenarioEditorWorkbenchView;
  label: string;
  nextView: ScenarioEditorWorkbenchView;
  onSelect: (view: ScenarioEditorWorkbenchView) => void;
}) {
  const { activeView, label, nextView, onSelect } = options;
  const isCurrent = activeView === nextView;

  return (
    <button
      aria-current={isCurrent ? 'page' : undefined}
      onClick={() => {
        onSelect(nextView);
      }}
      type="button"
    >
      {label}
    </button>
  );
}

function getScenarioEditorWorkbenchViewLabel(view: ScenarioEditorWorkbenchView): string {
  if (view === 'metadata') {
    return 'Metadata';
  }
  if (view === 'map') {
    return 'Map';
  }
  if (view === 'objective') {
    return 'Objective';
  }
  if (view === 'script') {
    return 'Scripts';
  }
  return 'Export';
}
