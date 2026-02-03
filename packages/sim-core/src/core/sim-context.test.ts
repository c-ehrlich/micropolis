import { describe, expect, it } from 'vitest';

import { MicropolisRng } from './rng.ts';
import { createSimContext, createSimHooks } from './sim-context.ts';

describe('SimContext hooks', () => {
  it('record deterministic hook sequences with identical seeds', () => {
    const makeContext = () => {
      const log: string[] = [];
      const hooks = createSimHooks({
        sendMes: (id) => log.push(`sendMes:${id}`),
        makeExplosion: (x, y) => log.push(`explosion:${x},${y}`),
      });
      const context = createSimContext({ rng: new MicropolisRng(123), hooks });
      return { context, log };
    };

    const run = (context: ReturnType<typeof makeContext>['context']) => {
      for (let i = 0; i < 12; i += 1) {
        const roll = context.rng.rand(1);
        if (roll === 0) {
          context.hooks.sendMes(i);
        } else {
          context.hooks.makeExplosion(i, i + 1);
        }
      }
    };

    const ctxA = makeContext();
    const ctxB = makeContext();

    run(ctxA.context);
    run(ctxB.context);

    expect(ctxA.log).toEqual(ctxB.log);
  });
});
