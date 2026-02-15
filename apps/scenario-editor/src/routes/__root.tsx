import { createRootRoute, Outlet } from '@tanstack/react-router';

import {
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
        <header className="editor-header">Scenario Editor MVP</header>
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
      <EditorViewButton
        activeView={activeView}
        label="Metadata"
        nextView="metadata"
        onSelect={(view) => {
          dispatch({ type: 'set-active-view', view });
        }}
      />
      <EditorViewButton
        activeView={activeView}
        label="Map"
        nextView="map"
        onSelect={(view) => {
          dispatch({ type: 'set-active-view', view });
        }}
      />
      <EditorViewButton
        activeView={activeView}
        label="Export"
        nextView="export"
        onSelect={(view) => {
          dispatch({ type: 'set-active-view', view });
        }}
      />
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
