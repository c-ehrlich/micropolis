import type { MutableRefObject } from 'react';

import type {
  RuntimeBudgetActions,
  RuntimeBudgetState,
  RuntimeFloatingWindowsController,
  RuntimeGraphActions,
  RuntimeSessionController,
  RuntimeUiController,
  RuntimeWindowActions,
} from '../runtime-panel-types.ts';
import { BudgetWindow } from './budget-window.tsx';
import { EvaluationWindow } from './evaluation-window.tsx';
import { GraphWindow } from './graph-window.tsx';

interface RuntimeFloatingWindowsLayerProps {
  applyBudgetControlState: (nextBudgetState: RuntimeBudgetState) => void;
  budgetActions: RuntimeBudgetActions;
  budgetWindowOriginalStateRef: MutableRefObject<RuntimeBudgetState>;
  floating: RuntimeFloatingWindowsController;
  graphActions: RuntimeGraphActions;
  graphMask: RuntimeUiController['graphMask'];
  graphRange: RuntimeUiController['graphRange'];
  session: RuntimeSessionController;
  sessionControlsDisabled: boolean;
  windowActions: RuntimeWindowActions;
}

/**
 * Floating window layer for budget/evaluation/graph windows.
 * Mirrors independent top-level runtime windows from
 * `ref/micropolis/src/sim/w_budget.c`, `w_eval.c`, and `w_graph.c`.
 */
export function RuntimeFloatingWindowsLayer(props: RuntimeFloatingWindowsLayerProps) {
  const {
    applyBudgetControlState,
    budgetActions,
    budgetWindowOriginalStateRef,
    floating,
    graphActions,
    graphMask,
    graphRange,
    session,
    sessionControlsDisabled,
    windowActions,
  } = props;

  return (
    <section className="pointer-events-none absolute inset-0 z-9">
      <BudgetWindow
        applyBudgetControlState={applyBudgetControlState}
        budgetActions={budgetActions}
        budgetWindowOriginalStateRef={budgetWindowOriginalStateRef}
        floating={floating}
        session={session}
        sessionControlsDisabled={sessionControlsDisabled}
        windowActions={windowActions}
      />
      <EvaluationWindow floating={floating} session={session} windowActions={windowActions} />
      <GraphWindow
        floating={floating}
        graphActions={graphActions}
        graphMask={graphMask}
        graphRange={graphRange}
        session={session}
        windowActions={windowActions}
      />
    </section>
  );
}
