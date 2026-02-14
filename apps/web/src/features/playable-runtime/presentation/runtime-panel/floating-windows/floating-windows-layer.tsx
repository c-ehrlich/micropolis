import type { MutableRefObject } from 'react';

import type {
  RuntimeBudgetState,
  RuntimeFloatingWindowsController,
  RuntimePanelActions,
  RuntimeSessionController,
  RuntimeUiController,
} from '../runtime-panel-types.ts';
import { BudgetWindow } from './budget-window.tsx';
import { EvaluationWindow } from './evaluation-window.tsx';
import { GraphWindow } from './graph-window.tsx';

interface RuntimeFloatingWindowsLayerProps {
  actions: RuntimePanelActions;
  applyBudgetControlState: (nextBudgetState: RuntimeBudgetState) => void;
  budgetWindowOriginalStateRef: MutableRefObject<RuntimeBudgetState>;
  floating: RuntimeFloatingWindowsController;
  graphMask: RuntimeUiController['graphMask'];
  graphRange: RuntimeUiController['graphRange'];
  session: RuntimeSessionController;
  sessionControlsDisabled: boolean;
}

/**
 * Floating window layer for budget/evaluation/graph windows.
 * Mirrors independent top-level runtime windows from
 * `ref/micropolis/src/sim/w_budget.c`, `w_eval.c`, and `w_graph.c`.
 */
export function RuntimeFloatingWindowsLayer(props: RuntimeFloatingWindowsLayerProps) {
  const {
    actions,
    applyBudgetControlState,
    budgetWindowOriginalStateRef,
    floating,
    graphMask,
    graphRange,
    session,
    sessionControlsDisabled,
  } = props;

  return (
    <>
      <BudgetWindow
        actions={actions}
        applyBudgetControlState={applyBudgetControlState}
        budgetWindowOriginalStateRef={budgetWindowOriginalStateRef}
        floating={floating}
        session={session}
        sessionControlsDisabled={sessionControlsDisabled}
      />
      <EvaluationWindow actions={actions} floating={floating} session={session} />
      <GraphWindow
        actions={actions}
        floating={floating}
        graphMask={graphMask}
        graphRange={graphRange}
        session={session}
      />
    </>
  );
}
