import { describe, expect, it } from 'vitest';

import { getCoreBridgeV1FixtureRecord, loadCoreBridgeV1FixtureCorpus } from './fixtures.ts';
import {
  createCoreBridgeV1SequenceState,
  evaluateCoreBridgeV1SequenceDecision,
} from './sequencing.ts';
import {
  CORE_BRIDGE_V1_CLIENT_ENVELOPE_KINDS,
  CORE_BRIDGE_V1_SERVER_ENVELOPE_KINDS,
  type CoreBridgeV1Envelope,
} from './types.ts';
import {
  validateCoreBridgeV1CommandEnvelope,
  validateCoreBridgeV1Handshake,
  validateCoreBridgeV1HelloEnvelope,
} from './validation.ts';

describe('core bridge fixture corpus', () => {
  it('covers every canonical envelope kind with a happy-path fixture', () => {
    const corpus = loadCoreBridgeV1FixtureCorpus();

    const actualKinds = new Set<string>();
    for (const fixture of corpus.fixtures) {
      if (fixture.data.scenario !== 'single_envelope') {
        continue;
      }

      actualKinds.add(fixture.data.envelope.kind);
    }

    const expectedKinds = new Set([
      ...CORE_BRIDGE_V1_CLIENT_ENVELOPE_KINDS,
      ...CORE_BRIDGE_V1_SERVER_ENVELOPE_KINDS,
    ]);

    expect([...actualKinds].sort()).toEqual([...expectedKinds].sort());
  });

  it('keeps all single-envelope fixtures schema-valid for hello/command and baseline fields for other kinds', () => {
    const corpus = loadCoreBridgeV1FixtureCorpus();

    for (const fixture of corpus.fixtures) {
      if (fixture.data.scenario !== 'single_envelope') {
        continue;
      }

      const envelope = fixture.data.envelope;
      assertCommonEnvelopeIdentity(envelope);

      if (envelope.kind === 'hello') {
        const helloResult = validateCoreBridgeV1HelloEnvelope(envelope);
        expect(helloResult.ok).toBe(true);

        const handshakeResult = validateCoreBridgeV1Handshake(envelope, {
          coreVersion: envelope.payload.coreVersion,
        });
        expect(handshakeResult.ok).toBe(true);
        continue;
      }

      if (envelope.kind === 'command') {
        const commandResult = validateCoreBridgeV1CommandEnvelope(envelope);
        expect(commandResult.ok).toBe(true);
        continue;
      }

      if ('serverSeq' in envelope && 'tick' in envelope) {
        expect(Number.isInteger(envelope.serverSeq)).toBe(true);
        expect(Number.isInteger(envelope.tick)).toBe(true);
      }
    }
  });

  it('captures duplicate commandId idempotency fixtures with dedupe ack semantics', () => {
    const corpus = loadCoreBridgeV1FixtureCorpus();
    const duplicateFixture = getCoreBridgeV1FixtureRecord(corpus, 'duplicate-command-id');

    expect(duplicateFixture.data.scenario).toBe('duplicate_command_id');
    if (duplicateFixture.data.scenario !== 'duplicate_command_id') {
      throw new Error('expected duplicate-command-id fixture scenario');
    }

    const { firstCommand, duplicateCommand, firstAck, duplicateAck } = duplicateFixture.data;

    expect(validateCoreBridgeV1CommandEnvelope(firstCommand).ok).toBe(true);
    expect(validateCoreBridgeV1CommandEnvelope(duplicateCommand).ok).toBe(true);

    expect(duplicateCommand.commandId).toBe(firstCommand.commandId);
    expect(firstAck.commandId).toBe(firstCommand.commandId);
    expect(duplicateAck.commandId).toBe(firstCommand.commandId);
    expect(firstAck.payload.deduplicated).toBe(false);
    expect(duplicateAck.payload.deduplicated).toBe(true);
  });

  it('captures out-of-order server sequence gap fixtures for resync behavior', () => {
    const corpus = loadCoreBridgeV1FixtureCorpus();
    const sequenceFixture = getCoreBridgeV1FixtureRecord(corpus, 'out-of-order-seq');

    expect(sequenceFixture.data.scenario).toBe('out_of_order_seq');
    if (sequenceFixture.data.scenario !== 'out_of_order_seq') {
      throw new Error('expected out-of-order-seq fixture scenario');
    }

    const sequenceState = createCoreBridgeV1SequenceState(sequenceFixture.data.initialState);
    const decision = evaluateCoreBridgeV1SequenceDecision(
      sequenceState,
      sequenceFixture.data.incomingEnvelope,
    );

    expect(decision.action).toBe(sequenceFixture.data.expectedDecision.action);
    expect(decision.reason).toBe(sequenceFixture.data.expectedDecision.reason);
    expect(decision.expectedServerSeq).toBe(
      sequenceFixture.data.expectedDecision.expectedServerSeq,
    );
  });

  it('captures hello version mismatch fixtures for lockstep handshake rejection', () => {
    const corpus = loadCoreBridgeV1FixtureCorpus();
    const versionFixture = getCoreBridgeV1FixtureRecord(corpus, 'version-mismatch-hello');

    expect(versionFixture.data.scenario).toBe('version_mismatch');
    if (versionFixture.data.scenario !== 'version_mismatch') {
      throw new Error('expected version-mismatch-hello fixture scenario');
    }

    const helloResult = validateCoreBridgeV1HelloEnvelope(versionFixture.data.helloEnvelope);
    expect(helloResult.ok).toBe(true);

    const handshakeResult = validateCoreBridgeV1Handshake(
      versionFixture.data.helloEnvelope,
      versionFixture.data.expectation,
    );

    expect(handshakeResult.ok).toBe(false);
    if (handshakeResult.ok) {
      throw new Error('expected version mismatch fixture handshake rejection');
    }

    expect(handshakeResult.failure.code).toBe(versionFixture.data.expectedFailure.code);
    expect(handshakeResult.failure.path).toBe(versionFixture.data.expectedFailure.path);
  });
});

function assertCommonEnvelopeIdentity(envelope: CoreBridgeV1Envelope): void {
  expect(typeof envelope.roomId).toBe('string');
  expect(envelope.roomId.length).toBeGreaterThan(0);
  expect(typeof envelope.clientId).toBe('string');
  expect(envelope.clientId.length).toBeGreaterThan(0);
}
