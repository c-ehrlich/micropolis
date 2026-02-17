import { ClassicyButton, ClassicyMenuPanel, getAllThemes, getThemeVars } from '@city/classicyui';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';

import {
  SCENARIO_EDITOR_MVP_VIEWS,
  ScenarioEditorStateProvider,
  type ScenarioEditorWorkbenchView,
  useScenarioEditorDispatch,
  useScenarioEditorState,
} from '../state/editor-state.tsx';
import { ScenarioFileMenuContent } from './-section-export.tsx';

const CLASSICY_MENU_BUTTON_ACTIVE_CLASS = '!text-[var(--color-white)] !bg-[var(--color-theme-04)]';

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
 * Not from Micropolis C: this is React-only app chrome with one top bar and
 * map-first workspace framing.
 */
function EditorShell() {
  const runtimeTheme = useMemo<CSSProperties>(() => {
    const theme = getAllThemes()[0];
    return theme === undefined ? {} : (getThemeVars(theme) as CSSProperties);
  }, []);

  return (
    <div
      className="grid h-screen [height:100dvh] grid-rows-[auto_1fr] overflow-hidden bg-[var(--color-system-02)] text-[var(--color-black)] [font-family:var(--ui-font),sans-serif] [font-size:var(--ui-font-size)] leading-[1.4]"
      style={runtimeTheme}
    >
      <EditorTopBar />
      <main className="min-h-0 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

function EditorTopBar() {
  const { activeView } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const fileMenuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!fileMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) {
        setFileMenuOpen(false);
        return;
      }
      if (fileMenuContainerRef.current?.contains(target)) {
        return;
      }
      setFileMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') {
        return;
      }
      setFileMenuOpen(false);
    }

    function handleResize(): void {
      setFileMenuOpen(false);
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', handleResize);
    };
  }, [fileMenuOpen]);

  return (
    <header className="flex min-h-[3.2rem] items-center justify-between gap-2 border-b border-solid [border-width:var(--window-border-size)] [border-color:var(--color-window-border)] bg-[var(--color-system-02)] px-3 py-2">
      <div className="relative" ref={fileMenuContainerRef}>
        <ClassicyButton
          active={fileMenuOpen}
          activeClassName={CLASSICY_MENU_BUTTON_ACTIVE_CLASS}
          className={`!m-0 min-w-[6.5rem] px-4 py-1.5 ${fileMenuOpen ? CLASSICY_MENU_BUTTON_ACTIVE_CLASS : ''}`}
          onClick={() => {
            setFileMenuOpen((current) => !current);
          }}
          type="button"
        >
          File
        </ClassicyButton>
        {fileMenuOpen ? (
          <ClassicyMenuPanel className="absolute left-0 top-[calc(100%+4px)] z-30 w-[min(34rem,92vw)] max-h-[min(78vh,52rem)] overflow-y-auto p-3">
            <ScenarioFileMenuContent compact />
          </ClassicyMenuPanel>
        ) : null}
      </div>

      <nav aria-label="Scenario editor side panels" className="ml-auto flex items-center gap-2">
        {SCENARIO_EDITOR_MVP_VIEWS.map((view) => {
          const selected = activeView === view;
          return (
            <ClassicyButton
              active={selected}
              activeClassName={CLASSICY_MENU_BUTTON_ACTIVE_CLASS}
              className="!m-0 min-w-[8.25rem] px-3 py-1.5"
              key={view}
              onClick={() => {
                if (selected) {
                  return;
                }
                dispatch({ type: 'set-active-view', view });
              }}
              type="button"
            >
              {getScenarioEditorWorkbenchViewLabel(view)}
            </ClassicyButton>
          );
        })}
      </nav>
    </header>
  );
}

function getScenarioEditorWorkbenchViewLabel(
  view: Exclude<ScenarioEditorWorkbenchView, 'none'>,
): string {
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
