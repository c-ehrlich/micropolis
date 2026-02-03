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
  moveObjects: () => void;
  makeExplosion: (x: number, y: number) => void;
  makeExplosionAt: (px: number, py: number) => void;
  makeSound: (channel: number, sound: number) => void;
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
  sendMes: (id: number) => void;
  sendMesAt: (id: number, x: number, y: number) => void;
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
    moveObjects: overrides.moveObjects ?? noop,
    makeExplosion: overrides.makeExplosion ?? noop,
    makeExplosionAt: overrides.makeExplosionAt ?? noop,
    makeSound: overrides.makeSound ?? noop,
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
    sendMes: overrides.sendMes ?? noop,
    sendMesAt: overrides.sendMesAt ?? noop,
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
