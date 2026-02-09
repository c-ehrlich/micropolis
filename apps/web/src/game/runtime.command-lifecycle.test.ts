import { describe, expect, test } from 'vitest';

import {
  getOrThrow,
  type SimContext,
  type SimState,
  Tile,
  TileMask,
  type ToolContext,
  World,
} from '../../../../packages/sim-core/src/index.ts';
import type { CoreHostCommand, HostMode } from './core-host';
import { DoHost } from './do-host';
import { createCoreHost } from './host-factory';
import { LocalHost } from './local-host';
import { createGameRuntime, type GameRuntime } from './runtime';

const { LOMASK } = TileMask;
const { ROADS } = Tile;
const { WORLD_Y } = World;

// Magic-number source: `InitFunds()` in `ref/micropolis/src/sim/s_init.c`.
const INITIAL_FUNDS = 20_000;
// Magic-number source: `CostOf[]` road entry in `ref/micropolis/src/sim/w_tool.c`.
const ROAD_COST = 10;

interface SimCoreAuthorityProbe {
  readonly simState: SimState;
  readonly simContext: SimContext;
  readonly toolContext: ToolContext;
}

interface SuccessRejectLifecycleArtifacts {
  readonly commandLifecycleLog: ReadonlyArray<string>;
  readonly authoritativeSnapshotPlacements: ReadonlyArray<{
    readonly commandId: string;
    readonly tool: 'road';
    readonly x: number;
    readonly y: number;
  }>;
  readonly initialFunds: number;
  readonly fundsAfterSuccess: number;
  readonly fundsAfterReject: number;
}

/**
 * Flush one queued host-command microtask.
 * Mirrors deferred host event delivery in Stage 4 runtime tests, while preserving
 * Micropolis ordering intent where tool success/failure is processed before commit UI
 * callbacks in `ref/micropolis/src/sim/w_tool.c`.
 */
async function flushCommandLifecycle(): Promise<void> {
  await Promise.resolve();
}

/**
 * Build and start a ready runtime for one host mode.
 * Mirrors host-agnostic bootstrap/hello behavior from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
function createReadyRuntime(mode: HostMode): GameRuntime {
  const runtime = createGameRuntime(
    createCoreHost({
      mode,
      authorityMode: 'sim-core',
      createLocalHost: () =>
        new LocalHost({ authorityMode: 'sim-core', authorityTickIntervalMs: 0 }),
      createDoHost: () => new DoHost({ authorityMode: 'sim-core', authorityTickIntervalMs: 0 }),
    }),
  );
  runtime.start();
  expect(runtime.getState().status).toBe('ready');
  return runtime;
}

/**
 * Read sim-core authority internals from one host runtime in tests.
 * Mirrors Stage 3 authority ownership where one host process owns
 * `SimState + SimContext + ToolContext` in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this introspection helper is test-only and not part of host runtime API.
 */
function readAuthorityProbe(runtime: GameRuntime): SimCoreAuthorityProbe {
  const hostInternals = runtime.host as unknown as {
    commandAuthority?: {
      simState?: SimState;
      simContext?: SimContext;
      toolContext?: ToolContext;
    };
  };
  const commandAuthority = hostInternals.commandAuthority;
  expect(commandAuthority).toBeDefined();
  expect(commandAuthority?.simState).toBeDefined();
  expect(commandAuthority?.simContext).toBeDefined();
  expect(commandAuthority?.toolContext).toBeDefined();
  if (
    commandAuthority?.simState === undefined ||
    commandAuthority.simContext === undefined ||
    commandAuthority.toolContext === undefined
  ) {
    throw new Error('Expected sim-core command authority internals');
  }

  return {
    simState: commandAuthority.simState,
    simContext: commandAuthority.simContext,
    toolContext: commandAuthority.toolContext,
  };
}

/**
 * Convert one map coordinate into the authoritative x-major map index.
 * Mirrors `x * WORLD_Y + y` indexing convention used by Micropolis map arrays in
 * `ref/micropolis/src/sim/sim.c`.
 */
function mapIndex(x: number, y: number): number {
  return x * WORLD_Y + y;
}

/**
 * Read authoritative tile base id (`LOMASK`) from sim-core map state.
 * Mirrors map-word masking used before draw/logic checks in
 * `ref/micropolis/src/sim/g_bigmap.c` and tool-path checks in
 * `ref/micropolis/src/sim/w_tool.c`.
 */
function readAuthoritativeTile(authority: SimCoreAuthorityProbe, x: number, y: number): number {
  const map = authority.simContext.store.snapshot('map') as Uint16Array;
  return getOrThrow(map[mapIndex(x, y)]) & LOMASK;
}

/**
 * Request one host snapshot at the runtime's current authoritative sequence.
 * Mirrors snapshot/recovery baseline flow in `ref/micropolis/spec/integration/SPEC.md`.
 */
async function requestAuthoritativeSnapshot(
  runtime: GameRuntime,
): Promise<SuccessRejectLifecycleArtifacts['authoritativeSnapshotPlacements']> {
  const snapshots: Array<{
    readonly baseServerSeq: number;
    readonly placements: SuccessRejectLifecycleArtifacts['authoritativeSnapshotPlacements'];
  }> = [];
  const unsubscribe = runtime.host.subscribe((event) => {
    if (event.type !== 'snapshot') {
      return;
    }

    snapshots.push({
      baseServerSeq: event.baseServerSeq,
      placements:
        event.placements as SuccessRejectLifecycleArtifacts['authoritativeSnapshotPlacements'],
    });
  });

  const lastAppliedServerSeq = runtime.getState().lastAppliedServerSeq;
  runtime.host.requestSnapshot(lastAppliedServerSeq);
  await flushCommandLifecycle();
  unsubscribe();

  const latestSnapshot = snapshots.at(-1);
  expect(latestSnapshot).toBeDefined();
  if (latestSnapshot === undefined) {
    throw new Error('Expected snapshot event after requestSnapshot');
  }
  expect(latestSnapshot.baseServerSeq).toBe(lastAppliedServerSeq);
  return latestSnapshot.placements;
}

/**
 * Execute one success + reject placement lifecycle and return the deterministic log.
 * Mirrors tool success (`DidTool`) versus non-mutating rejection behavior in
 * `ref/micropolis/src/sim/w_tool.c`.
 */
async function runSuccessRejectLifecycle(mode: HostMode): Promise<SuccessRejectLifecycleArtifacts> {
  const runtime = createReadyRuntime(mode);
  const authority = readAuthorityProbe(runtime);
  const initialFunds = authority.simState.TotalFunds;
  expect(initialFunds).toBe(INITIAL_FUNDS);
  expect(authority.toolContext.funds).toBe(initialFunds);

  const acceptedPlacement: CoreHostCommand = {
    type: 'tool-command',
    commandId: 'cmd-place-ok',
    tool: 'road',
    x: 10,
    y: 10,
  };
  const rejectedPlacement: CoreHostCommand = {
    type: 'tool-command',
    commandId: 'cmd-place-reject',
    tool: 'road',
    x: 10,
    y: 10,
  };

  runtime.sendCommand(acceptedPlacement);
  let state = runtime.getState();

  // Client-side pending visuals are allowed, but authoritative commit is not.
  expect(state.pendingCommands).toEqual(['cmd-place-ok']);
  expect(state.pendingPlacements).toEqual([
    { commandId: 'cmd-place-ok', tool: 'road', x: 10, y: 10 },
  ]);
  expect(state.committedPlacements).toEqual([]);

  await flushCommandLifecycle();
  state = runtime.getState();

  expect(state.pendingCommands).toEqual([]);
  expect(state.pendingPlacements).toEqual([]);
  expect(state.committedPlacements).toEqual([
    { commandId: 'cmd-place-ok', tool: 'road', x: 10, y: 10 },
  ]);
  const fundsAfterSuccess = authority.simState.TotalFunds;
  expect(fundsAfterSuccess).toBe(initialFunds - ROAD_COST);
  expect(authority.toolContext.funds).toBe(fundsAfterSuccess);
  const tileAfterSuccess = readAuthoritativeTile(
    authority,
    acceptedPlacement.x,
    acceptedPlacement.y,
  );
  expect(tileAfterSuccess).toBe(ROADS);

  runtime.sendCommand(rejectedPlacement);
  state = runtime.getState();

  expect(state.pendingCommands).toEqual(['cmd-place-reject']);
  expect(state.pendingPlacements).toEqual([
    { commandId: 'cmd-place-reject', tool: 'road', x: 10, y: 10 },
  ]);
  expect(state.committedPlacements).toEqual([
    { commandId: 'cmd-place-ok', tool: 'road', x: 10, y: 10 },
  ]);

  await flushCommandLifecycle();
  state = runtime.getState();

  expect(state.pendingCommands).toEqual([]);
  expect(state.pendingPlacements).toEqual([]);
  expect(state.committedPlacements).toEqual([
    { commandId: 'cmd-place-ok', tool: 'road', x: 10, y: 10 },
  ]);
  const fundsAfterReject = authority.simState.TotalFunds;
  expect(fundsAfterReject).toBe(initialFunds - ROAD_COST);
  expect(authority.toolContext.funds).toBe(fundsAfterReject);
  const tileAfterReject = readAuthoritativeTile(
    authority,
    rejectedPlacement.x,
    rejectedPlacement.y,
  );
  expect(tileAfterReject).toBe(tileAfterSuccess);

  const commandLifecycleLog = [...state.commandLifecycleLog];
  const authoritativeSnapshotPlacements = await requestAuthoritativeSnapshot(runtime);

  state = runtime.getState();
  expect(state.committedPlacements).toEqual(authoritativeSnapshotPlacements);

  runtime.stop();
  return {
    commandLifecycleLog,
    authoritativeSnapshotPlacements,
    initialFunds,
    fundsAfterSuccess,
    fundsAfterReject,
  };
}

/**
 * Execute duplicate `commandId` retry behavior and return deterministic log.
 * Mirrors Stage idempotency requirements mapped to Micropolis tool commit semantics in
 * `ref/micropolis/src/sim/w_tool.c`: one commit, duplicate retries acknowledged.
 */
async function runDuplicateRetryLifecycle(mode: HostMode): Promise<ReadonlyArray<string>> {
  const runtime = createReadyRuntime(mode);

  const command: CoreHostCommand = {
    type: 'tool-command',
    commandId: 'cmd-duplicate',
    tool: 'road',
    x: 4,
    y: 6,
  };

  runtime.sendCommand(command);
  await flushCommandLifecycle();

  let state = runtime.getState();
  expect(state.committedPlacements).toEqual([
    { commandId: 'cmd-duplicate', tool: 'road', x: 4, y: 6 },
  ]);

  runtime.sendCommand(command);
  state = runtime.getState();

  expect(state.pendingCommands).toEqual(['cmd-duplicate']);
  expect(state.committedPlacements).toEqual([
    { commandId: 'cmd-duplicate', tool: 'road', x: 4, y: 6 },
  ]);

  await flushCommandLifecycle();
  state = runtime.getState();

  // Duplicate retry must not produce a second authoritative commit.
  expect(state.committedPlacements).toEqual([
    { commandId: 'cmd-duplicate', tool: 'road', x: 4, y: 6 },
  ]);

  runtime.stop();
  return state.commandLifecycleLog;
}

describe('runtime command lifecycle parity across host modes', () => {
  test('matches success/reject lifecycle logs for local and do modes', async () => {
    const localLifecycle = await runSuccessRejectLifecycle('local');
    const doLifecycle = await runSuccessRejectLifecycle('do');

    const expectedLog = [
      'pending:cmd-place-ok:road@10,10',
      'ack:cmd-place-ok',
      'patch:cmd-place-ok:road@10,10',
      'pending:cmd-place-reject:road@10,10',
      'reject:cmd-place-reject:INVALID_PLACEMENT',
    ];
    const expectedPlacements = [{ commandId: 'cmd-place-ok', tool: 'road', x: 10, y: 10 }] as const;

    expect(localLifecycle.commandLifecycleLog).toEqual(expectedLog);
    expect(doLifecycle.commandLifecycleLog).toEqual(expectedLog);
    expect(localLifecycle.authoritativeSnapshotPlacements).toEqual(expectedPlacements);
    expect(doLifecycle.authoritativeSnapshotPlacements).toEqual(expectedPlacements);
    expect(localLifecycle.initialFunds).toBe(INITIAL_FUNDS);
    expect(doLifecycle.initialFunds).toBe(INITIAL_FUNDS);
    expect(localLifecycle.fundsAfterSuccess).toBe(INITIAL_FUNDS - ROAD_COST);
    expect(doLifecycle.fundsAfterSuccess).toBe(INITIAL_FUNDS - ROAD_COST);
    expect(localLifecycle.fundsAfterReject).toBe(INITIAL_FUNDS - ROAD_COST);
    expect(doLifecycle.fundsAfterReject).toBe(INITIAL_FUNDS - ROAD_COST);
  });

  test('matches duplicate commandId retry logs for local and do modes', async () => {
    const localLifecycleLog = await runDuplicateRetryLifecycle('local');
    const doLifecycleLog = await runDuplicateRetryLifecycle('do');

    const expectedLog = [
      'pending:cmd-duplicate:road@4,6',
      'ack:cmd-duplicate',
      'patch:cmd-duplicate:road@4,6',
      'pending:cmd-duplicate:road@4,6',
      'ack:cmd-duplicate',
    ];

    expect(localLifecycleLog).toEqual(expectedLog);
    expect(doLifecycleLog).toEqual(expectedLog);
  });
});
