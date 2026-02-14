import { ClassicyButton, ClassicyMessageSurface, ClassicyPanelChrome } from '@city/classicyui';
import { type CSSProperties } from 'react';

import demandGaugeBackgroundUrl from '../../../../../../packages/sim-assets/generated-images/images/demandg.png';
import type {
  RuntimeHudGraphState,
  RuntimeHudMessageEvent,
  RuntimeHudNoticeEvent,
} from '../../../game/runtime/index.ts';

const GRAPH_POINT_COUNT = 120;
const GRAPH_SERIES = [
  { bit: 1 << 0, key: 'res', label: 'Res', color: '#1b8f3a' },
  { bit: 1 << 1, key: 'com', label: 'Com', color: '#1b2fe0' },
  { bit: 1 << 2, key: 'ind', label: 'Ind', color: '#ff7a1a' },
  { bit: 1 << 3, key: 'money', label: 'Money', color: '#222222' },
  { bit: 1 << 4, key: 'crime', label: 'Crime', color: '#b00020' },
  { bit: 1 << 5, key: 'pollution', label: 'Pollution', color: '#7a4f00' },
] as const;
const CLASSICY_MESSAGE_SURFACE_CHROME =
  'text-[var(--color-black)] border-solid [border-width:var(--window-border-size)] [border-color:var(--color-window-border)] [background:color-mix(in_srgb,var(--color-system-03)_90%,transparent)] [box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07)]';

type GraphRange = 10 | 120;

/**
 * Authoritative Runtime notice panel.
 * Mirrors `UIShowPictureOn` + `NoticeMessageOn` rendering and local dismiss behavior
 * in `ref/micropolis/res/micropolis.tcl` and `ref/micropolis/res/wnotice.tcl`.
 * Parity note: dismiss is UI-only and does not send a simulation command.
 */
export function NoticePanel({
  notice,
  onDismiss,
  topInsetPx,
}: {
  notice: RuntimeHudNoticeEvent;
  onDismiss: () => void;
  topInsetPx: number;
}) {
  return (
    <ClassicyPanelChrome
      className="pointer-events-auto absolute right-3 z-[13] grid max-h-[min(45vh,320px)] w-[min(520px,calc(100vw-24px))] max-w-[min(520px,calc(100vw-24px))] gap-2.5 overflow-hidden p-2.5"
      style={{ top: `calc(${topInsetPx}px + var(--window-padding-size))` }}
    >
      <header
        className="flex items-center justify-between border px-2 py-1.5"
        style={{ background: notice.color }}
      >
        <strong className="text-xs">{notice.title}</strong>
        <span className="text-[11px]">#{notice.id}</span>
      </header>
      <pre
        className={`${CLASSICY_MESSAGE_SURFACE_CHROME} m-0 overflow-auto whitespace-pre-wrap p-2 text-xs leading-[18px]`}
      >
        {notice.body}
      </pre>
      <div className="flex justify-end">
        <ClassicyButton onClick={onDismiss} type="button">
          Dismiss
        </ClassicyButton>
      </div>
    </ClassicyPanelChrome>
  );
}

/**
 * Demand heads widget shown in the Build tool rail.
 * Mirrors demand canvas composition in `ref/micropolis/res/whead.tcl` and
 * bar updates from `UISetDemand` in `ref/micropolis/res/micropolis.tcl`.
 * Parity note: this uses PNG conversions of the original XPM art and CSS
 * absolutely positioned bars instead of Tk canvas primitives.
 */
export function DemandHeadsWidget({
  demandR,
  demandC,
  demandI,
}: {
  demandR: number;
  demandC: number;
  demandI: number;
}) {
  const demandBars = [
    { channel: 'r', demand: demandR, left: 8, fillColor: '#1b8f3a' },
    { channel: 'c', demand: demandC, left: 17, fillColor: '#1b2fe0' },
    { channel: 'i', demand: demandI, left: 26, fillColor: '#ff7a1a' },
  ] as const;

  return (
    <div
      className="flex w-full justify-center"
      title={`Demand R/C/I: ${demandR}/${demandC}/${demandI}`}
    >
      <div
        aria-label={`Demand heads R ${demandR}, C ${demandC}, I ${demandI}`}
        role="img"
        className="relative h-[110px] w-[78px]"
      >
        <div className="absolute left-0 top-0 h-[55px] w-[39px] origin-top-left [transform:scale(2)]">
          <img
            alt=""
            aria-hidden
            draggable={false}
            src={demandGaugeBackgroundUrl}
            className="pointer-events-none absolute left-0 top-1 block h-[47px] w-[39px] [image-rendering:pixelated]"
          />
          {demandBars.map((bar) => (
            <div
              key={bar.channel}
              className="pointer-events-none absolute w-[7px]"
              style={resolveDemandBarStyle({
                demand: bar.demand,
                fillColor: bar.fillColor,
                left: bar.left,
              })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact graph preview used as the Graph window launcher in the sidebar.
 * Mirrors the clickable `graphview` surface in `ref/micropolis/res/whead.tcl`
 * that opens the full graph window via `ToggleGraphOf`.
 * Parity note: this is a browser SVG sparkline preview, not the Tcl `graphview` widget.
 */
export function GraphPreviewWidget({
  graph,
  mask = 0b111,
  range = 10,
}: {
  graph: RuntimeHudGraphState;
  mask?: number;
  range?: GraphRange;
}) {
  return (
    <ClassicyMessageSurface className="grid h-[60px] w-full place-items-center p-1 text-[10px]">
      <GraphLineChart graph={graph} height={40} mask={mask} range={range} width={90} />
      <div className="leading-3">R/C/I trend</div>
    </ClassicyMessageSurface>
  );
}

/**
 * Full graph-window chart surface with 10/120-year range support and all 6 series.
 * Mirrors `graphview` rendering intent in `ref/micropolis/src/sim/w_graph.c`,
 * including mask-gated per-series overlays from `Mask`.
 */
export function GraphWindowChart({
  graph,
  mask,
  range,
}: {
  graph: RuntimeHudGraphState;
  mask: number;
  range: GraphRange;
}) {
  const visibleSeries = GRAPH_SERIES.filter((series) => (mask & series.bit) !== 0);

  return (
    <ClassicyMessageSurface className="grid gap-1 p-1">
      <GraphLineChart graph={graph} height={180} mask={mask} range={range} width={340} />
      <div className="flex flex-wrap gap-2 text-[10px] leading-3">
        {visibleSeries.length === 0 ? (
          <span>No series selected</span>
        ) : (
          visibleSeries.map((series) => (
            <span key={series.key} className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-2 w-2 border border-black"
                style={{ backgroundColor: series.color }}
              />
              {series.label}
            </span>
          ))
        )}
      </div>
    </ClassicyMessageSurface>
  );
}

/**
 * Draws one graph chart for the selected range and mask.
 * Mirrors series line projection in `DoUpdateGraph` from `ref/micropolis/src/sim/w_graph.c`,
 * using the already-rendered `History10[]` / `History120[]` bytes.
 */
function GraphLineChart({
  graph,
  range,
  mask,
  width,
  height,
}: {
  graph: RuntimeHudGraphState;
  range: GraphRange;
  mask: number;
  width: number;
  height: number;
}) {
  const chartPaddingLeft = 6;
  const chartPaddingRight = 4;
  const chartPaddingTop = 4;
  const chartPaddingBottom = 4;
  const plotWidth = Math.max(1, width - chartPaddingLeft - chartPaddingRight);
  const plotHeight = Math.max(1, height - chartPaddingTop - chartPaddingBottom);
  const history = range === 10 ? graph.history10 : graph.history120;

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${width} ${height}`}
      className="block h-auto w-full"
      style={{ maxHeight: `${height}px` }}
    >
      <rect
        x={chartPaddingLeft}
        y={chartPaddingTop}
        width={plotWidth}
        height={plotHeight}
        fill="#d8d8d8"
        stroke="#444"
        strokeWidth="1"
      />
      {GRAPH_SERIES.map((series) => {
        if ((mask & series.bit) === 0) {
          return null;
        }
        const values = history[series.key];
        const points = buildGraphSeriesPoints(
          values,
          chartPaddingLeft,
          chartPaddingTop,
          plotWidth,
          plotHeight,
        );
        return (
          <polyline
            key={`${range}-${series.key}`}
            fill="none"
            points={points}
            stroke={series.color}
            strokeWidth={2}
          />
        );
      })}
    </svg>
  );
}

/**
 * Converts one 120-byte history series into SVG polyline coordinates.
 * Mirrors x/y projection used by `DoUpdateGraph` in `ref/micropolis/src/sim/w_graph.c`,
 * where `x` advances across 120 points and `y` maps graph byte values to chart height.
 */
function buildGraphSeriesPoints(
  values: Uint8Array,
  left: number,
  top: number,
  width: number,
  height: number,
): string {
  const xStep = width / (GRAPH_POINT_COUNT - 1);
  const points: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    const x = left + index * xStep;
    const y = top + (1 - value / 255) * height;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(' ');
}

/**
 * Computes one vertical demand-bar segment style.
 * Mirrors the Tcl `UISetDemand` branch and coordinate math in
 * `ref/micropolis/res/micropolis.tcl` (1:1 baseline and endpoint behavior).
 */
function resolveDemandBarStyle({
  demand,
  left,
  fillColor,
}: {
  demand: number;
  left: number;
  fillColor: string;
}): CSSProperties {
  const clampedDemand = Math.max(-15, Math.min(15, Math.trunc(demand)));
  const baseline = clampedDemand <= 0 ? 32 : 24;
  const endpoint = baseline - clampedDemand;
  const top = Math.min(baseline, endpoint);
  const bottom = Math.max(baseline, endpoint);
  return {
    background: fillColor,
    height: Math.max(1, bottom - top),
    left,
    top,
  };
}

/**
 * Authoritative Runtime message feed view.
 * Mirrors user-visible message surface from `UISetMessage` in
 * `ref/micropolis/src/sim/s_msg.c`, with a bounded reverse-chronological list.
 */
export function MessageFeed({ messages }: { messages: readonly RuntimeHudMessageEvent[] }) {
  return (
    <ClassicyMessageSurface className="h-[58px] overflow-y-auto px-1.5 py-1 text-xs">
      {messages.length === 0 ? (
        <div className="leading-4">No messages yet.</div>
      ) : (
        [...messages].reverse().map((message) => {
          const coordinateSuffix =
            message.dispatch === 'sendMesAt' && message.x !== null && message.y !== null
              ? ` @ (${message.x}, ${message.y})`
              : '';
          return (
            <div
              key={`${message.serverSeq}:${message.id}:${message.tick}:${message.x ?? 'na'}:${message.y ?? 'na'}`}
              className="overflow-hidden text-ellipsis whitespace-nowrap leading-4"
            >
              <span className="text-blue-700">[{message.serverSeq}]</span> {message.text}
              {coordinateSuffix}
            </div>
          );
        })
      )}
    </ClassicyMessageSurface>
  );
}
