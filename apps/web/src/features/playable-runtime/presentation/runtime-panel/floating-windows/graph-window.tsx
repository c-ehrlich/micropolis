import { ClassicyButton, ClassicyWindowFrame } from '@city/classicyui';

import { GraphWindowChart } from '../../runtime-panel-components.tsx';
import {
  CLASSICY_FLOATING_BUDGET_ROW_CLASS,
  GRAPH_SERIES_TOGGLES,
  HEAD_GRAPH_MASK_RCI,
} from '../runtime-panel-constants.ts';
import type {
  RuntimeFloatingWindowsController,
  RuntimeGraphActions,
  RuntimeSessionController,
  RuntimeUiController,
  RuntimeWindowActions,
} from '../runtime-panel-types.ts';

interface GraphWindowProps {
  floating: RuntimeFloatingWindowsController;
  graphActions: RuntimeGraphActions;
  graphMask: RuntimeUiController['graphMask'];
  graphRange: RuntimeUiController['graphRange'];
  session: RuntimeSessionController;
  windowActions: RuntimeWindowActions;
}

/**
 * Floating graph window for multi-series city metrics.
 * Mirrors graph controls and plotting from `ref/micropolis/src/sim/w_graph.c`.
 */
export function GraphWindow(props: GraphWindowProps) {
  const { floating, graphActions, graphMask, graphRange, session, windowActions } = props;
  const graphWindow = floating.floatingWindows.graph;

  if (!graphWindow.open) {
    return null;
  }

  return (
    <ClassicyWindowFrame
      bodyClassName="grid gap-1.5 p-2 text-xs"
      data-floating-window="graph"
      onClose={() => {
        windowActions.closeFloatingWindow('graph');
      }}
      onHeaderPointerDown={(event) => {
        windowActions.startFloatingWindowDrag('graph', event);
      }}
      onPointerDown={() => {
        windowActions.focusFloatingWindow('graph');
      }}
      className="min-w-70 max-w-[min(460px,calc(100vw-12px))]"
      style={{
        left: graphWindow.x,
        top: graphWindow.y,
        zIndex: graphWindow.zIndex,
      }}
      windowTitle="Graph"
    >
      <div className="grid grid-cols-2 gap-1">
        <ClassicyButton
          onClick={() => {
            graphActions.setGraphRange(10);
          }}
          className="text-[11px]"
          style={{
            background: graphRange === 10 ? 'var(--color-theme-03)' : undefined,
          }}
          type="button"
        >
          10 Years
        </ClassicyButton>
        <ClassicyButton
          onClick={() => {
            graphActions.setGraphRange(120);
          }}
          className="text-[11px]"
          style={{
            background: graphRange === 120 ? 'var(--color-theme-03)' : undefined,
          }}
          type="button"
        >
          120 Years
        </ClassicyButton>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {GRAPH_SERIES_TOGGLES.map((series) => (
          <ClassicyButton
            key={series.bit}
            onClick={() => {
              graphActions.toggleGraphSeriesBit(series.bit);
            }}
            className="flex items-center justify-between gap-1 text-[11px]"
            style={{
              background: (graphMask & series.bit) !== 0 ? 'var(--color-theme-03)' : undefined,
            }}
            type="button"
          >
            <span>{series.label}</span>
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 border border-black"
              style={{ background: series.color }}
            />
          </ClassicyButton>
        ))}
      </div>
      <GraphWindowChart graph={session.state.hudState.graph} mask={graphMask} range={graphRange} />
      <div className={`${CLASSICY_FLOATING_BUDGET_ROW_CLASS} text-[11px]`}>
        <span>Visible series</span>
        <strong>
          {GRAPH_SERIES_TOGGLES.filter((series) => (graphMask & series.bit) !== 0).length}/
          {GRAPH_SERIES_TOGGLES.length}
        </strong>
      </div>
      <div className="flex justify-between gap-1">
        <ClassicyButton
          onClick={() => {
            graphActions.setGraphMask(HEAD_GRAPH_MASK_RCI);
            graphActions.setGraphRange(10);
          }}
          className="text-[11px]"
          type="button"
        >
          Reset to R/C/I
        </ClassicyButton>
        <ClassicyButton
          onClick={() => {
            graphActions.showAllGraphSeries();
          }}
          className="text-[11px]"
          type="button"
        >
          Show All
        </ClassicyButton>
      </div>
    </ClassicyWindowFrame>
  );
}
