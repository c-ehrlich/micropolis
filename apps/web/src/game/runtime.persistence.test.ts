/// <reference types="node" />

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test, vi } from 'vitest';

import {
  CITY_HISTORY_LENGTH,
  createClassicMapStore,
  createRng,
  createSimContext,
  createSimState,
  type SimContext,
  type SimState,
} from '../../../../packages/sim-core/src/index.ts';
import { loadFileLikeC, loadScenarioLikeC } from '../../../../packages/sim-io/src/load.ts';
import { saveFileLikeC } from '../../../../packages/sim-io/src/save.ts';
import type { HostMode } from './core-host';
import { createCoreHost } from './host-factory';
import { createGameRuntime } from './runtime';

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const FIXTURE_CITY = path.join(
  WORKSPACE_ROOT,
  'packages',
  'sim-core',
  'fixtures',
  'cities',
  'about.cty',
);
const FIXTURE_SCENARIO = path.join(WORKSPACE_ROOT, 'ref', 'micropolis', 'res', 'snro.222');
const HOST_MODES: readonly HostMode[] = ['local', 'do'];

/**
 * Read a binary city/scenario fixture from workspace paths.
 * Mirrors Stage 2 persistence smoke fixture usage anchored to
 * `ref/micropolis/src/sim/s_fileio.c`.
 */
function readFixture(filePath: string): Uint8Array {
  return new Uint8Array(readFileSync(filePath));
}

/**
 * Build a fresh classic simulation runtime pair for save/load orchestration.
 * Mirrors C `saveFile`/`loadFile` state/store inputs in
 * `ref/micropolis/src/sim/s_fileio.c`.
 */
function createPersistenceRuntimePair(): { state: SimState; context: SimContext } {
  const store = createClassicMapStore();
  return {
    state: createSimState(),
    context: createSimContext({
      store,
      rng: createRng(0x5eed1234),
      hooks: { tickCount: () => 0 },
    }),
  };
}

/**
 * Seed deterministic history buffers for repeatable save bytes.
 * Mirrors fixed-size history writes in `saveFile` from
 * `ref/micropolis/src/sim/s_fileio.c`.
 */
function seedHistories(state: SimState): void {
  for (let i = 0; i < CITY_HISTORY_LENGTH; i += 1) {
    const value = i % 2 === 0 ? i : -i;
    state.ResHis[i] = value;
    state.ComHis[i] = value + 3;
    state.IndHis[i] = value - 4;
    state.CrimeHis[i] = value + 5;
    state.PollutionHis[i] = value - 6;
    state.MoneyHis[i] = value + 7;
  }
}

/**
 * Seed deterministic map values for repeatable save bytes.
 * Mirrors map serialization input in `saveFile` from
 * `ref/micropolis/src/sim/s_fileio.c`.
 */
function seedMap(context: SimContext): void {
  context.store.beginTick();
  try {
    const map = context.store.getLayer('map') as Uint16Array;
    for (let i = 0; i < map.length; i += 1) {
      map[i] = (i * 37) & 0xffff;
    }
    map[0] = 0x8001;
    map[1] = 0xabcd;
  } finally {
    context.store.commitTick();
  }
}

/**
 * Seed one deterministic city state that stays stable through load normalization.
 * Mirrors C `loadFile` normalization behavior in `ref/micropolis/src/sim/s_fileio.c`
 * by using already-normalized metadata values.
 */
function seedStableCity(state: SimState, context: SimContext): void {
  seedHistories(state);
  seedMap(context);

  state.CityTime = 0x1234;
  state.TotalFunds = 20000;
  state.autoBulldoze = true;
  state.autoBudget = false;
  state.autoGo = true;
  state.userSoundOn = true;
  state.CityTax = 7;
  state.SimSpeed = 3;
  state.policePercent = 1;
  state.firePercent = 1;
  state.roadPercent = 1;
}

/**
 * Run a persistence check while one runtime host mode is connected.
 * Mirrors Stage 4 host-agnostic runtime intent mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: persistence currently runs through shared `sim-io` orchestration;
 * Stage 4 host shims do not yet persist host event history across sessions.
 */
function runWithReadyRuntime<T>(mode: HostMode, run: () => T): T {
  const runtime = createGameRuntime(createCoreHost({ mode }));
  runtime.start();
  expect(runtime.getState().status).toBe('ready');

  try {
    const result = run();
    expect(runtime.getState().status).toBe('ready');
    return result;
  } finally {
    runtime.stop();
    expect(runtime.getState().status).toBe('stopped');
  }
}

describe('Stage 4.5 integrated runtime save/load/scenario smoke checks', () => {
  test('keeps deterministic save/load bytes stable across local -> do host switch', () => {
    const { state: localState, context: localContext } = createPersistenceRuntimePair();
    seedStableCity(localState, localContext);
    const baselineBytes = saveFileLikeC(localState, localContext).cityBytes;

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const localRoundTripBytes = runWithReadyRuntime('local', () => {
        const { state, context } = createPersistenceRuntimePair();
        loadFileLikeC(state, context, baselineBytes);
        return saveFileLikeC(state, context).cityBytes;
      });

      const doRoundTripBytes = runWithReadyRuntime('do', () => {
        const { state, context } = createPersistenceRuntimePair();
        loadFileLikeC(state, context, baselineBytes);
        return saveFileLikeC(state, context).cityBytes;
      });

      // C `loadFile` calls `DoSimInit` after payload copy; map scans can mutate tile flags,
      // so post-load save bytes are validated for deterministic stabilization and cross-mode parity,
      // not direct equality with pre-load bytes.
      // Source: `ref/micropolis/src/sim/s_fileio.c`.
      expect(doRoundTripBytes).toEqual(localRoundTripBytes);
      expect(localRoundTripBytes).not.toEqual(baselineBytes);

      const stabilizedBytes = runWithReadyRuntime('local', () => {
        const { state, context } = createPersistenceRuntimePair();
        loadFileLikeC(state, context, localRoundTripBytes);
        return saveFileLikeC(state, context).cityBytes;
      });
      expect(stabilizedBytes).toEqual(localRoundTripBytes);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test.each(HOST_MODES)(
    'loads classic city fixture and preserves saved payload shape in %s mode',
    (mode) => {
      runWithReadyRuntime(mode, () => {
        const aboutCityBytes = readFixture(FIXTURE_CITY);
        const { state, context } = createPersistenceRuntimePair();
        loadFileLikeC(state, context, aboutCityBytes);

        const saved = saveFileLikeC(state, context);
        // `_load_file` accepts and `saveFile` emits classic city payloads at 27120 bytes.
        // Source: `ref/micropolis/src/sim/s_fileio.c`.
        expect(saved.cityBytes.byteLength).toBe(27120);

        const { state: reloadedState, context: reloadedContext } = createPersistenceRuntimePair();
        loadFileLikeC(reloadedState, reloadedContext, saved.cityBytes);
        expect(reloadedState.CityTime).toBe(state.CityTime);
        expect(reloadedState.TotalFunds).toBe(state.TotalFunds);
        expect(reloadedState.SimSpeed).toBe(state.SimSpeed);
        expect(reloadedState.CityTax).toBe(state.CityTax);
      });
    },
  );

  test.each(HOST_MODES)(
    'boots scenario constants and supports save->load flow in %s mode',
    (mode) => {
      runWithReadyRuntime(mode, () => {
        const scenarioBytes = readFixture(FIXTURE_SCENARIO);
        const { state, context } = createPersistenceRuntimePair();
        const loadedScenario = loadScenarioLikeC(state, context, 2, scenarioBytes);

        expect(loadedScenario.scenario.id).toBe(2);
        // Magic numbers from `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c`:
        // CityTime for scenario 2 is `((1906 - 1900) * 48) + 2 = 290`, funds are 20000,
        // speed is 3, and tax is 7.
        expect(state.CityTime).toBe(290);
        expect(state.TotalFunds).toBe(20000);
        expect(state.SimSpeed).toBe(3);
        expect(state.CityTax).toBe(7);

        const saved = saveFileLikeC(state, context);
        const { state: reloadedState, context: reloadedContext } = createPersistenceRuntimePair();
        loadFileLikeC(reloadedState, reloadedContext, saved.cityBytes);

        // `loadFile` explicitly clears scenario mode (`ScenarioID = 0`) before `DoSimInit`.
        // Source: `ref/micropolis/src/sim/s_fileio.c`.
        expect(reloadedState.ScenarioID).toBe(0);
        expect(reloadedState.CityTime).toBe(290);
        expect(reloadedState.TotalFunds).toBe(20000);
      });
    },
  );
});
