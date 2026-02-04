import type { MapStore } from './map-store.ts';
import { createClassicMapStore } from './map-store.ts';
import type { MicropolisRng } from './rng.ts';
import { createRng } from './rng.ts';
import type { Ruleset } from './ruleset.ts';
import { CLASSIC_RULESET } from './ruleset.ts';

export interface SimHooks {
  // Sprite system
  destroyAllSprites: () => void;
  generateTrain: (x: number, y: number) => void;
  generateShip: () => void;
  generatePlane: () => void;
  generateCopter: () => void;
  getSprite: (type: number) => unknown;
  getBoatDistance: () => number;
  moveObjects: () => void;
  makeExplosion: (x: number, y: number) => void;
  makeExplosionAt: (px: number, py: number) => void;
  makeSound: (channel: number, sound: number) => void;
  makeMonster: () => void;
  makeTornado: () => void;
  doEarthQuake: () => void;
  stopEarthquake: () => void;

  // UI + graphs
  doUpdateHeads: () => void;
  doAllGraphs: () => void;
  changeCensus: () => void;
  changeEval: () => void;
  drawBudgetWindow: () => void;
  drawCurrPercents: () => void;

  // Budget UI flow
  showBudgetWindowAndStartWaiting: () => void;
  updateBudgetWindow: () => void;

  // Messages + scenarios
  /**
   * Monotonic clock used for UI-timed behaviors.
   *
   * Mirrors `TickCount()` in `ref/micropolis/src/sim/w_stubs.c`, which is used by
   * `doMessage()` (`ref/micropolis/src/sim/s_msg.c`) to expire non-picture messages
   * after `(60 * 30)` ticks (~30 seconds at 60 Hz).
   *
   * sim-core expresses this as a hook so tests/integrations can provide a stable
   * clock; the default implementation is derived from `Date.now()` and yields
   * roughly 60 ticks per second.
   */
  tickCount: () => number;
  sendMes: (id: number) => void;
  sendMesAt: (id: number, x: number, y: number) => void;
  dropFireBombs: () => void;
  doLoseGame: () => void;
  doWinGame: () => void;
  uiSet: (key: string, value: number | boolean | string) => void;
}

const noop = (..._args: unknown[]) => {};
const noopValue = () => undefined;

export function createSimHooks(overrides: Partial<SimHooks> = {}): SimHooks {
  return {
    // Sprite system
    destroyAllSprites: overrides.destroyAllSprites ?? noop,
    generateTrain: overrides.generateTrain ?? noop,
    generateShip: overrides.generateShip ?? noop,
    generatePlane: overrides.generatePlane ?? noop,
    generateCopter: overrides.generateCopter ?? noop,
    getSprite: overrides.getSprite ?? noopValue,
    getBoatDistance: overrides.getBoatDistance ?? (() => 99999),
    moveObjects: overrides.moveObjects ?? noop,
    makeExplosion: overrides.makeExplosion ?? noop,
    makeExplosionAt: overrides.makeExplosionAt ?? noop,
    makeSound: overrides.makeSound ?? noop,
    makeMonster: overrides.makeMonster ?? noop,
    makeTornado: overrides.makeTornado ?? noop,
    doEarthQuake: overrides.doEarthQuake ?? noop,
    stopEarthquake: overrides.stopEarthquake ?? noop,

    // UI + graphs
    doUpdateHeads: overrides.doUpdateHeads ?? noop,
    doAllGraphs: overrides.doAllGraphs ?? noop,
    changeCensus: overrides.changeCensus ?? noop,
    changeEval: overrides.changeEval ?? noop,
    drawBudgetWindow: overrides.drawBudgetWindow ?? noop,
    drawCurrPercents: overrides.drawCurrPercents ?? noop,

    // Budget UI flow
    showBudgetWindowAndStartWaiting: overrides.showBudgetWindowAndStartWaiting ?? noop,
    updateBudgetWindow: overrides.updateBudgetWindow ?? noop,

    // Messages + scenarios
    tickCount:
      overrides.tickCount ??
      (() => {
        // ~60 ticks/second to match the `doMessage()` timeout constant in s_msg.c.
        return Math.trunc((Date.now() * 60) / 1000);
      }),
    sendMes: overrides.sendMes ?? noop,
    sendMesAt: overrides.sendMesAt ?? noop,
    dropFireBombs: overrides.dropFireBombs ?? noop,
    doLoseGame: overrides.doLoseGame ?? noop,
    doWinGame: overrides.doWinGame ?? noop,
    uiSet: overrides.uiSet ?? noop,
  };
}

export interface SimContext {
  store: MapStore;
  rng: MicropolisRng;
  rules: Ruleset;
  hooks: SimHooks;
}

export interface SimContextOptions {
  store?: MapStore;
  rng?: MicropolisRng;
  rules?: Ruleset;
  hooks?: Partial<SimHooks>;
}

export function createSimContext(options: SimContextOptions = {}): SimContext {
  return {
    store: options.store ?? createClassicMapStore(),
    rng: options.rng ?? createRng(),
    rules: options.rules ?? CLASSIC_RULESET,
    hooks: createSimHooks(options.hooks),
  };
}
