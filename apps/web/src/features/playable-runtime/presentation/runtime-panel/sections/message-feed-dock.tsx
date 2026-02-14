import { ClassicyPanelChrome } from '@city/classicyui';

import { MessageFeed } from '../../runtime-panel-components.tsx';
import type { RuntimeSessionController } from '../runtime-panel-types.ts';

interface RuntimeMessageFeedDockProps {
  session: RuntimeSessionController;
}

/**
 * Bottom message-feed dock for runtime HUD messages.
 * Mirrors message display surfaces from `ref/micropolis/src/sim/s_msg.c`.
 * Difference: uses a fixed docked chrome panel rather than a Tcl text widget.
 */
export function RuntimeMessageFeedDock(props: RuntimeMessageFeedDockProps) {
  return (
    <ClassicyPanelChrome className="pointer-events-auto absolute left-1/2 bottom-[calc(var(--window-padding-size)*2)] z-6 grid w-[min(560px,calc(100vw-24px))] -translate-x-1/2 gap-0.5 px-2 py-1">
      <div className="[font-family:var(--ui-font),sans-serif] [font-size:var(--ui-font-size)] leading-none p-0 text-center">
        Message Feed
      </div>
      <MessageFeed messages={props.session.state.hudState.messages} />
    </ClassicyPanelChrome>
  );
}
