import { describe, expect, test, vi } from 'vitest';

import type {
  ClientEnvelope,
  HostAckEnvelope,
  HostEnvelope,
  HostPatchEnvelope,
  HostSnapshotEnvelope,
} from './protocol.ts';
import { createWebHostRuntime, type WebRuntimeEvent } from './runtime.ts';
import {
  createStage4PrimaryPlayableHost,
  readStage4CityExportPayload,
} from './stage4-primary-playable-host.ts';

/**
 * Wait for one host envelope that matches the provided predicate.
 * Mirrors async `LoadScenario` completion ordering in
 * `ref/micropolis/src/sim/s_fileio.c`, where the command settles after resource
 * bytes are loaded and applied.
 */
async function waitForHostEnvelope<TEnvelope extends HostEnvelope>(
  hostEnvelopes: readonly HostEnvelope[],
  predicate: (envelope: HostEnvelope) => envelope is TEnvelope,
  label: string,
): Promise<TEnvelope> {
  const timeoutMs = 5_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    for (let index = hostEnvelopes.length - 1; index >= 0; index -= 1) {
      const envelope = hostEnvelopes[index];
      if (envelope !== undefined && predicate(envelope)) {
        return envelope;
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error(`Timed out waiting for ${label}`);
}

type RuntimeEventWithEnvelope<TEnvelope extends HostEnvelope> = WebRuntimeEvent & {
  envelope: TEnvelope;
};

type HostRejectEnvelope = Extract<HostEnvelope, { kind: 'reject' }>;

/**
 * Wait for one runtime event that matches the provided predicate.
 * Mirrors staged command->ack->snapshot sequencing from `SimCmd` and update
 * propagation in `ref/micropolis/src/sim/w_sim.c` / `ref/micropolis/src/sim/w_update.c`.
 */
async function waitForRuntimeEvent<TEvent extends WebRuntimeEvent>(
  runtimeEvents: readonly WebRuntimeEvent[],
  predicate: (event: WebRuntimeEvent) => event is TEvent,
  label: string,
): Promise<TEvent> {
  const timeoutMs = 5_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    for (let index = runtimeEvents.length - 1; index >= 0; index -= 1) {
      const event = runtimeEvents[index];
      if (event !== undefined && predicate(event)) {
        return event;
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error(`Timed out waiting for ${label}`);
}

/**
 * Reads the latest authoritative sequence cursor from host envelopes.
 * Mirrors bridge snapshot-resync cursor semantics in
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
function readLatestServerSeq(hostEnvelopes: readonly HostEnvelope[]): number {
  let latestServerSeq = 0;
  for (const envelope of hostEnvelopes) {
    if ('serverSeq' in envelope && typeof envelope.serverSeq === 'number') {
      latestServerSeq = Math.max(latestServerSeq, envelope.serverSeq);
    }
  }
  return latestServerSeq;
}

/**
 * Reads the latest authoritative tick seen on host envelopes.
 * Mirrors monotonic frame/tick progression from `ref/micropolis/src/sim/s_sim.c`.
 */
function readLatestTick(hostEnvelopes: readonly HostEnvelope[]): number {
  let latestTick = 0;
  for (const envelope of hostEnvelopes) {
    if ('tick' in envelope && typeof envelope.tick === 'number') {
      latestTick = Math.max(latestTick, envelope.tick);
    }
  }
  return latestTick;
}

// Magic-number source: playable tool costs from `CostOf[]` in
// `ref/micropolis/src/sim/w_tool.c`.
const STAGE11_PLAYABLE_TOOL_COSTS = {
  road: 10,
  rail: 20,
  wire: 5,
  bulldoze: 1,
  res: 100,
  com: 100,
  ind: 100,
} as const;

const STAGE11_PLAYABLE_TOOL_CERTIFICATION_CASES = [
  { tool: 'road', placeX: 10, placeY: 10, rejectX: -1, rejectY: 10 },
  { tool: 'rail', placeX: 11, placeY: 10, rejectX: -1, rejectY: 11 },
  { tool: 'wire', placeX: 12, placeY: 10, rejectX: -1, rejectY: 12 },
  { tool: 'bulldoze', placeX: 10, placeY: 10, rejectX: -1, rejectY: 13 },
  { tool: 'res', placeX: 20, placeY: 20, rejectX: 0, rejectY: 20 },
  { tool: 'com', placeX: 30, placeY: 20, rejectX: 0, rejectY: 30 },
  { tool: 'ind', placeX: 40, placeY: 20, rejectX: 0, rejectY: 40 },
] as const;

const STAGE11_CADENCE_PATCH_INTERVAL_MS = 10;

function readFundsFromLabel(label: string): number {
  const digits = label.replaceAll(/[^0-9]/g, '');
  if (digits.length === 0) {
    return 0;
  }
  return Number.parseInt(digits, 10);
}

interface Stage4SmokeSummary {
  envelopeKinds: HostEnvelope['kind'][];
  finalServerSeq: number;
  ackCount: number;
  patchCount: number;
  snapshotCount: number;
  rejectReasons: string[];
}

/**
 * Certifies Stage 11 tool placement costs/rejects/funds on the host-envelope path.
 * Mirrors `do_tool` cost handling from `CostOf[]` and reject outcomes in
 * `ref/micropolis/src/sim/w_tool.c`.
 */
async function certifyStage11PlayableToolCostsOnHost(runId: string): Promise<void> {
  const host = createStage4PrimaryPlayableHost({ enableAmbientTicks: false });
  const hostEnvelopes: HostEnvelope[] = [];
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const newCityCommandId = `${runId}-cmd-new-city`;
  const connection = host.connect((envelope) => {
    hostEnvelopes.push(envelope);
  });

  try {
    connection.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'bridge-v1',
      coreVersion: 'sim-core',
    });

    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope => envelope.kind === 'snapshot',
      `${runId} boot snapshot`,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: newCityCommandId,
      command: {
        kind: 'city-lifecycle',
        action: 'new-city',
      },
    });
    const newCityAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === newCityCommandId,
      `${runId} new-city ack`,
    );
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > newCityAck.serverSeq,
      `${runId} new-city snapshot`,
    );

    let expectedFunds = 20_000;
    for (const toolCase of STAGE11_PLAYABLE_TOOL_CERTIFICATION_CASES) {
      const commandId = `${runId}-cmd-place-${toolCase.tool}`;
      connection.send({
        kind: 'command',
        roomId,
        clientId,
        commandId,
        command: {
          kind: 'tool',
          tool: toolCase.tool,
          x: toolCase.placeX,
          y: toolCase.placeY,
        },
      });

      const ack = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostAckEnvelope =>
          envelope.kind === 'ack' && envelope.commandId === commandId,
        `${runId} ${toolCase.tool} ack`,
      );
      const fundsPatch = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostPatchEnvelope =>
          envelope.kind === 'patch' &&
          envelope.serverSeq > ack.serverSeq &&
          envelope.payload.hud?.funds !== undefined,
        `${runId} ${toolCase.tool} funds patch`,
      );
      expectedFunds -= STAGE11_PLAYABLE_TOOL_COSTS[toolCase.tool];
      expect(fundsPatch.payload.hud?.funds).toBe(expectedFunds);
    }

    for (const toolCase of STAGE11_PLAYABLE_TOOL_CERTIFICATION_CASES) {
      const commandId = `${runId}-cmd-reject-${toolCase.tool}`;
      connection.send({
        kind: 'command',
        roomId,
        clientId,
        commandId,
        command: {
          kind: 'tool',
          tool: toolCase.tool,
          x: toolCase.rejectX,
          y: toolCase.rejectY,
        },
      });

      const reject = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostRejectEnvelope =>
          envelope.kind === 'reject' && envelope.commandId === commandId,
        `${runId} ${toolCase.tool} reject`,
      );
      expect(reject.reason).toBe('out-of-bounds');
    }

    const latestServerSeq = readLatestServerSeq(hostEnvelopes);
    connection.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      fromServerSeq: latestServerSeq,
      reason: 'manual',
    });
    const finalSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > latestServerSeq,
      `${runId} post-reject snapshot`,
    );
    expect(finalSnapshot.payload.hud?.funds).toBe(expectedFunds);
  } finally {
    connection.disconnect();
  }
}

/**
 * Certifies Stage 11 tool placement costs/rejects/funds on the shipped runtime path.
 * Mirrors tool command routing and reject propagation from
 * `ref/micropolis/src/sim/w_tool.c` through host envelope projection.
 */
async function certifyStage11PlayableToolCostsOnRuntime(runId: string): Promise<void> {
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const newCityCommandId = `${runId}-cmd-new-city`;
  const runtimeEvents: WebRuntimeEvent[] = [];
  const runtime = createWebHostRuntime({
    host: createStage4PrimaryPlayableHost({ enableAmbientTicks: false }),
    roomId,
    clientId,
  });
  const unsubscribe = runtime.subscribe((event) => {
    runtimeEvents.push(event);
  });

  try {
    runtime.connect();
    await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostSnapshotEnvelope> =>
        event.envelope?.kind === 'snapshot',
      `${runId} boot snapshot`,
    );

    runtime.sendCommand(newCityCommandId, {
      kind: 'city-lifecycle',
      action: 'new-city',
    });
    const newCityAck = await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostAckEnvelope> =>
        event.envelope?.kind === 'ack' && event.envelope.commandId === newCityCommandId,
      `${runId} new-city ack`,
    );
    await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostSnapshotEnvelope> =>
        event.envelope?.kind === 'snapshot' &&
        event.envelope.serverSeq > newCityAck.envelope.serverSeq,
      `${runId} new-city snapshot`,
    );

    let expectedFunds = 20_000;
    for (const toolCase of STAGE11_PLAYABLE_TOOL_CERTIFICATION_CASES) {
      const commandId = `${runId}-cmd-place-${toolCase.tool}`;
      runtime.sendCommand(commandId, {
        kind: 'tool',
        tool: toolCase.tool,
        x: toolCase.placeX,
        y: toolCase.placeY,
      });
      const ack = await waitForRuntimeEvent(
        runtimeEvents,
        (event): event is RuntimeEventWithEnvelope<HostAckEnvelope> =>
          event.envelope?.kind === 'ack' && event.envelope.commandId === commandId,
        `${runId} runtime ${toolCase.tool} ack`,
      );
      const fundsPatch = await waitForRuntimeEvent(
        runtimeEvents,
        (event): event is RuntimeEventWithEnvelope<HostPatchEnvelope> =>
          event.envelope?.kind === 'patch' &&
          event.envelope.serverSeq > ack.envelope.serverSeq &&
          event.envelope.payload.hud?.funds !== undefined,
        `${runId} runtime ${toolCase.tool} funds patch`,
      );
      expectedFunds -= STAGE11_PLAYABLE_TOOL_COSTS[toolCase.tool];
      expect(fundsPatch.envelope.payload.hud?.funds).toBe(expectedFunds);
      expect(readFundsFromLabel(runtime.getState().hudState.fundsLabel)).toBe(expectedFunds);
    }

    for (const toolCase of STAGE11_PLAYABLE_TOOL_CERTIFICATION_CASES) {
      const commandId = `${runId}-cmd-reject-${toolCase.tool}`;
      runtime.sendCommand(commandId, {
        kind: 'tool',
        tool: toolCase.tool,
        x: toolCase.rejectX,
        y: toolCase.rejectY,
      });
      const reject = await waitForRuntimeEvent(
        runtimeEvents,
        (event): event is RuntimeEventWithEnvelope<HostRejectEnvelope> =>
          event.envelope?.kind === 'reject' && event.envelope.commandId === commandId,
        `${runId} runtime ${toolCase.tool} reject`,
      );
      expect(reject.envelope.reason).toBe('out-of-bounds');
      expect(runtime.getState().lastRejectReason).toBe('out-of-bounds');
      expect(readFundsFromLabel(runtime.getState().hudState.fundsLabel)).toBe(expectedFunds);
    }

    const snapshotCursor = runtime.getState().lastAppliedServerSeq;
    runtime.requestSnapshot('manual');
    const finalSnapshot = await waitForRuntimeEvent(
      runtimeEvents,
      (event): event is RuntimeEventWithEnvelope<HostSnapshotEnvelope> =>
        event.envelope?.kind === 'snapshot' && event.envelope.serverSeq > snapshotCursor,
      `${runId} runtime post-reject snapshot`,
    );
    expect(finalSnapshot.envelope.payload.hud?.funds).toBe(expectedFunds);
  } finally {
    unsubscribe();
    runtime.disconnect();
  }
}

/**
 * Certifies Stage 11 speed/pause cadence changes on host envelopes.
 * Mirrors `Pause`/`Resume`/`setSpeed` from `ref/micropolis/src/sim/w_util.c`
 * and `Spdcycle` speed gates in `ref/micropolis/src/sim/s_sim.c`.
 */
function certifyStage11PlayableCadenceOnHost(runId: string): void {
  vi.useFakeTimers();
  const host = createStage4PrimaryPlayableHost({
    enableAmbientTicks: true,
    patchIntervalMs: STAGE11_CADENCE_PATCH_INTERVAL_MS,
  });
  const hostEnvelopes: HostEnvelope[] = [];
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const connection = host.connect((envelope) => {
    hostEnvelopes.push(envelope);
  });

  const requestSnapshot = (label: string): HostSnapshotEnvelope => {
    const previousServerSeq = readLatestServerSeq(hostEnvelopes);
    connection.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      reason: 'manual',
      fromServerSeq: previousServerSeq,
    });
    for (let index = hostEnvelopes.length - 1; index >= 0; index -= 1) {
      const envelope = hostEnvelopes[index];
      if (
        envelope !== undefined &&
        envelope.kind === 'snapshot' &&
        envelope.serverSeq > previousServerSeq
      ) {
        return envelope;
      }
    }
    throw new Error(`Expected ${label} snapshot envelope`);
  };

  const sendSimControl = (
    commandId: string,
    command: Extract<ClientEnvelope, { kind: 'command' }>['command'],
  ): void => {
    const previousServerSeq = readLatestServerSeq(hostEnvelopes);
    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId,
      command,
    });
    expect(readLatestServerSeq(hostEnvelopes)).toBeGreaterThan(previousServerSeq);
  };

  try {
    connection.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'bridge-v1',
      coreVersion: 'sim-core',
    });

    const bootSnapshot = requestSnapshot(`${runId} boot`);
    expect(bootSnapshot.payload.hud?.speed).toBe(3);

    sendSimControl(`${runId}-cmd-speed-1`, {
      kind: 'sim-control',
      control: 'set-speed',
      speed: 1,
    });
    const speedOneBefore = requestSnapshot(`${runId} speed-1 before`);
    expect(speedOneBefore.payload.hud?.speed).toBe(1);
    vi.advanceTimersByTime(STAGE11_CADENCE_PATCH_INTERVAL_MS * 5);
    const speedOneAfter = requestSnapshot(`${runId} speed-1 after`);
    // Magic-number source: speed 1 emits one sim step every 5 `Spdcycle` loops in
    // `ref/micropolis/src/sim/s_sim.c`.
    expect(speedOneAfter.tick - speedOneBefore.tick).toBe(1);

    sendSimControl(`${runId}-cmd-speed-2`, {
      kind: 'sim-control',
      control: 'set-speed',
      speed: 2,
    });
    const speedTwoBefore = requestSnapshot(`${runId} speed-2 before`);
    expect(speedTwoBefore.payload.hud?.speed).toBe(2);
    vi.advanceTimersByTime(STAGE11_CADENCE_PATCH_INTERVAL_MS * 6);
    const speedTwoAfter = requestSnapshot(`${runId} speed-2 after`);
    // Magic-number source: speed 2 emits one sim step every 3 `Spdcycle` loops in
    // `ref/micropolis/src/sim/s_sim.c`.
    expect(speedTwoAfter.tick - speedTwoBefore.tick).toBe(2);

    sendSimControl(`${runId}-cmd-speed-3`, {
      kind: 'sim-control',
      control: 'set-speed',
      speed: 3,
    });
    const speedThreeBefore = requestSnapshot(`${runId} speed-3 before`);
    expect(speedThreeBefore.payload.hud?.speed).toBe(3);
    vi.advanceTimersByTime(STAGE11_CADENCE_PATCH_INTERVAL_MS * 6);
    const speedThreeAfter = requestSnapshot(`${runId} speed-3 after`);
    // Magic-number source: speed 3 steps each ambient cycle (no modulo gate) in
    // `ref/micropolis/src/sim/s_sim.c`.
    expect(speedThreeAfter.tick - speedThreeBefore.tick).toBe(6);

    sendSimControl(`${runId}-cmd-pause`, {
      kind: 'sim-control',
      control: 'pause',
    });
    const pausedBefore = requestSnapshot(`${runId} paused before`);
    expect(pausedBefore.payload.hud?.speed).toBe(0);
    vi.advanceTimersByTime(STAGE11_CADENCE_PATCH_INTERVAL_MS * 12);
    const pausedAfter = requestSnapshot(`${runId} paused after`);
    expect(pausedAfter.payload.hud?.speed).toBe(0);
    expect(pausedAfter.tick - pausedBefore.tick).toBe(0);

    sendSimControl(`${runId}-cmd-play`, {
      kind: 'sim-control',
      control: 'play',
    });
    const resumedBefore = requestSnapshot(`${runId} resumed before`);
    // Magic-number source: `Resume()` restores prior paused speed from
    // `ref/micropolis/src/sim/w_util.c`.
    expect(resumedBefore.payload.hud?.speed).toBe(3);
    vi.advanceTimersByTime(STAGE11_CADENCE_PATCH_INTERVAL_MS * 4);
    const resumedAfter = requestSnapshot(`${runId} resumed after`);
    expect(resumedAfter.payload.hud?.speed).toBe(3);
    expect(resumedAfter.tick - resumedBefore.tick).toBe(4);

    expect(readLatestTick(hostEnvelopes)).toBeGreaterThan(0);
  } finally {
    connection.disconnect();
    vi.useRealTimers();
  }
}

/**
 * Certifies Stage 11 speed/pause cadence changes on the shipped runtime path.
 * Mirrors host cadence gates from `ref/micropolis/src/sim/s_sim.c` projected
 * through Stage 4 runtime envelopes.
 */
function certifyStage11PlayableCadenceOnRuntime(runId: string): void {
  vi.useFakeTimers();
  const runtime = createWebHostRuntime({
    host: createStage4PrimaryPlayableHost({
      enableAmbientTicks: true,
      patchIntervalMs: STAGE11_CADENCE_PATCH_INTERVAL_MS,
    }),
    roomId: `${runId}-room`,
    clientId: `${runId}-client`,
  });

  const requestSnapshot = (): { tick: number; speed: number; serverSeq: number } => {
    const previousServerSeq = runtime.getState().lastAppliedServerSeq;
    runtime.requestSnapshot('manual');
    const state = runtime.getState();
    expect(state.lastAppliedServerSeq).toBeGreaterThan(previousServerSeq);
    return {
      tick: state.lastAppliedTick,
      speed: state.hudState.speed,
      serverSeq: state.lastAppliedServerSeq,
    };
  };

  try {
    runtime.connect();

    const bootSnapshot = requestSnapshot();
    expect(bootSnapshot.speed).toBe(3);

    runtime.sendCommand(`${runId}-cmd-speed-1`, {
      kind: 'sim-control',
      control: 'set-speed',
      speed: 1,
    });
    const speedOneBefore = requestSnapshot();
    expect(speedOneBefore.speed).toBe(1);
    vi.advanceTimersByTime(STAGE11_CADENCE_PATCH_INTERVAL_MS * 5);
    const speedOneAfter = requestSnapshot();
    // Magic-number source: speed 1 modulo gate (`Spdcycle % 5`) in
    // `ref/micropolis/src/sim/s_sim.c`.
    expect(speedOneAfter.tick - speedOneBefore.tick).toBe(1);

    runtime.sendCommand(`${runId}-cmd-speed-2`, {
      kind: 'sim-control',
      control: 'set-speed',
      speed: 2,
    });
    const speedTwoBefore = requestSnapshot();
    expect(speedTwoBefore.speed).toBe(2);
    vi.advanceTimersByTime(STAGE11_CADENCE_PATCH_INTERVAL_MS * 6);
    const speedTwoAfter = requestSnapshot();
    // Magic-number source: speed 2 modulo gate (`Spdcycle % 3`) in
    // `ref/micropolis/src/sim/s_sim.c`.
    expect(speedTwoAfter.tick - speedTwoBefore.tick).toBe(2);

    runtime.sendCommand(`${runId}-cmd-speed-3`, {
      kind: 'sim-control',
      control: 'set-speed',
      speed: 3,
    });
    const speedThreeBefore = requestSnapshot();
    expect(speedThreeBefore.speed).toBe(3);
    vi.advanceTimersByTime(STAGE11_CADENCE_PATCH_INTERVAL_MS * 6);
    const speedThreeAfter = requestSnapshot();
    expect(speedThreeAfter.tick - speedThreeBefore.tick).toBe(6);

    runtime.sendCommand(`${runId}-cmd-pause`, {
      kind: 'sim-control',
      control: 'pause',
    });
    const pausedBefore = requestSnapshot();
    expect(pausedBefore.speed).toBe(0);
    vi.advanceTimersByTime(STAGE11_CADENCE_PATCH_INTERVAL_MS * 12);
    const pausedAfter = requestSnapshot();
    expect(pausedAfter.speed).toBe(0);
    expect(pausedAfter.tick - pausedBefore.tick).toBe(0);

    runtime.sendCommand(`${runId}-cmd-play`, {
      kind: 'sim-control',
      control: 'play',
    });
    const resumedBefore = requestSnapshot();
    expect(resumedBefore.speed).toBe(3);
    vi.advanceTimersByTime(STAGE11_CADENCE_PATCH_INTERVAL_MS * 4);
    const resumedAfter = requestSnapshot();
    expect(resumedAfter.speed).toBe(3);
    expect(resumedAfter.tick - resumedBefore.tick).toBe(4);
  } finally {
    runtime.disconnect();
    vi.useRealTimers();
  }
}

/**
 * Runs one Stage 4 default-host smoke flow and returns deterministic envelope summary data.
 * Mirrors `SimCmd`/`LoadScenario`/save-load command completion flow in
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this is a test harness wrapper over bridge envelopes; runtime behavior is unchanged.
 */
async function runStage4PrimaryPlayableSmokeFlow(runId: string): Promise<Stage4SmokeSummary> {
  const host = createStage4PrimaryPlayableHost({ enableAmbientTicks: false });
  const hostEnvelopes: HostEnvelope[] = [];
  const roomId = `${runId}-room`;
  const clientId = `${runId}-client`;
  const commandIds = {
    newCity: `${runId}-cmd-new-city`,
    road: `${runId}-cmd-road`,
    speedOne: `${runId}-cmd-speed-one`,
    pause: `${runId}-cmd-pause`,
    play: `${runId}-cmd-play`,
    speedThree: `${runId}-cmd-speed-three`,
    save: `${runId}-cmd-save`,
    bulldoze: `${runId}-cmd-bulldoze`,
    load: `${runId}-cmd-load`,
    scenario: `${runId}-cmd-scenario`,
    invalid: `${runId}-cmd-invalid`,
  } as const;
  const connection = host.connect((envelope) => {
    hostEnvelopes.push(envelope);
  });

  try {
    connection.send({
      kind: 'hello',
      roomId,
      clientId,
      protocolVersion: 'bridge-v1',
      coreVersion: 'sim-core',
    });
    expect(hostEnvelopes[0]).toMatchObject({
      kind: 'hello',
      accepted: true,
    });

    const bootSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope => envelope.kind === 'snapshot',
      `${runId} boot snapshot`,
    );
    expect(bootSnapshot.tick).toBe(0);
    expect(bootSnapshot.serverSeq).toBe(1);
    // Magic number source: initial city funds baseline in `setAnyCityName` /
    // `DoSimInit` bootstrap flow in `ref/micropolis/src/sim/s_init.c`.
    expect(bootSnapshot.payload.hud?.funds).toBe(20_000);
    expect(bootSnapshot.payload.map?.width).toBeGreaterThan(0);
    expect(bootSnapshot.payload.map?.height).toBeGreaterThan(0);
    expect(bootSnapshot.payload.hud?.speed).toBeGreaterThan(0);
    expect(bootSnapshot.payload.realtime?.objects?.length ?? 0).toBeGreaterThan(0);

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.newCity,
      command: {
        kind: 'city-lifecycle',
        action: 'new-city',
      },
    });
    const newCityAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.newCity,
      `${runId} new-city ack`,
    );
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > newCityAck.serverSeq,
      `${runId} new-city snapshot`,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.road,
      command: {
        kind: 'tool',
        tool: 'road',
        x: 10,
        y: 10,
      },
    });

    const roadAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.road,
      `${runId} road command ack`,
    );
    const roadFundsPatch = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > roadAck.serverSeq &&
        envelope.payload.hud?.funds !== undefined,
      `${runId} road funds patch`,
    );
    // Magic number source: road cost `10` from `CostOf[]` in
    // `ref/micropolis/src/sim/w_tool.c`.
    expect(roadFundsPatch.payload.hud?.funds).toBe(19_990);
    expect(roadFundsPatch.payload.hud?.date).toBeDefined();

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.speedOne,
      command: {
        kind: 'sim-control',
        control: 'set-speed',
        speed: 1,
      },
    });
    const speedOneAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.speedOne,
      `${runId} speed 1 ack`,
    );
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > speedOneAck.serverSeq &&
        envelope.payload.hud?.speed === 1,
      `${runId} speed 1 patch`,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.pause,
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });
    const pauseAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.pause,
      `${runId} pause ack`,
    );
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > pauseAck.serverSeq &&
        envelope.payload.hud?.speed === 0,
      `${runId} pause patch`,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.play,
      command: {
        kind: 'sim-control',
        control: 'play',
      },
    });
    const playAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.play,
      `${runId} play ack`,
    );
    const playPatch = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > playAck.serverSeq &&
        envelope.payload.hud?.speed === 1,
      `${runId} play patch`,
    );
    expect(playPatch.payload.realtime?.objects?.length ?? 0).toBeGreaterThan(0);

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.speedThree,
      command: {
        kind: 'sim-control',
        control: 'set-speed',
        speed: 3,
      },
    });
    const speedThreeAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.speedThree,
      `${runId} speed 3 ack`,
    );
    await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > speedThreeAck.serverSeq &&
        envelope.payload.hud?.speed === 3,
      `${runId} speed 3 patch`,
    );

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.save,
      command: {
        kind: 'city-io',
        action: 'save-city',
        fileName: 'stage4-smoke.cty',
      },
    });

    const savePatch = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' && readStage4CityExportPayload(envelope.payload) !== null,
      `${runId} save-city patch payload`,
    );

    const savePayload = readStage4CityExportPayload(savePatch.payload);
    expect(savePayload).not.toBeNull();
    if (savePayload === null) {
      throw new Error('Expected Stage 4 save payload');
    }
    expect(savePatch.payload.messageDeltas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 30,
        }),
      ]),
    );

    // Magic number source: `.cty` city payload byte count in `s_fileio.c`.
    expect(savePayload.cityBytes.byteLength).toBe(27120);

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.bulldoze,
      command: {
        kind: 'tool',
        tool: 'bulldoze',
        x: 10,
        y: 10,
      },
    });
    const bulldozeAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.bulldoze,
      `${runId} bulldoze ack`,
    );
    const bulldozeFundsPatch = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostPatchEnvelope =>
        envelope.kind === 'patch' &&
        envelope.serverSeq > bulldozeAck.serverSeq &&
        envelope.payload.hud?.funds !== undefined,
      `${runId} bulldoze funds patch`,
    );
    // Magic number source: bulldozer cost `1` from `CostOf[]` in
    // `ref/micropolis/src/sim/w_tool.c`.
    expect(bulldozeFundsPatch.payload.hud?.funds).toBe(19_989);

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.load,
      command: {
        kind: 'city-io',
        action: 'load-city',
        fileName: 'stage4-smoke.cty',
        cityBytes: savePayload.cityBytes,
      },
    });
    const loadAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.load,
      `${runId} load-city ack`,
    );
    const loadSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > loadAck.serverSeq,
      `${runId} load-city snapshot`,
    );
    // Magic number source: restore returns to the saved post-road funds value
    // (`20000 - 10`) using `SaveCityAs`/`loadFile` parity in `s_fileio.c`.
    expect(loadSnapshot.payload.hud?.funds).toBe(19_990);
    expect(loadSnapshot.payload.messages?.[0]?.text).toContain('Loaded');

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.scenario,
      command: {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: 1,
      },
    });
    const scenarioAck = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostAckEnvelope =>
        envelope.kind === 'ack' && envelope.commandId === commandIds.scenario,
      `${runId} scenario ack`,
    );
    const scenarioSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > scenarioAck.serverSeq,
      `${runId} scenario snapshot`,
    );
    // Magic numbers source: scenario 1 (`Dullsville`) metadata constants in
    // `LoadScenario` (`ref/micropolis/src/sim/s_fileio.c`): funds=5000, year=1900.
    expect(scenarioSnapshot.payload.hud?.funds).toBe(5_000);
    expect(scenarioSnapshot.payload.hud?.date?.year).toBe(1900);
    // Magic number source: `LoadScenario` applies visible speed `3` after init
    // in `ref/micropolis/src/sim/s_fileio.c`.
    expect(scenarioSnapshot.payload.hud?.speed).toBe(3);
    expect(scenarioSnapshot.payload.realtime?.objects?.length ?? 0).toBeGreaterThan(0);

    const lastServerSeq = readLatestServerSeq(hostEnvelopes);
    connection.send({
      kind: 'request_snapshot',
      roomId,
      clientId,
      fromServerSeq: lastServerSeq,
      reason: 'resync',
    });
    const resyncSnapshot = await waitForHostEnvelope(
      hostEnvelopes,
      (envelope): envelope is HostSnapshotEnvelope =>
        envelope.kind === 'snapshot' && envelope.serverSeq > lastServerSeq,
      `${runId} resync snapshot`,
    );
    expect(resyncSnapshot.serverSeq).toBeGreaterThan(lastServerSeq);
    expect(resyncSnapshot.payload.hud?.funds).toBe(5_000);

    connection.send({
      kind: 'command',
      roomId,
      clientId,
      commandId: commandIds.invalid,
      command: {
        kind: 'invalid-kind',
      },
    } as unknown as ClientEnvelope);

    expect(hostEnvelopes.some((envelope) => envelope.kind === 'ack')).toBe(true);
    expect(
      hostEnvelopes.some(
        (envelope) =>
          envelope.kind === 'reject' &&
          envelope.commandId === commandIds.invalid &&
          envelope.reason === 'invalid-command',
      ),
    ).toBe(true);

    return {
      envelopeKinds: hostEnvelopes.map((envelope) => envelope.kind),
      finalServerSeq: readLatestServerSeq(hostEnvelopes),
      ackCount: hostEnvelopes.filter((envelope) => envelope.kind === 'ack').length,
      patchCount: hostEnvelopes.filter((envelope) => envelope.kind === 'patch').length,
      snapshotCount: hostEnvelopes.filter((envelope) => envelope.kind === 'snapshot').length,
      rejectReasons: hostEnvelopes
        .filter((envelope): envelope is Extract<HostEnvelope, { kind: 'reject' }> => {
          return envelope.kind === 'reject';
        })
        .map((envelope) => envelope.reason),
    };
  } finally {
    connection.disconnect();
  }
}

/**
 * Command-surface smoke for the Stage 4 default host factory.
 * Mirrors `SimCmd` table routing intent in `ref/micropolis/src/sim/w_sim.c`,
 * where tool/sim/lifecycle/io subcommands all flow through one command surface.
 * Parity note: typed envelopes replace Tcl argv dispatch.
 */
describe('createStage4PrimaryPlayableHost', () => {
  test('certifies new-city snapshot loads authoritative map and HUD heads', async () => {
    const host = createStage4PrimaryPlayableHost({ enableAmbientTicks: false });
    const hostEnvelopes: HostEnvelope[] = [];
    const runId = 'stage11-new-city-map-hud';
    const roomId = `${runId}-room`;
    const clientId = `${runId}-client`;
    const commandId = `${runId}-cmd-new-city`;
    const connection = host.connect((envelope) => {
      hostEnvelopes.push(envelope);
    });

    try {
      connection.send({
        kind: 'hello',
        roomId,
        clientId,
        protocolVersion: 'bridge-v1',
        coreVersion: 'sim-core',
      });

      await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostSnapshotEnvelope => envelope.kind === 'snapshot',
        `${runId} boot snapshot`,
      );

      connection.send({
        kind: 'command',
        roomId,
        clientId,
        commandId,
        command: {
          kind: 'city-lifecycle',
          action: 'new-city',
        },
      });
      const newCityAck = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostAckEnvelope =>
          envelope.kind === 'ack' && envelope.commandId === commandId,
        `${runId} new-city ack`,
      );
      const newCitySnapshot = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostSnapshotEnvelope =>
          envelope.kind === 'snapshot' && envelope.serverSeq > newCityAck.serverSeq,
        `${runId} new-city snapshot`,
      );

      // Magic numbers source: classic world dimensions (`WORLD_X=120`, `WORLD_Y=100`)
      // and `DoNewCity` startup baseline from `ref/micropolis/src/sim/s_init.c`.
      expect(newCitySnapshot.payload.map?.width).toBe(120);
      expect(newCitySnapshot.payload.map?.height).toBe(100);
      const snapshotMap = newCitySnapshot.payload.map;
      expect(snapshotMap).toBeDefined();
      if (snapshotMap === undefined) {
        throw new Error(`${runId} new-city snapshot missing map payload`);
      }
      const mapTileWordCount =
        'tileWords' in snapshotMap ? snapshotMap.tileWords.length : snapshotMap.tiles.length;
      expect(mapTileWordCount).toBe(120 * 100);
      expect(newCitySnapshot.payload.hud?.funds).toBe(20_000);
      expect(newCitySnapshot.payload.hud?.speed).toBe(3);
      expect(newCitySnapshot.payload.hud?.date?.year).toBe(1900);
      expect(newCitySnapshot.payload.hud?.date?.month).toBe(0);
    } finally {
      connection.disconnect();
    }
  });

  test('certifies runtime new-city command hydrates map + HUD on the shipped Stage 4 route', async () => {
    const runId = 'stage11-new-city-runtime-map-hud';
    const roomId = `${runId}-room`;
    const clientId = `${runId}-client`;
    const commandId = `${runId}-cmd-new-city`;
    const runtimeEvents: WebRuntimeEvent[] = [];
    const runtime = createWebHostRuntime({
      host: createStage4PrimaryPlayableHost({ enableAmbientTicks: false }),
      roomId,
      clientId,
    });
    const unsubscribe = runtime.subscribe((event) => {
      runtimeEvents.push(event);
    });

    try {
      runtime.connect();
      await waitForRuntimeEvent(
        runtimeEvents,
        (event): event is RuntimeEventWithEnvelope<HostSnapshotEnvelope> =>
          event.envelope?.kind === 'snapshot',
        `${runId} boot snapshot`,
      );

      runtime.sendCommand(commandId, {
        kind: 'city-lifecycle',
        action: 'new-city',
      });
      const newCityAck = await waitForRuntimeEvent(
        runtimeEvents,
        (event): event is RuntimeEventWithEnvelope<HostAckEnvelope> =>
          event.envelope?.kind === 'ack' && event.envelope.commandId === commandId,
        `${runId} new-city ack`,
      );
      await waitForRuntimeEvent(
        runtimeEvents,
        (event): event is RuntimeEventWithEnvelope<HostSnapshotEnvelope> =>
          event.envelope?.kind === 'snapshot' &&
          event.envelope.serverSeq > newCityAck.envelope.serverSeq,
        `${runId} new-city snapshot`,
      );

      const state = runtime.getState();
      // Magic number source: `WORLD_X=120`, `WORLD_Y=100`, and `DoNewCity` baseline
      // (`TotalFunds=20000`, Jan 1900, speed 3) in `ref/micropolis/src/sim/s_init.c`.
      expect(state.mapState.width).toBe(120);
      expect(state.mapState.height).toBe(100);
      expect(state.mapState.tiles).toHaveLength(120 * 100);
      expect(state.hudState.fundsLabel).toBe('Funds: $20,000');
      expect(state.hudState.dateYear).toBe(1900);
      expect(state.hudState.dateMonth).toBe(0);
      expect(state.hudState.speed).toBe(3);
    } finally {
      unsubscribe();
      runtime.disconnect();
    }
  });

  test('certifies host tool placements for road/rail/wire/bulldoze/R/C/I costs/rejects/funds', async () => {
    await certifyStage11PlayableToolCostsOnHost('stage11-tool-costs-host');
  });

  test('certifies runtime tool placements for road/rail/wire/bulldoze/R/C/I costs/rejects/funds', async () => {
    await certifyStage11PlayableToolCostsOnRuntime('stage11-tool-costs-runtime');
  });

  test('certifies host speed 1/2/3 with pause/resume cadence changes', () => {
    certifyStage11PlayableCadenceOnHost('stage11-cadence-host');
  });

  test('certifies runtime speed 1/2/3 with pause/resume cadence changes on Stage 4 route', () => {
    certifyStage11PlayableCadenceOnRuntime('stage11-cadence-runtime');
  });

  test('proves the shipped Stage 4 host path is playable end-to-end', async () => {
    const summary = await runStage4PrimaryPlayableSmokeFlow('stage4-smoke-main');
    expect(summary.rejectReasons).toEqual(['invalid-command']);
  });

  test('remains deterministic across repeated Stage 4 smoke runs', async () => {
    const run1 = await runStage4PrimaryPlayableSmokeFlow('stage4-smoke-repeat-1');
    const run2 = await runStage4PrimaryPlayableSmokeFlow('stage4-smoke-repeat-2');
    const run3 = await runStage4PrimaryPlayableSmokeFlow('stage4-smoke-repeat-3');

    expect(run2).toStrictEqual(run1);
    expect(run3).toStrictEqual(run1);
  });
});

/**
 * Stage 4 save-payload parser checks.
 * Mirrors `SaveCityAs` payload ownership in `ref/micropolis/src/sim/s_fileio.c`,
 * while preserving strict envelope-shape checks in TypeScript.
 */
describe('readStage4CityExportPayload', () => {
  test('accepts valid save payloads and rejects malformed payloads', () => {
    const validBytes = new Uint8Array([1, 2, 3, 4]);
    expect(
      readStage4CityExportPayload({
        cityIo: {
          save: {
            fileName: 'city.cty',
            cityName: 'City',
            cityBytes: validBytes,
          },
        },
      }),
    ).toEqual({
      fileName: 'city.cty',
      cityName: 'City',
      cityBytes: validBytes,
    });

    expect(readStage4CityExportPayload(null)).toBeNull();
    expect(readStage4CityExportPayload({ cityIo: {} })).toBeNull();
    expect(
      readStage4CityExportPayload({
        cityIo: {
          save: {
            fileName: 'city.cty',
            cityName: 'City',
            cityBytes: [1, 2, 3],
          },
        },
      }),
    ).toBeNull();
  });
});
