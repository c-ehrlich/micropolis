import { describe, expect, it } from 'vitest';

import { createInitialRuntimeHudState, projectRuntimeHudState } from './hud-state.ts';
import {
  DEFAULT_LOCAL_CLIENT_ID,
  DEFAULT_LOCAL_ROOM_ID,
  type HostPatchPayload,
} from './protocol.ts';

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
          funds: 19_980,
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
          // City class index names come from `CityClassStr` in
          // `ref/micropolis/src/sim/w_eval.c` (`2` => `CITY`).
          cityPopulation: 50_000,
          cityClass: 2,
          // `setSpeed` clamps to 0..3 in `ref/micropolis/src/sim/w_util.c`.
          speed: 3,
          options: {
            autoBudget: true,
            autoGo: false,
            autoBulldoze: true,
            disasters: true,
            userSoundOn: true,
            doAnimation: true,
            doMessages: true,
            doNotices: false,
          },
        },
        messages: [{ id: 7, text: 'Residents demand a stadium.' }],
      },
    });

    expect(next.fundsLabel).toBe('Funds: $19,980');
    expect(next.dateLabel).toBe('Feb 1901');
    expect(next.dateDisplayLabel).toBe('Date: Feb 1901');
    expect(next.dateMonth).toBe(1);
    expect(next.dateYear).toBe(1901);
    expect(next.demandR).toBe(6);
    expect(next.demandC).toBe(-3);
    expect(next.demandI).toBe(1);
    expect(next.demandLabel).toBe('Demand R/C/I: 6/-3/1');
    expect(next.cityPopulation).toBe(50_000);
    expect(next.cityClassIndex).toBe(2);
    expect(next.cityClassLabel).toBe('CITY');
    expect(next.speed).toBe(3);
    expect(next.speedLabel).toBe('Speed: x3');
    expect(next.options).toEqual({
      autoBudget: true,
      autoGo: false,
      autoBulldoze: true,
      disasters: true,
      userSoundOn: true,
      doAnimation: true,
      doMessages: true,
      doNotices: false,
    });
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
          options: {
            autoBudget: true,
            autoGo: true,
            autoBulldoze: true,
            disasters: true,
            userSoundOn: true,
            doAnimation: true,
            doMessages: true,
            doNotices: true,
          },
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
          options: {
            optionAutoGo: false,
            optionDoAnimation: false,
          },
        },
        messageDeltas: [
          {
            // `SendMes` message id values are integral in `ref/micropolis/src/sim/s_msg.c`.
            id: 4,
            text: 'Build more roads.',
          },
        ],
      } as unknown as HostPatchPayload,
    });

    expect(afterPatch.fundsLabel).toBe('Funds: $19,900');
    expect(afterPatch.demandR).toBe(2);
    expect(afterPatch.demandC).toBe(-1);
    expect(afterPatch.demandI).toBe(0);
    expect(afterPatch.demandLabel).toBe('Demand R/C/I: 2/-1/0');
    expect(afterPatch.speed).toBe(0);
    expect(afterPatch.speedLabel).toBe('Speed: Paused');
    expect(afterPatch.options.autoBudget).toBe(true);
    expect(afterPatch.options.autoGo).toBe(false);
    expect(afterPatch.options.doAnimation).toBe(false);
    expect(afterPatch.options.doMessages).toBe(true);
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

  it('preserves replay tick/serverSeq metadata carried by snapshot baseline messages', () => {
    const initial = createInitialRuntimeHudState();
    const snapshot = projectRuntimeHudState(initial, {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 20,
      serverSeq: 8,
      payload: {
        messages: [
          {
            // Message ids are integer indices in `SendMes`/`SendMesAt`
            // (`ref/micropolis/src/sim/s_msg.c`).
            id: 14,
            text: 'Residents demand police stations.',
            tick: 3,
            serverSeq: 2,
          },
          {
            id: 16,
            text: 'Taxes are too high.',
          },
        ],
      },
    });

    expect(snapshot.messages).toEqual([
      {
        id: 14,
        text: 'Residents demand police stations.',
        dispatch: 'sendMes',
        x: null,
        y: null,
        tick: 3,
        serverSeq: 2,
      },
      {
        id: 16,
        text: 'Taxes are too high.',
        dispatch: 'sendMes',
        x: null,
        y: null,
        tick: 20,
        serverSeq: 8,
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
          options: {
            autoBudget: true,
            autoGo: true,
            autoBulldoze: true,
            disasters: true,
            userSoundOn: true,
            doAnimation: true,
            doMessages: true,
            doNotices: true,
          },
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
          options: {
            autoBudget: 'not-bool',
          },
        },
        messages: [
          {
            id: 4,
            text: 'Invalid partial coordinate.',
            x: 10,
          },
        ],
      } as unknown as HostPatchPayload,
    });

    expect(next).toEqual(afterSnapshot);
  });

  it('prefers canonical patch messageDeltas over legacy message compatibility fields', () => {
    const initial = createInitialRuntimeHudState();
    const next = projectRuntimeHudState(initial, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 11,
      serverSeq: 4,
      payload: {
        hud: {
          message: {
            // Message ids remain integral in `SendMes` (`ref/micropolis/src/sim/s_msg.c`).
            id: 70,
            text: 'Legacy hud.message entry.',
          },
        },
        messageDeltas: [
          {
            id: 71,
            text: 'Canonical message delta entry.',
          },
        ],
        messages: [
          {
            id: 72,
            text: 'Legacy messages[] compatibility entry.',
          },
        ],
      } as unknown as HostPatchPayload,
    });

    expect(next.messages).toEqual([
      {
        id: 71,
        text: 'Canonical message delta entry.',
        dispatch: 'sendMes',
        x: null,
        y: null,
        tick: 11,
        serverSeq: 4,
      },
    ]);
  });

  it('projects notice payloads from snapshots and patches with replay metadata defaults', () => {
    const snapshot = projectRuntimeHudState(createInitialRuntimeHudState(), {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 30,
      serverSeq: 9,
      payload: {
        // Magic id `100` comes from `Message 100` in `ref/micropolis/res/micropolis.tcl`.
        notice: {
          id: 100,
          title: "YOU'RE A WINNER!",
          body: 'Victory!',
          color: '#7fff7f',
        },
      },
    });

    expect(snapshot.notice).toEqual({
      id: 100,
      title: "YOU'RE A WINNER!",
      body: 'Victory!',
      color: '#7fff7f',
      tick: 30,
      serverSeq: 9,
    });

    const patch = projectRuntimeHudState(snapshot, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 31,
      serverSeq: 10,
      payload: {
        // Magic id `200` comes from `Message 200` in `ref/micropolis/res/micropolis.tcl`.
        notice: {
          id: 200,
          title: 'IMPEACHMENT NOTICE!',
          body: 'Lose condition.',
          color: '#ff4f4f',
          tick: 12,
          serverSeq: 5,
        },
      },
    });

    expect(patch.notice).toEqual({
      id: 200,
      title: 'IMPEACHMENT NOTICE!',
      body: 'Lose condition.',
      color: '#ff4f4f',
      tick: 12,
      serverSeq: 5,
    });
  });

  it('clears active notice when patch notice is explicitly null', () => {
    const withNotice = projectRuntimeHudState(createInitialRuntimeHudState(), {
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 1,
      payload: {
        notice: {
          id: 48,
          title: 'Start a New City',
          body: 'Bootstrap notice.',
          color: '#7f7fff',
        },
      },
    });

    const cleared = projectRuntimeHudState(withNotice, {
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 2,
      serverSeq: 2,
      payload: {
        notice: null,
      },
    });

    expect(cleared.notice).toBeNull();
  });
});
