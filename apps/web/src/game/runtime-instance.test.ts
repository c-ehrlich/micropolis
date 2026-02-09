import { describe, expect, test } from 'vitest';

import { DeterministicCommandAuthority } from './deterministic-command-authority';
import { gameRuntime } from './runtime-instance';
import { SimCoreCommandAuthority } from './sim-core-command-authority';

/**
 * Reads the Stage 4 authority implementation bound into the shared host singleton.
 * Mirrors Stage 1 host-owned simulation authority intent mapped from
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: direct field inspection is a TypeScript-only white-box test seam.
 */
function readStage4AuthorityForBootSmoke(host: unknown): unknown {
  if (typeof host !== 'object' || host === null || !('commandAuthority' in host)) {
    throw new Error('Expected LocalHost/DoHost host with commandAuthority wiring');
  }

  return (host as { commandAuthority: unknown }).commandAuthority;
}

describe('gameRuntime Stage 4 boot path', () => {
  test('boots through sim-core authority (not deterministic authority)', () => {
    gameRuntime.stop();

    const authority = readStage4AuthorityForBootSmoke(gameRuntime.host);
    expect(authority).toBeInstanceOf(SimCoreCommandAuthority);
    expect(authority).not.toBeInstanceOf(DeterministicCommandAuthority);

    gameRuntime.start();
    expect(gameRuntime.getState().status).toBe('ready');

    gameRuntime.stop();
    expect(gameRuntime.getState().status).toBe('stopped');
  });
});
