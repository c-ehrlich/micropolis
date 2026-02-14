import { ClassicyButton, ClassicyRange, ClassicyWindowFrame } from '@city/classicyui';
import type { MutableRefObject } from 'react';

import {
  CLASSICY_FLOATING_BUDGET_ROW_CLASS,
  CLASSICY_MESSAGE_SURFACE_CHROME,
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

  const budget = session.state.hudState.budget;
  const displayedDateLabel = session.state.hudState.dateDisplayLabel.replace(/^Date:\s*/u, '');
  const fiscalYear = /\b(\d{4})\b/u.exec(displayedDateLabel)?.[1] ?? displayedDateLabel;
  const fundingExpenses = budget.roadGot + budget.fireGot + budget.policeGot;
  const projectedFunds = budget.totalFunds + budget.cashFlow;

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
      className="min-w-88 max-w-[min(660px,calc(100vw-12px))]"
      style={{
        left: budgetWindow.x,
        top: budgetWindow.y,
        zIndex: budgetWindow.zIndex,
      }}
      windowTitle={`${fiscalYear} Fiscal Budget`}
    >
      <section className={`${CLASSICY_MESSAGE_SURFACE_CHROME} grid gap-1.5 p-2`}>
        <div className="flex items-center gap-2">
          <strong>Tax Rate ({budget.taxRate}%)</strong>
          <button
            aria-label="Tax rate help placeholder"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-black)] bg-[var(--color-system-02)] text-[12px] font-bold leading-none"
            title="Tax Rate tooltip placeholder"
            type="button"
          >
            ?
          </button>
        </div>
        <ClassicyRange
          disabled={sessionControlsDisabled}
          max={20}
          min={0}
          onChange={(event) => {
            budgetActions.setBudgetTaxRate(Math.trunc(Number(event.currentTarget.value)));
          }}
          value={budget.taxRate}
          className="accent-sky-700"
        />
      </section>
      <section
        className={`${CLASSICY_MESSAGE_SURFACE_CHROME} grid overflow-hidden [grid-template-columns:minmax(0,1fr)] md:[grid-template-columns:minmax(0,1.05fr)_minmax(0,1fr)]`}
      >
        <div className="grid content-start gap-3 p-2 [border-bottom:var(--window-border-size)_solid_var(--color-window-border)] md:[border-bottom:0] md:[border-right:var(--window-border-size)_solid_var(--color-window-border)]">
          <label className="grid gap-0.5">
            <strong>Road Funding Level: {budget.roadPercent}%</strong>
            <span className="[color:color-mix(in_srgb,var(--color-black)_58%,transparent)]">
              {formatBudgetAmount(budget.roadGot)} ({formatBudgetAmount(budget.roadWant)} Requested)
            </span>
            <ClassicyRange
              disabled={sessionControlsDisabled}
              max={100}
              min={0}
              onChange={(event) => {
                budgetActions.setBudgetRoadPercent(Math.trunc(Number(event.currentTarget.value)));
              }}
              value={budget.roadPercent}
              className="accent-sky-700"
            />
          </label>
          <label className="grid gap-0.5">
            <strong>Fire Funding Level: {budget.firePercent}%</strong>
            <span className="[color:color-mix(in_srgb,var(--color-black)_58%,transparent)]">
              {formatBudgetAmount(budget.fireGot)} ({formatBudgetAmount(budget.fireWant)} Requested)
            </span>
            <ClassicyRange
              disabled={sessionControlsDisabled}
              max={100}
              min={0}
              onChange={(event) => {
                budgetActions.setBudgetFirePercent(Math.trunc(Number(event.currentTarget.value)));
              }}
              value={budget.firePercent}
              className="accent-sky-700"
            />
          </label>
          <label className="grid gap-0.5">
            <strong>Police Funding Level: {budget.policePercent}%</strong>
            <span className="[color:color-mix(in_srgb,var(--color-black)_58%,transparent)]">
              {formatBudgetAmount(budget.policeGot)} ({formatBudgetAmount(budget.policeWant)}{' '}
              Requested)
            </span>
            <ClassicyRange
              disabled={sessionControlsDisabled}
              max={100}
              min={0}
              onChange={(event) => {
                budgetActions.setBudgetPolicePercent(Math.trunc(Number(event.currentTarget.value)));
              }}
              value={budget.policePercent}
              className="accent-sky-700"
            />
          </label>
          <div className="flex justify-end pt-1">
            <ClassicyButton
              disabled={sessionControlsDisabled}
              onClick={() => {
                applyBudgetControlState(budgetWindowOriginalStateRef.current);
              }}
              type="button"
            >
              Reset
            </ClassicyButton>
          </div>
        </div>
        <div className="grid content-between gap-4 p-2">
          <div className="grid gap-1.5">
            <div className={CLASSICY_FLOATING_BUDGET_ROW_CLASS}>
              <span>Current Funds</span>
              <strong>{formatBudgetAmount(budget.totalFunds)}</strong>
            </div>
            <div className="h-px w-full bg-[color-mix(in_srgb,var(--color-black)_32%,transparent)]" />
            <div className={CLASSICY_FLOATING_BUDGET_ROW_CLASS}>
              <span>Taxes Collected</span>
              <strong>{formatBudgetAmount(budget.taxFund)}</strong>
            </div>
            <div className={CLASSICY_FLOATING_BUDGET_ROW_CLASS}>
              <span>Expenses (Funding)</span>
              <strong>{formatBudgetAmount(fundingExpenses)}</strong>
            </div>
            <div className="h-px w-full bg-[color-mix(in_srgb,var(--color-black)_32%,transparent)]" />
            <div className={CLASSICY_FLOATING_BUDGET_ROW_CLASS}>
              <span>Cash Flow</span>
              <strong
                className={
                  budget.cashFlow >= 0
                    ? 'text-emerald-700'
                    : '[color:color-mix(in_srgb,#9a1d1d_88%,var(--color-black))]'
                }
              >
                {formatSignedBudgetAmount(budget.cashFlow)}
              </strong>
            </div>
          </div>
          <div className="grid gap-3">
            <div className={CLASSICY_FLOATING_BUDGET_ROW_CLASS}>
              <span>Projected Funds</span>
              <strong>{formatBudgetAmount(projectedFunds)}</strong>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <strong>Auto Budget</strong>
                <button
                  aria-label="Auto budget help placeholder"
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-black)] bg-[var(--color-system-02)] text-[12px] font-bold leading-none"
                  title="Auto Budget tooltip placeholder"
                  type="button"
                >
                  ?
                </button>
              </div>
              <button
                aria-label={budget.autoBudget ? 'Disable auto budget' : 'Enable auto budget'}
                disabled={sessionControlsDisabled}
                onClick={() => {
                  budgetActions.setBudgetAuto(!budget.autoBudget);
                }}
                className={`relative flex h-7 w-14 items-center border border-[var(--color-window-border)] p-1 transition-colors ${
                  budget.autoBudget
                    ? '[background:color-mix(in_srgb,#8fb3d2_75%,var(--color-system-02))]'
                    : 'bg-[var(--color-system-03)]'
                }`}
                type="button"
              >
                <span
                  aria-hidden
                  className={`h-[19px] w-[19px] border border-[var(--color-black)] bg-[var(--color-system-01)] transition-transform ${
                    budget.autoBudget ? 'translate-x-6' : ''
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </section>
      <div className="flex justify-end gap-2">
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
        <ClassicyButton
          onClick={() => {
            windowActions.closeFloatingWindow('budget');
          }}
          isDefault
          type="button"
        >
          Save &amp; Continue
        </ClassicyButton>
      </div>
    </ClassicyWindowFrame>
  );
}
