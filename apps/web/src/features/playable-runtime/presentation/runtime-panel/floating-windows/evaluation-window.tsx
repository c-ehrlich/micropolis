import { ClassicyButton, ClassicyPanelTitle, ClassicyWindowFrame } from '@city/classicyui';

import {
  CLASSICY_FLOATING_BUDGET_ROW_CLASS,
  CLASSICY_MESSAGE_SURFACE_CHROME,
} from '../runtime-panel-constants.ts';
import type {
  RuntimeFloatingWindowsController,
  RuntimeSessionController,
} from '../runtime-panel-types.ts';

interface EvaluationWindowProps {
  floating: RuntimeFloatingWindowsController;
  session: RuntimeSessionController;
}

/**
 * Floating evaluation window for public-opinion and city-score views.
 * Mirrors evaluation window behavior in `ref/micropolis/src/sim/w_eval.c`.
 */
export function EvaluationWindow(props: EvaluationWindowProps) {
  const { floating, session } = props;
  const evaluationWindow = floating.floatingWindows.evaluation;

  if (!evaluationWindow.open) {
    return null;
  }

  const yesPercentValueRaw = Number.parseInt(session.state.hudState.evaluation.yesPercent, 10);
  const yesPercentValue = Number.isFinite(yesPercentValueRaw)
    ? Math.max(0, Math.min(yesPercentValueRaw, 100))
    : 0;
  const noPercentValueRaw = Number.parseInt(session.state.hudState.evaluation.noPercent, 10);
  const noPercentValue = Number.isFinite(noPercentValueRaw)
    ? Math.max(0, Math.min(noPercentValueRaw, 100))
    : 0;
  const opinionTotalPercent = yesPercentValue + noPercentValue;
  const opinionYesChartWidthPercent =
    opinionTotalPercent > 0 ? (yesPercentValue / opinionTotalPercent) * 100 : 50;
  const opinionNoChartWidthPercent =
    opinionTotalPercent > 0 ? (noPercentValue / opinionTotalPercent) * 100 : 50;

  return (
    <ClassicyWindowFrame
      bodyClassName="grid gap-1.5 p-2 text-xs"
      data-floating-window="evaluation"
      onClose={() => {
        floating.closeFloatingWindow('evaluation');
      }}
      onHeaderPointerDown={(event) => {
        floating.startFloatingWindowDrag('evaluation', event);
      }}
      onPointerDown={() => {
        floating.focusFloatingWindow('evaluation');
      }}
      className="min-w-70 max-w-[min(460px,calc(100vw-12px))]"
      style={{
        left: evaluationWindow.x,
        top: evaluationWindow.y,
        zIndex: evaluationWindow.zIndex,
      }}
      windowTitle="Evaluation"
    >
      <ClassicyPanelTitle className="text-center text-xs">
        {session.state.hudState.evaluation.title}
      </ClassicyPanelTitle>
      <div className="grid gap-2 md:grid-cols-2">
        <section className={`${CLASSICY_MESSAGE_SURFACE_CHROME} grid gap-1 p-1.5`}>
          <strong className="text-[11px]">Public Opinion</strong>
          <div className="text-[11px]">Is the mayor doing a good job?</div>
          <div
            className={`${CLASSICY_MESSAGE_SURFACE_CHROME} relative h-5 overflow-hidden`}
            role="img"
            aria-label={`Public opinion: yes ${session.state.hudState.evaluation.yesPercent}, no ${session.state.hudState.evaluation.noPercent}`}
          >
            <div className="flex h-full w-full">
              <div
                className="h-full shrink-0 [background:color-mix(in_srgb,#6fbf7c_72%,var(--color-system-03))]"
                style={{ width: `${opinionYesChartWidthPercent}%` }}
              />
              <div
                className="h-full shrink-0 [border-left:var(--window-border-size)_solid_color-mix(in_srgb,var(--color-black)_45%,transparent)] [background:color-mix(in_srgb,#d78686_74%,var(--color-system-03))]"
                style={{ width: `${opinionNoChartWidthPercent}%` }}
              />
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-1">
              <strong className="text-[11px] leading-none [color:color-mix(in_srgb,var(--color-black)_92%,#101010)]">
                Yes {session.state.hudState.evaluation.yesPercent}
              </strong>
              <strong className="text-[11px] leading-none [color:color-mix(in_srgb,var(--color-black)_92%,#101010)]">
                No {session.state.hudState.evaluation.noPercent}
              </strong>
            </div>
          </div>
          <strong className="mt-1 text-[11px]">Worst Problems</strong>
          {session.state.hudState.evaluation.problems.map((problem, index) => (
            <div
              key={`evaluation-problem-${index}`}
              className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}
            >
              <span>{problem.name}</span>
              <strong>{problem.percent}</strong>
            </div>
          ))}
        </section>
        <section className={`${CLASSICY_MESSAGE_SURFACE_CHROME} grid gap-1 p-1.5`}>
          <strong className="text-[11px]">Statistics</strong>
          <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
            <span>Population</span>
            <strong>{session.state.hudState.evaluation.population}</strong>
          </div>
          <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
            <span>Net Migration (last year)</span>
            <strong>{session.state.hudState.evaluation.populationDelta}</strong>
          </div>
          <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
            <span>Assessed Value</span>
            <strong>{session.state.hudState.evaluation.assessedValue}</strong>
          </div>
          <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
            <span>Category</span>
            <strong>{session.state.hudState.evaluation.cityClass}</strong>
          </div>
          <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
            <span>Game Level</span>
            <strong>{session.state.hudState.evaluation.cityLevel}</strong>
          </div>
          <strong className="mt-1 text-[11px]">Overall City Score (0 - 1000)</strong>
          <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
            <span>Current Score</span>
            <strong>{session.state.hudState.evaluation.score}</strong>
          </div>
          <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
            <span>Annual Change</span>
            <strong>{session.state.hudState.evaluation.scoreDelta}</strong>
          </div>
        </section>
      </div>
      <div className="flex justify-center">
        <ClassicyButton
          onClick={() => {
            floating.closeFloatingWindow('evaluation');
          }}
          type="button"
        >
          Dismiss Evaluation
        </ClassicyButton>
      </div>
    </ClassicyWindowFrame>
  );
}
