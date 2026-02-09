import { describe, expect, it } from 'vitest';

import {
  LOCAL_HOST_DEFAULT_CORE_VERSION,
  LOCAL_HOST_DEFAULT_PROTOCOL_VERSION,
} from '../../../../packages/core-bridge/src/local-host.ts';
import {
  BRIDGE_CORE_VERSION,
  BRIDGE_PROTOCOL_VERSION,
  createHelloPayload,
  EXPECTED_HELLO_VERSIONS,
} from './handshake';

describe('handshake bridge ownership', () => {
  it('sources default hello versions from @city/core-bridge', () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe(LOCAL_HOST_DEFAULT_PROTOCOL_VERSION);
    expect(BRIDGE_CORE_VERSION).toBe(LOCAL_HOST_DEFAULT_CORE_VERSION);
    expect(EXPECTED_HELLO_VERSIONS).toEqual({
      protocolVersion: LOCAL_HOST_DEFAULT_PROTOCOL_VERSION,
      coreVersion: LOCAL_HOST_DEFAULT_CORE_VERSION,
    });
  });

  it('uses bridge-owned versions when creating hello payloads without overrides', () => {
    expect(
      createHelloPayload({
        roomId: 'local-room',
        clientId: 'local-client',
      }),
    ).toEqual({
      roomId: 'local-room',
      clientId: 'local-client',
      protocolVersion: LOCAL_HOST_DEFAULT_PROTOCOL_VERSION,
      coreVersion: LOCAL_HOST_DEFAULT_CORE_VERSION,
    });
  });
});
