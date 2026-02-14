import { ClassicyButton, ClassicyPanelChrome, ClassicyStatRow } from '@city/classicyui';
import type { RefObject } from 'react';

import { resolveSimUiToolIconAssetLookup } from '../../../../../../../../packages/sim-assets/src/sim-ui.ts';
import { PLAYABLE_TOOL_SPECS } from '../../../../../game/runtime/index.ts';
import { DemandHeadsWidget, GraphPreviewWidget } from '../../runtime-panel-components.tsx';
import {
  CLASSICY_WINDOW_LAUNCHER_BUTTON_CLASS,
  HEAD_GRAPH_MASK_RCI,
  PLAYABLE_TOOL_ICON_URL_BY_BASENAME,
} from '../runtime-panel-constants.ts';
import type {
  RuntimePanelActions,
  RuntimeSessionController,
  RuntimeUiController,
} from '../runtime-panel-types.ts';

interface RuntimeSidebarSectionProps {
  actions: RuntimePanelActions;
  session: RuntimeSessionController;
  sessionControlsDisabled: boolean;
  sidebarRef: RefObject<HTMLElement | null>;
  topInsetPx: number;
  ui: RuntimeUiController;
}

/**
 * Left tool-and-status sidebar for active city interactions.
 * Mirrors tool palette and head/stat strips from
 * `ref/micropolis/src/sim/w_tool.c` and `ref/micropolis/src/sim/w_update.c`.
 * Difference: icon resolution and window launchers are React components.
 */
export function RuntimeSidebarSection(props: RuntimeSidebarSectionProps) {
  const { actions, session, sessionControlsDisabled, sidebarRef, topInsetPx, ui } = props;

  return (
    <ClassicyPanelChrome
      ref={sidebarRef}
      className="pointer-events-auto absolute bottom-0 left-0 z-6 grid w-(--runtime-sidebar-width) content-start gap-1.5 overflow-x-hidden overflow-y-auto px-2 py-3"
      style={{ top: topInsetPx }}
    >
      <div className="mx-auto grid grid-cols-2 justify-center gap-x-1.5 gap-y-1">
        {PLAYABLE_TOOL_SPECS.map((spec) => {
          const active = ui.activeTool === spec.tool;
          const iconLookup = resolveSimUiToolIconAssetLookup(spec.toolState, {
            highlighted: active,
          });
          const iconBasename = iconLookup?.derivedPngPath?.split('/').pop();
          const iconUrl =
            iconBasename === undefined
              ? undefined
              : PLAYABLE_TOOL_ICON_URL_BY_BASENAME.get(iconBasename);

          return (
            <ClassicyButton
              key={spec.tool}
              disabled={sessionControlsDisabled}
              buttonShape="square"
              buttonSize="small"
              onClick={() => {
                actions.selectTool(spec.tool);
              }}
              title={`${spec.label} ($${spec.baseCost})`}
              type="button"
              className={`!m-0 flex h-9 min-h-9 max-h-9 w-9 min-w-9 max-w-9 items-center justify-center border-2 p-0 ${
                active
                  ? '!border-[var(--color-theme-07)] !bg-[var(--color-theme-03)]'
                  : '!border-[var(--color-black)] !bg-[var(--color-system-02)]'
              } ${sessionControlsDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              {iconUrl === undefined ? (
                <span className="[font-family:var(--ui-font),sans-serif] [font-size:calc(var(--ui-font-size)*0.75)] text-[var(--color-black)] font-bold">
                  {spec.label.slice(0, 2).toUpperCase()}
                </span>
              ) : (
                <span className="flex h-8 w-8 items-center justify-center">
                  <img
                    alt={`${spec.label} tool`}
                    draggable={false}
                    src={iconUrl}
                    className="block h-full w-full object-contain [image-rendering:pixelated]"
                  />
                </span>
              )}
            </ClassicyButton>
          );
        })}
      </div>
      <div className="grid gap-1">
        <ClassicyButton
          onClick={() => {
            actions.openFloatingWindow('evaluation');
          }}
          className={CLASSICY_WINDOW_LAUNCHER_BUTTON_CLASS}
          title="Open Evaluation Window"
          type="button"
        >
          <DemandHeadsWidget
            demandC={session.state.hudState.demandC}
            demandI={session.state.hudState.demandI}
            demandR={session.state.hudState.demandR}
          />
        </ClassicyButton>
        <ClassicyButton
          onClick={() => {
            actions.openFloatingWindow('graph');
          }}
          className={CLASSICY_WINDOW_LAUNCHER_BUTTON_CLASS}
          title="Open Graph Window"
          type="button"
        >
          <GraphPreviewWidget
            graph={session.state.hudState.graph}
            mask={HEAD_GRAPH_MASK_RCI}
            range={10}
          />
        </ClassicyButton>
      </div>
      <div className="grid min-w-0 content-start auto-rows-max gap-y-1 text-[11px]">
        <button
          onClick={() => {
            actions.openFloatingWindow('budget');
          }}
          className={`${CLASSICY_WINDOW_LAUNCHER_BUTTON_CLASS} grid gap-y-1 text-inherit [font:inherit] text-left`}
          title="Open Budget Window"
          type="button"
        >
          <ClassicyStatRow
            label="Funds"
            value={session.state.hudState.fundsLabel.replace(/^Funds:\s*/u, '')}
          />
          <ClassicyStatRow label="Tax" value={`${session.state.hudState.budget.taxRate}%`} />
        </button>
        <ClassicyStatRow
          label="Date"
          value={session.state.hudState.dateDisplayLabel.replace(/^Date:\s*/u, '')}
        />
        <ClassicyStatRow
          label="Population"
          value={session.state.hudState.cityPopulation.toLocaleString('en-US')}
        />
        <ClassicyStatRow
          label="Class"
          value={
            session.state.hudState.cityClassLabel.slice(0, 1).toUpperCase() +
            session.state.hudState.cityClassLabel.slice(1).toLowerCase()
          }
        />
      </div>
    </ClassicyPanelChrome>
  );
}
