import type { MutableRefObject } from 'react';

import type {
  RuntimeBudgetState,
  RuntimeFloatingWindowsController,
  RuntimeSessionController,
  RuntimeUiController,
} from '../runtime-panel-types.ts';
import { BudgetWindow } from './budget-window.tsx';
import { EvaluationWindow } from './evaluation-window.tsx';
import { GraphWindow } from './graph-window.tsx';

interface RuntimeFloatingWindowsLayerProps {
  applyBudgetControlState: (nextBudgetState: RuntimeBudgetState) => void;
  budgetWindowOriginalStateRef: MutableRefObject<RuntimeBudgetState>;
  floating: RuntimeFloatingWindowsController;
  session: RuntimeSessionController;
  sessionControlsDisabled: boolean;
  ui: RuntimeUiController;
}

/**
 * Floating window layer for budget/evaluation/graph windows.
 * Mirrors independent top-level runtime windows from
 * `ref/micropolis/src/sim/w_budget.c`, `w_eval.c`, and `w_graph.c`.
 */
export function RuntimeFloatingWindowsLayer(props: RuntimeFloatingWindowsLayerProps) {
  const {
    applyBudgetControlState,
    budgetWindowOriginalStateRef,
    floating,
    session,
    sessionControlsDisabled,
    ui,
  } = props;

  return (
    <>
      <BudgetWindow
        applyBudgetControlState={applyBudgetControlState}
        budgetWindowOriginalStateRef={budgetWindowOriginalStateRef}
        floating={floating}
        session={session}
        sessionControlsDisabled={sessionControlsDisabled}
      />
      <EvaluationWindow floating={floating} session={session} />
      <GraphWindow floating={floating} session={session} ui={ui} />
    </>
  );
}
