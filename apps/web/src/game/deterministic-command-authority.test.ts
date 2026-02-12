import { describe, expect, test } from 'vitest';

import { DeterministicCommandAuthority } from './deterministic-command-authority';

describe('DeterministicCommandAuthority', () => {
  test('bounds fallback replay retention and clamps stale snapshot cursors', () => {
    const authority = new DeterministicCommandAuthority({ mode: 'local' });
    const internals = authority as unknown as {
      readonly commandOutcomes: ReadonlyMap<string, unknown>;
      readonly sequencedEvents: Array<{ readonly serverSeq: number }>;
      readonly patchEvents: Array<{ readonly serverSeq: number }>;
      readonly snapshotReplayBaseline: {
        readonly baseServerSeq: number;
      };
    };

    for (let i = 0; i < 700; i += 1) {
      authority.processCommand({
        type: 'sim-control-command',
        commandId: `cmd-det-retain-${i}`,
        control: i % 2 === 0 ? 'pause' : 'resume',
      });
    }

    // Bounded command-outcome retention policy from
    // `apps/web/src/game/deterministic-command-authority.ts`, aligned with
    // Micropolis C fixed-size history intent (`HISTLEN`/`MISCHISTLEN`) in
    // `ref/micropolis/src/sim/headers/sim.h`.
    expect(internals.commandOutcomes.size).toBeLessThanOrEqual(512);
    // Bounded replay-tail retention policy from
    // `apps/web/src/game/deterministic-command-authority.ts`.
    expect(internals.sequencedEvents.length).toBeLessThanOrEqual(256);
    expect(internals.patchEvents.length).toBeLessThanOrEqual(256);

    const retainedBaselineServerSeq = internals.snapshotReplayBaseline.baseServerSeq;
    expect(retainedBaselineServerSeq).toBeGreaterThan(0);
    expect(
      internals.sequencedEvents.every((event) => event.serverSeq > retainedBaselineServerSeq),
    ).toBe(true);
    expect(
      internals.patchEvents.every((event) => event.serverSeq > retainedBaselineServerSeq),
    ).toBe(true);

    const replay = authority.createSnapshotReplay(0);
    const [snapshot, ...tail] = replay;
    expect(snapshot?.type).toBe('snapshot');
    if (snapshot?.type !== 'snapshot') {
      throw new Error('expected snapshot event');
    }
    expect(snapshot.baseServerSeq).toBe(retainedBaselineServerSeq);
    expect(
      tail.every(
        (event): event is Extract<(typeof tail)[number], { serverSeq: number }> =>
          'serverSeq' in event,
      ),
    ).toBe(true);
    const sequencedTail = tail.filter(
      (event): event is Extract<(typeof tail)[number], { serverSeq: number }> =>
        'serverSeq' in event,
    );
    expect(sequencedTail.every((event) => event.serverSeq > snapshot.baseServerSeq)).toBe(true);
  });
});
