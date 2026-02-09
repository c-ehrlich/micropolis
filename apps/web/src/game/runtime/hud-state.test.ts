import { describe, expect, it } from 'vitest';

import { createInitialRuntimeHudState, projectRuntimeHudState } from './hud-state.ts';
import { DEFAULT_LOCAL_CLIENT_ID, DEFAULT_LOCAL_ROOM_ID } from './protocol.ts';

describe('runtime HUD projection', () => {
  it('hydrates funds/date/demand/speed/messages from authoritative snapshot payload', () => {
    const initial = createInitialRuntimeHudState();

    const next = projectRuntimeHudState(initial, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      // `updateDate` maps `CityTime / 48` to years in `w_update.c`.
      tick: 48,
      serverSeq: 1,
      payload: {
        hud: {
          fundsLabel: 'Funds: $19,980',
          date: {
            label: 'Feb 1901',
            month: 1,
            year: 1901,
          },
          demand: {
            r: 6,
            c: -3,
            i: 1,
          },
          // `setSpeed` clamps to 0..3 in `ref/micropolis/src/sim/w_util.c`.
          speed: 3,
        },
        messages: [{ id: 7, text: 'Residents demand a stadium.' }],
      },
    });

    expect(next.fundsLabel).toBe('Funds: $19,980');
    expect(next.dateLabel).toBe('Feb 1901');
    expect(next.dateMonth).toBe(1);
    expect(next.dateYear).toBe(1901);
    expect(next.demandR).toBe(6);
    expect(next.demandC).toBe(-3);
    expect(next.demandI).toBe(1);
    expect(next.speed).toBe(3);
    expect(next.messages).toEqual([
      {
        id: 7,
        text: 'Residents demand a stadium.',
        dispatch: 'sendMes',
        x: null,
        y: null,
        tick: 48,
        serverSeq: 1,
      },
    ]);
  });

  it('applies patch deltas and appends new message events in sequence order', () => {
    const afterSnapshot = projectRuntimeHudState(createInitialRuntimeHudState(), {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 0,
      serverSeq: 1,
      payload: {
        hud: {
          fundsLabel: 'Funds: $20,000',
          date: { label: 'Jan 1900', month: 0, year: 1900 },
          demand: { r: 0, c: 0, i: 0 },
          speed: 2,
        },
        messages: [{ id: 0, text: 'City initialized.' }],
      },
    });

    const afterPatch = projectRuntimeHudState(afterSnapshot, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 5,
      serverSeq: 2,
      payload: {
        hud: {
          fundsLabel: 'Funds: $19,900',
          demand: { r: 2, c: -1, i: 0 },
          speed: 0,
          message: {
            // `SendMes` message id values are integral in `ref/micropolis/src/sim/s_msg.c`.
            id: 4,
            text: 'Build more roads.',
          },
        },
      },
    });

    expect(afterPatch.fundsLabel).toBe('Funds: $19,900');
    expect(afterPatch.demandR).toBe(2);
    expect(afterPatch.demandC).toBe(-1);
    expect(afterPatch.demandI).toBe(0);
    expect(afterPatch.speed).toBe(0);
    expect(afterPatch.messages).toEqual([
      {
        id: 0,
        text: 'City initialized.',
        dispatch: 'sendMes',
        x: null,
        y: null,
        tick: 0,
        serverSeq: 1,
      },
      {
        id: 4,
        text: 'Build more roads.',
        dispatch: 'sendMes',
        x: null,
        y: null,
        tick: 5,
        serverSeq: 2,
      },
    ]);
  });

  it('maps MesX/MesY dispatch to SendMesAt only when MesX || MesY', () => {
    const initial = createInitialRuntimeHudState();
    const snapshot = projectRuntimeHudState(initial, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 7,
      serverSeq: 1,
      payload: {
        messages: [
          {
            // `doMessage` in `ref/micropolis/src/sim/s_msg.c` uses
            // `if (MesX || MesY)` for the SendMesAt path.
            id: 20,
            text: 'Coordinates present.',
            x: 0,
            y: 4,
          },
          {
            // `MesX=0 && MesY=0` follows the plain SendMes path in s_msg.c.
            id: 21,
            text: 'Zero coordinates should not dispatch SendMesAt.',
            x: 0,
            y: 0,
          },
        ],
      },
    });

    expect(snapshot.messages).toEqual([
      {
        id: 20,
        text: 'Coordinates present.',
        dispatch: 'sendMesAt',
        x: 0,
        y: 4,
        tick: 7,
        serverSeq: 1,
      },
      {
        id: 21,
        text: 'Zero coordinates should not dispatch SendMesAt.',
        dispatch: 'sendMes',
        x: null,
        y: null,
        tick: 7,
        serverSeq: 1,
      },
    ]);
  });

  it('ignores invalid payload fragments and keeps previous HUD values', () => {
    const afterSnapshot = projectRuntimeHudState(createInitialRuntimeHudState(), {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 0,
      serverSeq: 1,
      payload: {
        hud: {
          fundsLabel: 'Funds: $20,000',
          date: { label: 'Jan 1900', month: 0, year: 1900 },
          demand: { r: 0, c: 0, i: 0 },
          speed: 3,
        },
      },
    });

    const next = projectRuntimeHudState(afterSnapshot, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 2,
      payload: {
        hud: {
          demand: {
            r: 999,
          },
          speed: 9,
          message: {
            id: 'nope',
            text: 123,
          },
        },
        messages: [
          {
            id: 4,
            text: 'Invalid partial coordinate.',
            x: 10,
          },
        ],
      },
    });

    expect(next).toEqual(afterSnapshot);
  });
});
