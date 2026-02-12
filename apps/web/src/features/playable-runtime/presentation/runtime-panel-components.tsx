import { type CSSProperties } from 'react';

import demandGaugeBackgroundUrl from '../../../../../../packages/sim-assets/generated-images/images/demandg.png';
import type { RuntimeHudMessageEvent, RuntimeHudNoticeEvent } from '../../../game/runtime/index.ts';

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
    <section
      className="classicyRuntimeNoticePanel classicyRuntimePanelChrome pointer-events-auto absolute right-3 z-[13] grid max-h-[min(45vh,320px)] w-[min(520px,calc(100vw-24px))] max-w-[min(520px,calc(100vw-24px))] gap-2.5 overflow-hidden p-2.5"
      style={{ top: `calc(${topInsetPx}px + var(--window-padding-size))` }}
    >
      <header
        className="flex items-center justify-between border px-2 py-1.5"
        style={{ background: notice.color }}
      >
        <strong className="text-xs">{notice.title}</strong>
        <span className="text-[11px]">#{notice.id}</span>
      </header>
      <pre className="classicyRuntimeMessageFeed m-0 overflow-auto whitespace-pre-wrap p-2 text-xs leading-[18px]">
        {notice.body}
      </pre>
      <div className="flex justify-end">
        <button className="classicyButton" onClick={onDismiss} type="button">
          Dismiss
        </button>
      </div>
    </section>
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
    <div className="classicyRuntimeMessageFeed h-[58px] overflow-y-auto px-1.5 py-1 text-xs">
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
    </div>
  );
}
