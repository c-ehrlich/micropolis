import type {
  BridgeClientCommandEnvelope,
  BridgeClientEnvelope,
  BridgeHelloPayload,
  BridgeServerEnvelope,
  BridgeServerSnapshotEnvelope,
} from '@city/core-bridge';
import { describe, expectTypeOf, it } from 'vitest';

import type {
  IntegrationClientCommandEnvelope,
  IntegrationClientEnvelope,
  IntegrationHelloPayload,
  IntegrationMultiplayerRuntime,
  IntegrationServerEnvelope,
} from './types.ts';

describe('multiplayer contract bridge alignment', () => {
  it('keeps sim-integration handshake and envelope contracts as direct bridge aliases', () => {
    expectTypeOf<IntegrationHelloPayload>().toEqualTypeOf<BridgeHelloPayload>();
    expectTypeOf<IntegrationClientEnvelope>().toEqualTypeOf<BridgeClientEnvelope>();
    expectTypeOf<IntegrationServerEnvelope>().toEqualTypeOf<BridgeServerEnvelope>();
  });

  it('binds runtime command and snapshot contracts to canonical core-bridge envelopes', () => {
    type Runtime = IntegrationMultiplayerRuntime;
    type ReceivedCommand = Parameters<Runtime['receiveCommand']>[0];
    type SnapshotEnvelope = Awaited<ReturnType<Runtime['getSnapshot']>>;

    expectTypeOf<ReceivedCommand>().toEqualTypeOf<BridgeClientCommandEnvelope>();
    expectTypeOf<ReceivedCommand>().toEqualTypeOf<IntegrationClientCommandEnvelope>();
    expectTypeOf<SnapshotEnvelope>().toEqualTypeOf<BridgeServerSnapshotEnvelope>();
  });
});
