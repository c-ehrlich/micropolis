import { describe, expect, test } from 'vitest';

import type { CoreHostCommand, HostMode } from './core-host';
import { createCoreHost } from './host-factory';
import { createGameRuntime, type GameRuntime } from './runtime';

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
  const runtime = createGameRuntime(createCoreHost({ mode }));
  runtime.start();
  expect(runtime.getState().status).toBe('ready');
  return runtime;
}

/**
 * Execute one success + reject placement lifecycle and return the deterministic log.
 * Mirrors tool success (`DidTool`) versus non-mutating rejection behavior in
 * `ref/micropolis/src/sim/w_tool.c`.
 */
async function runSuccessRejectLifecycle(mode: HostMode): Promise<ReadonlyArray<string>> {
  const runtime = createReadyRuntime(mode);

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

  runtime.stop();
  return state.commandLifecycleLog;
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
    const localLifecycleLog = await runSuccessRejectLifecycle('local');
    const doLifecycleLog = await runSuccessRejectLifecycle('do');

    const expectedLog = [
      'pending:cmd-place-ok:road@10,10',
      'ack:cmd-place-ok',
      'patch:cmd-place-ok:road@10,10',
      'pending:cmd-place-reject:road@10,10',
      'reject:cmd-place-reject:INVALID_PLACEMENT',
    ];

    expect(localLifecycleLog).toEqual(expectedLog);
    expect(doLifecycleLog).toEqual(expectedLog);
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
