import { describe, expect, it, vi } from 'vitest';

import { createClassicMapStore } from './map-store.ts';
import { MicropolisRng } from './rng.ts';
import { CLASSIC_RULESET } from './ruleset.ts';
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

  it('provides safe no-op hooks by default', () => {
    const context = createSimContext();

    expect(() => context.hooks.destroyAllSprites()).not.toThrow();
    expect(() => context.hooks.generateTrain()).not.toThrow();
    expect(() => context.hooks.generateShip()).not.toThrow();
    expect(() => context.hooks.generatePlane()).not.toThrow();
    expect(() => context.hooks.generateCopter()).not.toThrow();
    expect(() => context.hooks.getSprite(1)).not.toThrow();
    expect(() => context.hooks.moveObjects()).not.toThrow();
    expect(() => context.hooks.makeExplosion(1, 2)).not.toThrow();
    expect(() => context.hooks.makeExplosionAt(3, 4)).not.toThrow();
    expect(() => context.hooks.makeSound(0, 0)).not.toThrow();
    expect(() => context.hooks.doEarthQuake()).not.toThrow();
    expect(() => context.hooks.stopEarthquake()).not.toThrow();

    expect(() => context.hooks.doUpdateHeads()).not.toThrow();
    expect(() => context.hooks.doAllGraphs()).not.toThrow();
    expect(() => context.hooks.changeCensus()).not.toThrow();
    expect(() => context.hooks.changeEval()).not.toThrow();
    expect(() => context.hooks.drawBudgetWindow()).not.toThrow();
    expect(() => context.hooks.drawCurrPercents()).not.toThrow();
    expect(() => context.hooks.showBudgetWindowAndStartWaiting()).not.toThrow();
    expect(() => context.hooks.updateBudgetWindow()).not.toThrow();

    expect(() => context.hooks.sendMes(1)).not.toThrow();
    expect(() => context.hooks.sendMesAt(2, 3, 4)).not.toThrow();
    expect(() => context.hooks.doLoseGame()).not.toThrow();
    expect(() => context.hooks.doWinGame()).not.toThrow();
    expect(() => context.hooks.uiSet('taxRate', 7)).not.toThrow();
  });

  it('uses default components when no options are provided', () => {
    const context = createSimContext();

    expect(context.rules).toBe(CLASSIC_RULESET);
    expect(context.rng).toBeInstanceOf(MicropolisRng);
    expect(context.store.layerInfo('map').id).toBe('map');
  });

  it('respects explicit context overrides', () => {
    const store = createClassicMapStore();
    const rng = new MicropolisRng(42);
    const sendMes = vi.fn();
    const context = createSimContext({ store, rng, hooks: { sendMes }, rules: CLASSIC_RULESET });

    expect(context.store).toBe(store);
    expect(context.rng).toBe(rng);
    context.hooks.sendMes(7);
    expect(sendMes).toHaveBeenCalledWith(7);
  });
});
