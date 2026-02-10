import { describe, expect, test } from 'vitest';

import type {
  ClientEnvelope,
  HostAckEnvelope,
  HostEnvelope,
  HostPatchEnvelope,
  HostSnapshotEnvelope,
} from './protocol.ts';
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

interface Stage4SmokeSummary {
  envelopeKinds: HostEnvelope['kind'][];
  finalServerSeq: number;
  ackCount: number;
  patchCount: number;
  snapshotCount: number;
  rejectReasons: string[];
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
