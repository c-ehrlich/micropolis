import { describe, expect, it } from 'vitest';

import {
  CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION,
  CORE_BRIDGE_V1_DEFAULT_SNAPSHOT_CADENCE_TICKS,
  CORE_BRIDGE_V1_PROTOCOL_VERSION,
} from './types.ts';
import {
  isCoreBridgeV1CommandEnvelope,
  validateCoreBridgeV1CommandEnvelope,
  validateCoreBridgeV1Handshake,
  validateCoreBridgeV1HelloEnvelope,
} from './validation.ts';

describe('validateCoreBridgeV1CommandEnvelope', () => {
  it('accepts a valid command envelope payload', () => {
    const result = validateCoreBridgeV1CommandEnvelope({
      kind: 'command',
      roomId: 'local-room',
      clientId: 'local-client',
      commandId: 'cmd-001',
      payload: {
        type: 'sim_pause',
      },
    });

    expect(result.ok).toBe(true);
    expect(isCoreBridgeV1CommandEnvelope(result.ok ? result.value : undefined)).toBe(true);
  });

  it('rejects missing required command identity fields with deterministic failures', () => {
    const result = validateCoreBridgeV1CommandEnvelope({
      kind: 'command',
      roomId: 'local-room',
      clientId: 'local-client',
      payload: {
        type: 'sim_pause',
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected command validation to fail for missing commandId');
    }

    expect(result.failure).toMatchObject({
      code: 'missing_field',
      path: 'commandId',
      expected: 'defined value',
    });
    expect(result.errorPayload).toMatchObject({
      code: 'protocol_violation',
      retryable: false,
      extensions: {
        validator: 'command_envelope',
        failureCode: 'missing_field',
        path: 'commandId',
      },
    });
  });
});

describe('hello schema and handshake validation', () => {
  it('accepts a valid hello envelope schema', () => {
    const result = validateCoreBridgeV1HelloEnvelope({
      kind: 'hello',
      roomId: 'local-room',
      clientId: 'local-client',
      payload: {
        protocolVersion: CORE_BRIDGE_V1_PROTOCOL_VERSION,
        cityPayloadVersion: CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION,
        coreVersion: '1.2.3',
        snapshotCadenceTicks: CORE_BRIDGE_V1_DEFAULT_SNAPSHOT_CADENCE_TICKS,
      },
    });

    expect(result.ok).toBe(true);
  });

  it('rejects hello envelopes missing required handshake payload fields', () => {
    const result = validateCoreBridgeV1HelloEnvelope({
      kind: 'hello',
      roomId: 'local-room',
      clientId: 'local-client',
      payload: {
        cityPayloadVersion: CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION,
        coreVersion: '1.2.3',
        snapshotCadenceTicks: CORE_BRIDGE_V1_DEFAULT_SNAPSHOT_CADENCE_TICKS,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected hello schema validation to fail for missing protocolVersion');
    }

    expect(result.failure).toMatchObject({
      code: 'missing_field',
      path: 'payload.protocolVersion',
    });
    expect(result.errorPayload.extensions.validator).toBe('hello_envelope');
  });

  it('rejects handshake version mismatches with explicit lockstep failure metadata', () => {
    const result = validateCoreBridgeV1Handshake(
      {
        kind: 'hello',
        roomId: 'local-room',
        clientId: 'local-client',
        payload: {
          protocolVersion: CORE_BRIDGE_V1_PROTOCOL_VERSION,
          cityPayloadVersion: CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION,
          coreVersion: '1.2.3',
          snapshotCadenceTicks: CORE_BRIDGE_V1_DEFAULT_SNAPSHOT_CADENCE_TICKS,
        },
      },
      {
        coreVersion: '1.2.4',
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected handshake to fail for core version mismatch');
    }

    expect(result.failure).toMatchObject({
      code: 'version_mismatch',
      path: 'payload.coreVersion',
      expected: '1.2.4',
      actual: '1.2.3',
    });
    expect(result.errorPayload.extensions.validator).toBe('hello_handshake');
  });
});
