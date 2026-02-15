/// <reference types="node" />

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test, vi } from 'vitest';

import { getScenarioDefinition } from '../../../../packages/scenario-core/src/classic-scenarios.ts';
import {
  CITY_HISTORY_LENGTH,
  cityDimensionsForMap,
  createClassicMapStore,
  createRng,
  createSimContext,
  createSimState,
  type SimContext,
  type SimState,
  World,
} from '../../../../packages/sim-core/src/index.ts';
import { loadFileLikeC, loadScenarioLikeC } from '../../../../packages/sim-io/src/load.ts';
import { saveFileLikeC } from '../../../../packages/sim-io/src/save.ts';
import type { HostMode } from './core-host';
import { DeterministicCommandAuthority } from './deterministic-command-authority';
import { createCoreHost } from './host-factory';
import { createGameRuntime } from './runtime';
import { SimCoreCommandAuthority } from './sim-core-command-authority';

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
// C `saveFile`/`_load_file` classic city dimensions in `ref/micropolis/src/sim/s_fileio.c`.
const CLASSIC_CITY_FILE_BYTE_LENGTH = cityDimensionsForMap(World.WORLD_X, World.WORLD_Y).byteLength;
// C `LoadScenario` case-2 constants in `ref/micropolis/src/sim/s_fileio.c`.
const SAN_FRANCISCO_SCENARIO = getScenarioDefinition(2);
// C `LoadScenario` always applies `CityTax = 7` and `setSpeed(3)` in `s_fileio.c`.
const LOAD_SCENARIO_CITY_TAX = 7;
const LOAD_SCENARIO_SIM_SPEED = 3;
// C `loadFile` clears scenario mode before `DoSimInit` in `s_fileio.c`.
const LOAD_FILE_SCENARIO_ID_CLEARED = 0;

interface AuthorityHostProbe {
  commandAuthority: unknown;
}

/**
 * Read a binary city/scenario fixture from workspace paths.
 * Mirrors Playable Runtime persistence smoke fixture usage anchored to
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
 * Read the Authoritative Runtime authority implementation from the selected host.
 * Mirrors Sim-Core Authority host-owned sim-core authority wiring mapped from
 * `ref/micropolis/src/sim/w_sim.c` + `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: this white-box probe is a TypeScript-only test seam.
 */
function readAuthorityForPersistence(host: unknown): unknown {
  if (
    typeof host !== 'object' ||
    host === null ||
    !('commandAuthority' in host) ||
    !('mode' in host)
  ) {
    throw new Error('Expected LocalHost/DoHost host with Authoritative Runtime authority wiring');
  }
  return (host as AuthorityHostProbe).commandAuthority;
}

/**
 * Run a persistence check while one runtime host mode is connected.
 * Mirrors Authoritative Runtime host-agnostic runtime intent mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: persistence currently runs through shared `sim-io` orchestration;
 * Authoritative Runtime host shims do not yet persist host event history across sessions.
 */
function runWithReadyRuntime<T>(mode: HostMode, run: () => T): T {
  const host = createCoreHost({ mode });
  const authority = readAuthorityForPersistence(host);
  expect(authority).toBeInstanceOf(SimCoreCommandAuthority);
  expect(authority).not.toBeInstanceOf(DeterministicCommandAuthority);

  const runtime = createGameRuntime(host);
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

describe('Integrated Runtime integrated runtime save/load/scenario smoke checks', () => {
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
        expect(saved.cityBytes.byteLength).toBe(CLASSIC_CITY_FILE_BYTE_LENGTH);

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
        const loadedScenario = loadScenarioLikeC(
          state,
          context,
          SAN_FRANCISCO_SCENARIO.id,
          scenarioBytes,
        );

        expect(loadedScenario.scenario.id).toBe(SAN_FRANCISCO_SCENARIO.id);
        // Magic numbers from `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c`:
        // CityTime for scenario 2 is `((1906 - 1900) * 48) + 2 = 290`, funds are 20000,
        // speed is 3, and tax is 7.
        expect(state.CityTime).toBe(SAN_FRANCISCO_SCENARIO.startCityTime);
        expect(state.TotalFunds).toBe(SAN_FRANCISCO_SCENARIO.startFunds);
        expect(state.SimSpeed).toBe(LOAD_SCENARIO_SIM_SPEED);
        expect(state.CityTax).toBe(LOAD_SCENARIO_CITY_TAX);

        const saved = saveFileLikeC(state, context);
        const { state: reloadedState, context: reloadedContext } = createPersistenceRuntimePair();
        loadFileLikeC(reloadedState, reloadedContext, saved.cityBytes);

        // `loadFile` explicitly clears scenario mode (`ScenarioID = 0`) before `DoSimInit`.
        // Source: `ref/micropolis/src/sim/s_fileio.c`.
        expect(reloadedState.ScenarioID).toBe(LOAD_FILE_SCENARIO_ID_CLEARED);
        expect(reloadedState.CityTime).toBe(SAN_FRANCISCO_SCENARIO.startCityTime);
        expect(reloadedState.TotalFunds).toBe(SAN_FRANCISCO_SCENARIO.startFunds);
      });
    },
  );
});
