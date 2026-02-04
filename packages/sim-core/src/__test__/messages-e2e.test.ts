import { describe, expect, it } from 'vitest';

import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { dispatchSimPhase } from '../sim/simulate.ts';
import { updateDate } from '../systems/date-time.ts';
import { sendMessages } from '../systems/messages.ts';

describe('Messages E2E', () => {
  it('emits residential demand during phase 10', () => {
    const sent: number[] = [];
    const context = createSimContext({
      hooks: {
        sendMes: (id) => sent.push(id),
      },
    });
    const state = createSimState();

    state.CityTime = 1;
    state.ResZPop = 2;
    state.ComZPop = 3;
    state.IndZPop = 3;

    // TotalZPop/4 >= ResZPop => message 1 in SendMessages (s_msg.c).
    dispatchSimPhase(10, state, context, { sendMessages });
    // w_update.c updateDate calls s_msg.c doMessage to deliver queued messages.
    updateDate(state, context);

    expect(sent).toEqual([1]);
  });
});
