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

/**
 * Command-surface smoke for the Stage 4 default host factory.
 * Mirrors `SimCmd` table routing intent in `ref/micropolis/src/sim/w_sim.c`,
 * where tool/sim/lifecycle/io subcommands all flow through one command surface.
 * Parity note: typed envelopes replace Tcl argv dispatch.
 */
describe('createStage4PrimaryPlayableHost', () => {
  test('covers Stage 4 smoke flow for boot, tools+funds, save/load, scenario, and resync', async () => {
    const host = createStage4PrimaryPlayableHost({ enableAmbientTicks: false });
    const hostEnvelopes: HostEnvelope[] = [];
    const connection = host.connect((envelope) => {
      hostEnvelopes.push(envelope);
    });

    try {
      connection.send({
        kind: 'hello',
        roomId: 'stage4-room',
        clientId: 'stage4-client',
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
        'boot snapshot',
      );
      expect(bootSnapshot.tick).toBe(0);
      expect(bootSnapshot.serverSeq).toBe(1);
      // Magic number source: initial city funds baseline in `setAnyCityName` /
      // `DoSimInit` bootstrap flow in `ref/micropolis/src/sim/s_init.c`.
      expect(bootSnapshot.payload.hud?.funds).toBe(20_000);

      connection.send({
        kind: 'command',
        roomId: 'stage4-room',
        clientId: 'stage4-client',
        commandId: 'cmd-new-city',
        command: {
          kind: 'city-lifecycle',
          action: 'new-city',
        },
      });
      connection.send({
        kind: 'command',
        roomId: 'stage4-room',
        clientId: 'stage4-client',
        commandId: 'cmd-road',
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
          envelope.kind === 'ack' && envelope.commandId === 'cmd-road',
        'road command ack',
      );
      const roadFundsPatch = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostPatchEnvelope =>
          envelope.kind === 'patch' &&
          envelope.serverSeq > roadAck.serverSeq &&
          envelope.payload.hud?.funds !== undefined,
        'road funds patch',
      );
      // Magic number source: road cost `10` from `CostOf[]` in
      // `ref/micropolis/src/sim/w_tool.c`.
      expect(roadFundsPatch.payload.hud?.funds).toBe(19_990);

      connection.send({
        kind: 'command',
        roomId: 'stage4-room',
        clientId: 'stage4-client',
        commandId: 'cmd-speed',
        command: {
          kind: 'sim-control',
          control: 'set-speed',
          speed: 2,
        },
      });
      connection.send({
        kind: 'command',
        roomId: 'stage4-room',
        clientId: 'stage4-client',
        commandId: 'cmd-save',
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
        'save-city patch payload',
      );

      const savePayload = readStage4CityExportPayload(savePatch.payload);
      expect(savePayload).not.toBeNull();
      if (savePayload === null) {
        throw new Error('Expected Stage 4 save payload');
      }

      // Magic number source: `.cty` city payload byte count in `s_fileio.c`.
      expect(savePayload.cityBytes.byteLength).toBe(27120);

      connection.send({
        kind: 'command',
        roomId: 'stage4-room',
        clientId: 'stage4-client',
        commandId: 'cmd-load',
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
          envelope.kind === 'ack' && envelope.commandId === 'cmd-load',
        'load-city ack',
      );
      await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostSnapshotEnvelope =>
          envelope.kind === 'snapshot' && envelope.serverSeq > loadAck.serverSeq,
        'load-city snapshot',
      );

      connection.send({
        kind: 'command',
        roomId: 'stage4-room',
        clientId: 'stage4-client',
        commandId: 'cmd-scenario',
        command: {
          kind: 'scenario',
          action: 'load-scenario',
          scenarioId: 1,
        },
      });
      const scenarioAck = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostAckEnvelope =>
          envelope.kind === 'ack' && envelope.commandId === 'cmd-scenario',
        'scenario ack',
      );
      const scenarioSnapshot = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostSnapshotEnvelope =>
          envelope.kind === 'snapshot' && envelope.serverSeq > scenarioAck.serverSeq,
        'scenario snapshot',
      );
      // Magic numbers source: scenario 1 (`Dullsville`) metadata constants in
      // `LoadScenario` (`ref/micropolis/src/sim/s_fileio.c`): funds=5000, year=1900.
      expect(scenarioSnapshot.payload.hud?.funds).toBe(5_000);
      expect(scenarioSnapshot.payload.hud?.date?.year).toBe(1900);

      const lastServerSeq = readLatestServerSeq(hostEnvelopes);
      connection.send({
        kind: 'request_snapshot',
        roomId: 'stage4-room',
        clientId: 'stage4-client',
        fromServerSeq: lastServerSeq,
        reason: 'resync',
      });
      const resyncSnapshot = await waitForHostEnvelope(
        hostEnvelopes,
        (envelope): envelope is HostSnapshotEnvelope =>
          envelope.kind === 'snapshot' && envelope.serverSeq > lastServerSeq,
        'resync snapshot',
      );
      expect(resyncSnapshot.serverSeq).toBeGreaterThan(lastServerSeq);
      expect(resyncSnapshot.payload.hud?.funds).toBe(5_000);

      connection.send({
        kind: 'command',
        roomId: 'stage4-room',
        clientId: 'stage4-client',
        commandId: 'cmd-invalid',
        command: {
          kind: 'invalid-kind',
        },
      } as unknown as ClientEnvelope);

      expect(hostEnvelopes.some((envelope) => envelope.kind === 'ack')).toBe(true);
      expect(
        hostEnvelopes.some(
          (envelope) =>
            envelope.kind === 'reject' &&
            envelope.commandId === 'cmd-invalid' &&
            envelope.reason === 'invalid-command',
        ),
      ).toBe(true);
    } finally {
      connection.disconnect();
    }
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
