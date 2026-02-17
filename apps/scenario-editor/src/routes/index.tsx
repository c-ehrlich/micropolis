import { createFileRoute } from '@tanstack/react-router';

import {
  type ScenarioEditorWorkbenchView,
  useScenarioEditorDispatch,
  useScenarioEditorState,
} from '../state/editor-state.tsx';
import { ScenarioBehaviorProfileEditorCard } from './-section-behavior.tsx';
import { ScenarioMapFinalWorkbench } from './-section-map.tsx';
import { ScenarioMetadataEditorCard } from './-section-metadata.tsx';
import { ScenarioObjectiveEditorCard } from './-section-objective.tsx';
import { ScenarioScriptEditorCard } from './-section-script.tsx';

export const Route = createFileRoute('/')({
  component: ScenarioEditorHomeRoute,
});

/**
 * Map-first Scenario Editor route with optional right sidebar inspectors.
 * Parity note: map authoring uses `MapCanvas` and C-derived tool logic from
 * `w_tool.c`/`w_sim.c`, while metadata/objective/script/behavior inspectors are
 * editor-only side panels.
 */
function ScenarioEditorHomeRoute() {
  const { activeView } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const sidebarOpen = activeView !== 'none';

  return (
    <section
      aria-label="Scenario editor workspace"
      className={`grid h-full min-h-0 overflow-hidden ${
        sidebarOpen ? 'grid-cols-[minmax(0,1fr)_clamp(20rem,32vw,34rem)]' : 'grid-cols-1'
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <ScenarioMapFinalWorkbench />
      </div>

      {sidebarOpen ? (
        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-l border-slate-400 bg-white">
          <header className="flex items-center justify-between border-b border-slate-300 px-3 py-2">
            <h2 className="m-0 text-[1.7rem] font-semibold">{getSidebarTitle(activeView)}</h2>
            <button
              aria-label="Close sidebar"
              className="grid h-8 w-8 cursor-pointer place-items-center rounded border border-slate-500 bg-slate-100 px-0 py-0 text-[1rem] leading-none"
              onClick={() => {
                dispatch({ type: 'set-active-view', view: 'none' });
              }}
              type="button"
            >
              X
            </button>
          </header>

          <div className="min-h-0 overflow-y-auto p-3 [&>section]:max-w-none [&>section]:rounded-none [&>section]:border-0 [&>section]:bg-transparent [&>section]:p-0 [&>section>h1]:hidden [&>section>p]:hidden">
            <ScenarioRightSidebarPanel view={activeView} />
          </div>
        </aside>
      ) : null}
    </section>
  );
}

function ScenarioRightSidebarPanel(options: {
  readonly view: Exclude<ScenarioEditorWorkbenchView, 'none'>;
}) {
  const { view } = options;

  if (view === 'metadata') {
    return <ScenarioMetadataEditorCard />;
  }
  if (view === 'objective') {
    return <ScenarioObjectiveEditorCard />;
  }
  if (view === 'script') {
    return <ScenarioScriptEditorCard />;
  }
  return <ScenarioBehaviorProfileEditorCard />;
}

function getSidebarTitle(view: Exclude<ScenarioEditorWorkbenchView, 'none'>): string {
  if (view === 'metadata') {
    return 'Metadata';
  }
  if (view === 'objective') {
    return 'Objectives';
  }
  if (view === 'script') {
    return 'Scripts';
  }
  return 'Behavior';
}
