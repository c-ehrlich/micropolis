import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CORE_BRIDGE_V1_LOCAL_CLIENT_ID,
  CORE_BRIDGE_V1_LOCAL_ROOM_ID,
  type CoreBridgeV1AckEnvelope,
  type CoreBridgeV1ClientEnvelope,
  type CoreBridgeV1CommandEnvelope,
  type CoreBridgeV1Envelope,
  type CoreBridgeV1ServerEnvelope,
  validateCoreBridgeV1CommandEnvelope,
} from '../../core-bridge/src/index.ts';
import type {
  IntegrationBridgeClientEnvelopeV1,
  IntegrationBridgeEnvelopeKindV1,
  IntegrationBridgeServerEnvelopeV1,
} from './bridge-contract.ts';
import { createIntegrationRuntime } from './runtime.ts';

describe('bridge contract conformance', () => {
  it('keeps integration bridge aliases pinned to @city/core-bridge envelope contracts', () => {
    expectTypeOf<IntegrationBridgeClientEnvelopeV1>().toEqualTypeOf<CoreBridgeV1ClientEnvelope>();
    expectTypeOf<IntegrationBridgeServerEnvelopeV1>().toEqualTypeOf<CoreBridgeV1ServerEnvelope>();
    expectTypeOf<IntegrationBridgeEnvelopeKindV1>().toEqualTypeOf<CoreBridgeV1Envelope['kind']>();

    type LegacyClientCommandEnvelope = Readonly<{
      roomId: string;
      clientId: string;
      commandId: string;
      sentAtMs: number;
      payload: unknown;
    }>;

    type LegacyServerEventEnvelope = Readonly<{
      roomId: string;
      tick: number;
      kind: 'ack' | 'patch' | 'snapshot' | 'presence' | 'error';
      payload: unknown;
    }>;

    const legacyClientEnvelope: LegacyClientCommandEnvelope = {
      roomId: 'legacy-room',
      clientId: 'legacy-client',
      commandId: 'legacy-cmd',
      sentAtMs: 1000,
      payload: {},
    };
    const legacyServerEnvelope: LegacyServerEventEnvelope = {
      roomId: 'legacy-room',
      tick: 1,
      kind: 'ack',
      payload: {},
    };

    // @ts-expect-error Legacy client envelope shape is not the frozen v1 discriminated union.
    const incompatibleClientEnvelope: IntegrationBridgeClientEnvelopeV1 = legacyClientEnvelope;
    // @ts-expect-error Legacy server envelope shape omits required `clientId` and `serverSeq`.
    const incompatibleServerEnvelope: IntegrationBridgeServerEnvelopeV1 = legacyServerEnvelope;

    void incompatibleClientEnvelope;
    void incompatibleServerEnvelope;
  });

  it('wires tty command handling through core-bridge command and ack envelopes without local protocol forks', () => {
    const bridgeClientEnvelopes: CoreBridgeV1CommandEnvelope[] = [];
    const bridgeServerEnvelopes: IntegrationBridgeServerEnvelopeV1[] = [];

    // Deterministic first-sequence sample for monotonic ordering semantics from
    // `ref/micropolis/src/sim/s_sim.c` tick progression + `w_net.c` message ordering intent.
    const firstTick = 1;
    const firstServerSeq = 1;

    const runtime = createIntegrationRuntime({
      features: {
        tty: true,
      },
      hooks: {
        evaluateTtyCommand(command) {
          const payloadType = command.trim() === 'sim_pause' ? 'sim_pause' : 'sim_resume';

          const commandEnvelope: CoreBridgeV1CommandEnvelope = {
            kind: 'command',
            roomId: CORE_BRIDGE_V1_LOCAL_ROOM_ID,
            clientId: CORE_BRIDGE_V1_LOCAL_CLIENT_ID,
            commandId: `cmd-${firstServerSeq}`,
            payload: {
              type: payloadType,
            },
          };

          const validation = validateCoreBridgeV1CommandEnvelope(commandEnvelope);
          expect(validation.ok).toBe(true);
          if (validation.ok) {
            bridgeClientEnvelopes.push(validation.value);
          }

          const ackEnvelope: CoreBridgeV1AckEnvelope = {
            kind: 'ack',
            roomId: commandEnvelope.roomId,
            clientId: commandEnvelope.clientId,
            commandId: commandEnvelope.commandId,
            tick: firstTick,
            serverSeq: firstServerSeq,
            payload: {
              deduplicated: false,
              commandType: payloadType,
            },
          };
          bridgeServerEnvelopes.push(ackEnvelope);

          return {
            ok: true,
            result: ackEnvelope.commandId,
          };
        },
      },
    });

    const evaluation = runtime.handleInputLine('sim_pause\n');

    expect(evaluation).toEqual({
      ok: true,
      result: 'cmd-1',
    });
    expect(bridgeClientEnvelopes).toEqual([
      {
        kind: 'command',
        roomId: CORE_BRIDGE_V1_LOCAL_ROOM_ID,
        clientId: CORE_BRIDGE_V1_LOCAL_CLIENT_ID,
        commandId: 'cmd-1',
        payload: {
          type: 'sim_pause',
        },
      },
    ]);
    expect(bridgeServerEnvelopes).toEqual([
      {
        kind: 'ack',
        roomId: CORE_BRIDGE_V1_LOCAL_ROOM_ID,
        clientId: CORE_BRIDGE_V1_LOCAL_CLIENT_ID,
        commandId: 'cmd-1',
        tick: firstTick,
        serverSeq: firstServerSeq,
        payload: {
          deduplicated: false,
          commandType: 'sim_pause',
        },
      },
    ]);
  });
});
