import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { dispatchSimPhase } from '../sim/simulate.ts';
import { updateDate } from '../systems/date-time.ts';
import { doDisasters } from '../systems/disasters.ts';

const { WORLD_Y } = World;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

class StubRng extends MicropolisRng {
  private values: number[];
  private cursor = 0;

  constructor(values: number[]) {
    super(1);
    this.values = values;
  }

  override seed(_value = 0): void {
    this.cursor = 0;
  }

  override next16(): number {
    const value = this.values[this.cursor] ?? 0;
    this.cursor += 1;
    return value & 0xffff;
  }

  override next16Signed(): number {
    let value = this.next16();
    if (value > 32767) {
      value = 32767 - value;
    }
    return value;
  }

  override rand(range: number): number {
    if (range <= 0) {
      return 0;
    }
    return this.next16() % (range + 1);
  }
}

describe('Disasters E2E', () => {
  it('dispatches random fires during phase 15', () => {
    const store = createClassicMapStore();
    store.beginTick();

    const state = createSimState();
    state.GameLevel = 0;

    // RNG sequence:
    // 0 -> DoDisasters disaster chance (Rand(10*48) == 0)
    // 0 -> DoDisasters event pick (Rand(8) == 0 => SetFire)
    // 0,0 -> SetFire x/y selection
    // 5 -> SetFire fire variant (Rand16 & 7)
    const rng = new StubRng([0, 0, 0, 0, 5]);
    const messages: number[] = [];
    const messagesAt: Array<[number, number, number]> = [];
    const context = createSimContext({
      store,
      rng,
      hooks: {
        sendMes: (id) => messages.push(id),
        sendMesAt: (id, x, y) => messagesAt.push([id, x, y]),
      },
    });

    const x = 0;
    const y = 0;
    // `SetFire` requires a non-zone tile with ID in (LHTHR..LASTZONE) (`s_disast.c`).
    store.write('map', indexFor(x, y), Tile.LHTHR + 1);

    dispatchSimPhase(15, state, context, { doDisasters });
    updateDate(state, context);

    const map = store.getLayer('map') as Uint16Array;
    expect(map[indexFor(x, y)]).toBe(Tile.FIRE + 5 + TileFlag.ANIMBIT);
    // Message -20 sent by `SetFire` in `s_disast.c`.
    // s_msg.c doMessage checks `if (MesX || MesY)`; with x=y=0, this behaves like SendMes.
    expect(messages).toEqual([-20]);
    expect(messagesAt).toEqual([]);
  });
});
