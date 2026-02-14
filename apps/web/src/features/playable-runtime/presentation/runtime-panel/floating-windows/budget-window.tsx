import { ClassicyButton, ClassicyRange, ClassicyWindowFrame } from '@city/classicyui';
import type { MutableRefObject } from 'react';

import {
  CLASSICY_FLOATING_BUDGET_ROW_CLASS,
  formatBudgetAmount,
  formatSignedBudgetAmount,
} from '../runtime-panel-constants.ts';
import type {
  RuntimeBudgetActions,
  RuntimeBudgetState,
  RuntimeFloatingWindowsController,
  RuntimeSessionController,
  RuntimeWindowActions,
} from '../runtime-panel-types.ts';

interface BudgetWindowProps {
  applyBudgetControlState: (nextBudgetState: RuntimeBudgetState) => void;
  budgetActions: RuntimeBudgetActions;
  budgetWindowOriginalStateRef: MutableRefObject<RuntimeBudgetState>;
  floating: RuntimeFloatingWindowsController;
  session: RuntimeSessionController;
  sessionControlsDisabled: boolean;
  windowActions: RuntimeWindowActions;
}

/**
 * Floating budget window for tax/fund controls.
 * Mirrors budget panel behavior in `ref/micropolis/src/sim/w_budget.c`.
 */
export function BudgetWindow(props: BudgetWindowProps) {
  const {
    applyBudgetControlState,
    budgetActions,
    budgetWindowOriginalStateRef,
    floating,
    session,
    sessionControlsDisabled,
    windowActions,
  } = props;
  const budgetWindow = floating.floatingWindows.budget;

  if (!budgetWindow.open) {
    return null;
  }

  return (
    <ClassicyWindowFrame
      bodyClassName="grid gap-2 p-2 text-xs"
      data-floating-window="budget"
      onClose={() => {
        windowActions.closeFloatingWindow('budget');
      }}
      onHeaderPointerDown={(event) => {
        windowActions.startFloatingWindowDrag('budget', event);
      }}
      onPointerDown={() => {
        windowActions.focusFloatingWindow('budget');
      }}
      className="min-w-88 max-w-[min(520px,calc(100vw-12px))]"
      style={{
        left: budgetWindow.x,
        top: budgetWindow.y,
        zIndex: budgetWindow.zIndex,
      }}
      windowTitle="Budget"
    >
      <div className="grid gap-1.5 md:grid-cols-2">
        <div className="grid gap-1">
          <div className={CLASSICY_FLOATING_BUDGET_ROW_CLASS}>
            <span>Taxes Collected</span>
            <strong>{formatBudgetAmount(session.state.hudState.budget.taxFund)}</strong>
          </div>
          <div className={CLASSICY_FLOATING_BUDGET_ROW_CLASS}>
            <span>Cash Flow</span>
            <strong>{formatSignedBudgetAmount(session.state.hudState.budget.cashFlow)}</strong>
          </div>
          <div className={CLASSICY_FLOATING_BUDGET_ROW_CLASS}>
            <span>Previous Funds</span>
            <strong>{formatBudgetAmount(session.state.hudState.budget.totalFunds)}</strong>
          </div>
          <div className={CLASSICY_FLOATING_BUDGET_ROW_CLASS}>
            <span>Current Funds</span>
            <strong>
              {formatBudgetAmount(
                session.state.hudState.budget.totalFunds + session.state.hudState.budget.cashFlow,
              )}
            </strong>
          </div>
        </div>
        <div className="grid gap-1.5">
          <label className="grid gap-0.5">
            <span>Road Fund ({session.state.hudState.budget.roadPercent}%)</span>
            <span className="text-[11px] text-slate-700">
              {formatBudgetAmount(session.state.hudState.budget.roadGot)} /{' '}
              {formatBudgetAmount(session.state.hudState.budget.roadWant)}
            </span>
            <ClassicyRange
              disabled={sessionControlsDisabled}
              max={100}
              min={0}
              onChange={(event) => {
                budgetActions.setBudgetRoadPercent(Math.trunc(Number(event.currentTarget.value)));
              }}
              value={session.state.hudState.budget.roadPercent}
            />
          </label>
          <label className="grid gap-0.5">
            <span>Fire Fund ({session.state.hudState.budget.firePercent}%)</span>
            <span className="text-[11px] text-slate-700">
              {formatBudgetAmount(session.state.hudState.budget.fireGot)} /{' '}
              {formatBudgetAmount(session.state.hudState.budget.fireWant)}
            </span>
            <ClassicyRange
              disabled={sessionControlsDisabled}
              max={100}
              min={0}
              onChange={(event) => {
                budgetActions.setBudgetFirePercent(Math.trunc(Number(event.currentTarget.value)));
              }}
              value={session.state.hudState.budget.firePercent}
            />
          </label>
          <label className="grid gap-0.5">
            <span>Police Fund ({session.state.hudState.budget.policePercent}%)</span>
            <span className="text-[11px] text-slate-700">
              {formatBudgetAmount(session.state.hudState.budget.policeGot)} /{' '}
              {formatBudgetAmount(session.state.hudState.budget.policeWant)}
            </span>
            <ClassicyRange
              disabled={sessionControlsDisabled}
              max={100}
              min={0}
              onChange={(event) => {
                budgetActions.setBudgetPolicePercent(Math.trunc(Number(event.currentTarget.value)));
              }}
              value={session.state.hudState.budget.policePercent}
            />
          </label>
          <label className="grid gap-0.5">
            <span>Tax Rate ({session.state.hudState.budget.taxRate}%)</span>
            <ClassicyRange
              disabled={sessionControlsDisabled}
              max={20}
              min={0}
              onChange={(event) => {
                budgetActions.setBudgetTaxRate(Math.trunc(Number(event.currentTarget.value)));
              }}
              value={session.state.hudState.budget.taxRate}
            />
          </label>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ClassicyButton
          disabled={sessionControlsDisabled}
          onClick={() => {
            budgetActions.setBudgetAuto(!session.state.hudState.budget.autoBudget);
          }}
          type="button"
        >
          {session.state.hudState.budget.autoBudget ? 'Disable Auto Budget' : 'Enable Auto Budget'}
        </ClassicyButton>
        <div className="flex flex-wrap justify-end gap-2">
          <ClassicyButton
            onClick={() => {
              windowActions.closeFloatingWindow('budget');
            }}
            type="button"
          >
            Continue
          </ClassicyButton>
          <ClassicyButton
            disabled={sessionControlsDisabled}
            onClick={() => {
              applyBudgetControlState(budgetWindowOriginalStateRef.current);
            }}
            type="button"
          >
            Reset
          </ClassicyButton>
          <ClassicyButton
            disabled={sessionControlsDisabled}
            onClick={() => {
              applyBudgetControlState(budgetWindowOriginalStateRef.current);
              windowActions.closeFloatingWindow('budget');
            }}
            type="button"
          >
            Cancel
          </ClassicyButton>
        </div>
      </div>
    </ClassicyWindowFrame>
  );
}
