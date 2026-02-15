import { describe, expect, it } from 'vitest';

import {
  getClassicBuiltinScenarioRuntimeDefinitionByLegacyId,
  type ScenarioRuntimeDefinition,
} from '../../../scenario-runtime/src/index.ts';
import { Tile, World } from '../core/constants.ts';
import { createClassicMapStore, type MapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState, type SimState } from '../core/sim-state.ts';
import { hashMap, hashScalars, mixHashes } from '../io/hash.ts';
import { updateDate } from './date-time.ts';
import { doDisasters } from './disasters.ts';
import { sendMessages } from './messages.ts';
import {
  hasSimScenarioRuntimeState,
  setSimScenarioRuntimeInputs,
} from './scenario-runtime-bridge.ts';

const { WORLD_Y, WORLD_X } = {
  WORLD_Y: World.WORLD_Y,
  WORLD_X: World.WORLD_X,
} as const;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

interface ScenarioHookTrace {
  dropFireBombsCount: number;
  makeMonsterCount: number;
  doEarthquakeCount: number;
  doLoseGameCount: number;
  sendMesCount: number;
  sendMesAtCount: number;
  makeExplosionCount: number;
  makeExplosionAtCount: number;
  payloadHash: number;
}

interface ScenarioRunResult {
  readonly usesRuntimeState: boolean;
  readonly digestByTick: readonly number[];
  readonly finalDigest: number;
  readonly hookDigest: number;
}

type ScenarioRunMode = 'legacy' | 'declarative';

const createScenarioHookTrace = (): ScenarioHookTrace => ({
  dropFireBombsCount: 0,
  makeMonsterCount: 0,
  doEarthquakeCount: 0,
  doLoseGameCount: 0,
  sendMesCount: 0,
  sendMesAtCount: 0,
  makeExplosionCount: 0,
  makeExplosionAtCount: 0,
  payloadHash: 0,
});

const recordHookPayload = (
  trace: ScenarioHookTrace,
  tag: number,
  values: readonly number[],
): void => {
  trace.payloadHash = mixHashes(trace.payloadHash, hashScalars([tag, ...values]));
};

const hookDigest = (trace: ScenarioHookTrace): number =>
  hashScalars([
    trace.dropFireBombsCount,
    trace.makeMonsterCount,
    trace.doEarthquakeCount,
    trace.doLoseGameCount,
    trace.sendMesCount,
    trace.sendMesAtCount,
    trace.makeExplosionCount,
    trace.makeExplosionAtCount,
    trace.payloadHash,
  ]);

const runDigest = (state: SimState, store: MapStore, trace: ScenarioHookTrace): number => {
  const map = store.getLayer('map') as Uint16Array;
  const scalarDigest = hashScalars([
    state.DisasterEvent,
    state.DisasterWait,
    state.ScoreType,
    state.ScoreWait,
    state.FloodCnt,
    state.FloodX,
    state.FloodY,
    state.CrashX,
    state.CrashY,
    state.MeltX,
    state.MeltY,
    state.MessagePort,
    state.MesNum,
    state.MesX,
    state.MesY,
    state.LastMesTime,
    state.LastPicNum,
    state.CityClass,
    state.TrafficAverage,
    state.CityScore,
    state.CrimeAverage,
  ]);
  return mixHashes(hashMap(map), scalarDigest, hookDigest(trace));
};

const configureParityBaselineState = (state: SimState): void => {
  state.StartingYear = 1900;
  state.CityTime = 0;
  state.GameLevel = 0;
  state.NoDisasters = true;

  // Objective success metrics from DoScenarioScore checks in ref/micropolis/src/sim/s_msg.c.
  state.CityClass = 4;
  state.TrafficAverage = 0;
  state.CityScore = 600;
  state.CrimeAverage = 0;
};

const seedScenarioMap = (store: MapStore, scenarioId: number): void => {
  const map = store.getLayer('map') as Uint16Array;
  switch (scenarioId) {
    case 2:
      // Earthquake damage coverage: vulnerable non-zone tiles (tile id >= RESBASE).
      map.fill(Tile.RESBASE);
      return;
    case 7:
      // Meltdown coverage: MakeMeltdown scans for a NUCLEAR tile.
      map[indexFor(1, 1)] = Tile.NUCLEAR;
      return;
    case 8:
      // Flood coverage: MakeFlood searches FIRSTRIVEDGE tiles with dirt-like neighbors.
      for (let x = 1; x < WORLD_X - 1; x += 2) {
        for (let y = 1; y < WORLD_Y - 1; y += 2) {
          map[indexFor(x, y)] = Tile.FIRSTRIVEDGE;
          map[indexFor(x, y - 1)] = Tile.DIRT;
        }
      }
      return;
    default:
      return;
  }
};

const configureLegacyScenarioState = (
  state: SimState,
  scenarioId: number,
  runtimeDefinition: ScenarioRuntimeDefinition,
): void => {
  state.ScenarioID = scenarioId;
  state.DisasterEvent = scenarioId;
  state.DisasterWait = runtimeDefinition.events[0]?.initialCountdown ?? 0;
  state.ScoreType = scenarioId;
  state.ScoreWait = runtimeDefinition.objective?.initialCountdown ?? 0;
};

const configureDeclarativeScenarioState = (
  state: SimState,
  scenarioId: number,
  runtimeDefinition: ScenarioRuntimeDefinition,
): void => {
  state.ScenarioID = 0;
  setSimScenarioRuntimeInputs(state, {
    legacyScenarioId: scenarioId,
    runtimeDefinition,
  });
};

const runScenarioPath = (
  mode: ScenarioRunMode,
  scenarioId: number,
  runtimeDefinition: ScenarioRuntimeDefinition,
  seed: number,
  ticks: number,
): ScenarioRunResult => {
  const store = createClassicMapStore();
  store.beginTick();

  const rng = new MicropolisRng(seed);
  const trace = createScenarioHookTrace();
  const tickRef = { value: 0 };

  const context = createSimContext({
    store,
    rng,
    hooks: {
      tickCount: () => tickRef.value,
      dropFireBombs: () => {
        trace.dropFireBombsCount += 1;
        recordHookPayload(trace, 1, []);
      },
      makeMonster: () => {
        trace.makeMonsterCount += 1;
        recordHookPayload(trace, 2, []);
      },
      doEarthQuake: () => {
        trace.doEarthquakeCount += 1;
        recordHookPayload(trace, 3, []);
      },
      doLoseGame: () => {
        trace.doLoseGameCount += 1;
        recordHookPayload(trace, 4, []);
      },
      sendMes: (id) => {
        trace.sendMesCount += 1;
        recordHookPayload(trace, 5, [id]);
      },
      sendMesAt: (id, x, y) => {
        trace.sendMesAtCount += 1;
        recordHookPayload(trace, 6, [id, x, y]);
      },
      makeExplosion: (x, y) => {
        trace.makeExplosionCount += 1;
        recordHookPayload(trace, 7, [x, y]);
      },
      makeExplosionAt: (x, y) => {
        trace.makeExplosionAtCount += 1;
        recordHookPayload(trace, 8, [x, y]);
      },
    },
  });
  const state = createSimState();

  configureParityBaselineState(state);
  seedScenarioMap(store, scenarioId);

  if (mode === 'legacy') {
    configureLegacyScenarioState(state, scenarioId, runtimeDefinition);
  } else {
    configureDeclarativeScenarioState(state, scenarioId, runtimeDefinition);
  }

  const usesRuntimeState = hasSimScenarioRuntimeState(state);
  const digestByTick: number[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    doDisasters(state, context);
    sendMessages(state, context);
    updateDate(state, context);
    digestByTick.push(runDigest(state, store, trace));
    tickRef.value += 1;
  }

  return {
    usesRuntimeState,
    digestByTick,
    finalDigest: digestByTick[digestByTick.length - 1] ?? 0,
    hookDigest: hookDigest(trace),
  };
};

describe('scenario runtime fixed-seed deterministic parity', () => {
  it('keeps legacy numeric scenario behavior parity with declarative runtime inputs', () => {
    const scenarioIds = [1, 2, 3, 4, 5, 6, 7, 8] as const;

    for (const scenarioId of scenarioIds) {
      const runtimeDefinition = getClassicBuiltinScenarioRuntimeDefinitionByLegacyId(scenarioId);
      if (runtimeDefinition === undefined) {
        throw new Error(`missing classic runtime definition for scenario ${scenarioId}`);
      }

      /**
       * Magic-number sources:
       * - `initialCountdown` values come from `DisTab` and `ScoreWaitTab` in
       *   `DoSimInit` (`ref/micropolis/src/sim/s_sim.c`) via the declarative
       *   Stage 1 runtime definitions.
       * - `+2` for events covers C `ScenarioDisaster`'s final zero-countdown tick
       *   where the event still runs before deactivation.
       * - `+1` for objectives covers the one-shot evaluation tick when `ScoreWait`
       *   decrements to zero in `SendMessages` (`ref/micropolis/src/sim/s_msg.c`).
       */
      const ticks = Math.max(
        (runtimeDefinition.events[0]?.initialCountdown ?? 0) + 2,
        (runtimeDefinition.objective?.initialCountdown ?? 0) + 1,
      );
      const seed = 0x0055aa00 + scenarioId * 97;

      const legacy = runScenarioPath('legacy', scenarioId, runtimeDefinition, seed, ticks);
      const declarative = runScenarioPath(
        'declarative',
        scenarioId,
        runtimeDefinition,
        seed,
        ticks,
      );
      const declarativeRepeat = runScenarioPath(
        'declarative',
        scenarioId,
        runtimeDefinition,
        seed,
        ticks,
      );

      expect(legacy.usesRuntimeState).toBe(false);
      expect(declarative.usesRuntimeState).toBe(true);
      expect(declarative.digestByTick).toEqual(legacy.digestByTick);
      expect(declarative.hookDigest).toBe(legacy.hookDigest);
      expect(declarative.finalDigest).toBe(legacy.finalDigest);

      expect(declarativeRepeat.digestByTick).toEqual(declarative.digestByTick);
      expect(declarativeRepeat.hookDigest).toBe(declarative.hookDigest);
      expect(declarativeRepeat.finalDigest).toBe(declarative.finalDigest);
    }
  }, 10_000);
});
