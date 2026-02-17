import { ClassicyIconButton, ClassicyPanelChrome, ClassicyPanelTitle } from '@city/classicyui';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

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
  const sidebarRef = useRef<HTMLElement | null>(null);
  const [sidebarWidthPx, setSidebarWidthPx] = useState(0);

  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }

    const sidebarElement = sidebarRef.current;
    if (sidebarElement === null) {
      return;
    }

    const updateSidebarWidth = (): void => {
      setSidebarWidthPx(Math.max(0, Math.round(sidebarElement.getBoundingClientRect().width)));
    };

    updateSidebarWidth();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSidebarWidth);
      return () => {
        window.removeEventListener('resize', updateSidebarWidth);
      };
    }

    const observer = new ResizeObserver(() => {
      updateSidebarWidth();
    });
    observer.observe(sidebarElement);
    return () => {
      observer.disconnect();
    };
  }, [sidebarOpen, activeView]);

  return (
    <section
      aria-label="Scenario editor workspace"
      className="relative h-full min-h-0 overflow-hidden"
    >
      <div className="h-full min-h-0 overflow-hidden">
        <ScenarioMapFinalWorkbench rightSidebarOverlayWidthPx={sidebarOpen ? sidebarWidthPx : 0} />
      </div>

      {sidebarOpen ? (
        <ClassicyPanelChrome
          className="pointer-events-auto absolute right-0 top-0 z-20 grid h-full min-h-0 w-[clamp(20rem,32vw,34rem)] grid-rows-[auto_minmax(0,1fr)] !border-black !bg-[var(--color-system-02)] p-0"
          ref={sidebarRef}
        >
          <header className="flex items-center justify-between border-b border-solid [border-width:var(--window-border-size)] [border-color:var(--color-window-border)] bg-[var(--color-system-03)] px-3 py-2">
            <ClassicyPanelTitle className="m-0 [font-size:calc(var(--header-font-size)*0.95)]">
              {getSidebarTitle(activeView)}
            </ClassicyPanelTitle>
            <ClassicyIconButton
              ariaLabel="Close sidebar"
              className="h-8 w-8"
              icon="✕"
              onClick={() => {
                dispatch({ type: 'set-active-view', view: 'none' });
              }}
              srLabel="Close sidebar"
              type="button"
            />
          </header>

          <div className="min-h-0 overflow-y-auto p-3">
            <ScenarioRightSidebarPanel view={activeView} />
          </div>
        </ClassicyPanelChrome>
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
