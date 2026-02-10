import { describe, expect, test } from 'vitest';

import type { ClientEnvelope, HostEnvelope, HostPatchEnvelope } from './protocol.ts';
import {
  createStage4PrimaryPlayableHost,
  readStage4CityExportPayload,
} from './stage4-primary-playable-host.ts';

/**
 * Command-surface smoke for the Stage 4 default host factory.
 * Mirrors `SimCmd` table routing intent in `ref/micropolis/src/sim/w_sim.c`,
 * where tool/sim/lifecycle/io subcommands all flow through one command surface.
 * Parity note: typed envelopes replace Tcl argv dispatch.
 */
describe('createStage4PrimaryPlayableHost', () => {
  test('routes tool/sim/lifecycle/io commands through one host command surface', () => {
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

      const savePatch = hostEnvelopes.find((envelope): envelope is HostPatchEnvelope => {
        return envelope.kind === 'patch' && readStage4CityExportPayload(envelope.payload) !== null;
      });
      expect(savePatch).toBeDefined();
      if (savePatch === undefined) {
        throw new Error('Expected save-city patch payload');
      }

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

      connection.send({
        kind: 'command',
        roomId: 'stage4-room',
        clientId: 'stage4-client',
        commandId: 'cmd-invalid',
        command: {
          kind: 'invalid-kind',
        },
      } as unknown as ClientEnvelope);

      expect(hostEnvelopes.some((envelope) => envelope.kind === 'snapshot')).toBe(true);
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
