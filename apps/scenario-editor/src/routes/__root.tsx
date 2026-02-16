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
      <EditorShell />
    </ScenarioEditorStateProvider>
  );
}

/**
 * Root shell wrapper for editor navigation and content regions.
 * Not from Micropolis C: this is React-only app chrome; parity difference is
 * view-specific layout classes (for example `map-final`) rather than Tcl panes.
 */
function EditorShell() {
  const { activeView } = useScenarioEditorState();
  const mainClassName = activeView === 'map-final' ? 'min-h-0 overflow-hidden p-0' : 'p-4';

  return (
    <div className="grid min-h-screen grid-rows-[auto_auto_1fr] bg-slate-100 font-['Segoe_UI','Helvetica_Neue',Helvetica,Arial,sans-serif] text-[#1f2328] leading-[1.4]">
      <header className="border-b border-slate-300 bg-white px-4 py-3 font-semibold">
        Scenario Editor
      </header>
      <EditorTopNav />
      <main className={mainClassName}>
        <Outlet />
      </main>
    </div>
  );
}

function EditorTopNav() {
  const { activeView } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();

  return (
    <nav
      aria-label="Editor sections"
      className="flex flex-wrap gap-2 border-b border-slate-300 bg-white px-4 py-2"
    >
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
      className="cursor-pointer rounded border border-slate-500 bg-slate-100 px-3 py-1.5 aria-[current=page]:border-blue-600 aria-[current=page]:bg-sky-100"
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
  if (view === 'map-final') {
    return 'Map (final)';
  }
  if (view === 'objective') {
    return 'Objective';
  }
  if (view === 'script') {
    return 'Scripts';
  }
  if (view === 'behavior') {
    return 'Behavior';
  }
  return 'Export';
}
