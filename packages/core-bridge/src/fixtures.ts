import duplicateCommandIdJson from '../fixtures/edge/duplicate-command-id.json';
import outOfOrderSeqJson from '../fixtures/edge/out-of-order-seq.json';
import versionMismatchHelloJson from '../fixtures/edge/version-mismatch-hello.json';
import ackHappyJson from '../fixtures/happy/ack.json';
import commandToolApplyHappyJson from '../fixtures/happy/command-tool-apply.json';
import errorHappyJson from '../fixtures/happy/error.json';
import helloHappyJson from '../fixtures/happy/hello.json';
import patchHappyJson from '../fixtures/happy/patch.json';
import pingHappyJson from '../fixtures/happy/ping.json';
import presenceHappyJson from '../fixtures/happy/presence.json';
import rejectHappyJson from '../fixtures/happy/reject.json';
import requestSnapshotHappyJson from '../fixtures/happy/request-snapshot.json';
import resyncHappyJson from '../fixtures/happy/resync.json';
import snapshotHappyJson from '../fixtures/happy/snapshot.json';
import manifestJson from '../fixtures/manifest.json';
import type {
  CoreBridgeV1AckEnvelope,
  CoreBridgeV1CommandEnvelope,
  CoreBridgeV1Envelope,
  CoreBridgeV1EnvelopeKind,
  CoreBridgeV1HelloEnvelope,
  CoreBridgeV1PatchEnvelope,
} from './types.ts';
import type {
  CoreBridgeV1HandshakeExpectation,
  CoreBridgeV1ValidationFailureCode,
} from './validation.ts';

type UnknownRecord = Record<string, unknown>;

/**
 * Fixture scenario categories used by the Stage 0 canonical contract corpus.
 * Mirrors integration contract coverage intent in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from Micropolis C test setup by tagging
 * fixture purpose explicitly for TypeScript bridge conformance suites.
 */
export type CoreBridgeV1FixtureScenario =
  | 'single_envelope'
  | 'duplicate_command_id'
  | 'out_of_order_seq'
  | 'version_mismatch';

/**
 * One fixture row in `packages/core-bridge/fixtures/manifest.json`.
 * Mirrors canonical fixture indexing used in replay manifests across the repo.
 * Parity note: intentionally different from Micropolis C, which does not
 * define a manifest-driven JSON bridge fixture corpus.
 */
export interface CoreBridgeV1FixtureManifestEntry {
  readonly name: string;
  readonly scenario: CoreBridgeV1FixtureScenario;
  readonly envelopeKind?: CoreBridgeV1EnvelopeKind;
  readonly file: string;
}

/**
 * Typed fixture payload union loaded from a fixture file.
 * Mirrors command/idempotency/order/version behaviors aligned with
 * `ref/micropolis/spec/integration/SPEC.md` and `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from Micropolis C harnesses by storing
 * bridge-wire examples as explicit JSON records.
 */
export type CoreBridgeV1FixtureCase =
  | Readonly<{
      readonly scenario: 'single_envelope';
      readonly envelope: CoreBridgeV1Envelope;
    }>
  | Readonly<{
      readonly scenario: 'duplicate_command_id';
      readonly firstCommand: CoreBridgeV1CommandEnvelope;
      readonly duplicateCommand: CoreBridgeV1CommandEnvelope;
      readonly firstAck: CoreBridgeV1AckEnvelope;
      readonly duplicateAck: CoreBridgeV1AckEnvelope;
    }>
  | Readonly<{
      readonly scenario: 'out_of_order_seq';
      readonly initialState: Readonly<{
        readonly lastAppliedServerSeq: number;
        readonly lastTick: number;
      }>;
      readonly incomingEnvelope: CoreBridgeV1PatchEnvelope;
      readonly expectedDecision: Readonly<{
        readonly action: 'apply' | 'drop' | 'resync';
        readonly reason:
          | 'initial_event'
          | 'in_order'
          | 'stale_server_seq'
          | 'server_seq_gap'
          | 'tick_regression';
        readonly expectedServerSeq: number;
      }>;
    }>
  | Readonly<{
      readonly scenario: 'version_mismatch';
      readonly helloEnvelope: CoreBridgeV1HelloEnvelope;
      readonly expectation: CoreBridgeV1HandshakeExpectation;
      readonly expectedFailure: Readonly<{
        readonly code: CoreBridgeV1ValidationFailureCode;
        readonly path: string;
      }>;
    }>;

/**
 * One loaded fixture record with manifest metadata and typed payload data.
 * Mirrors deterministic fixture selection workflows for parity tests.
 * Parity note: intentionally different from C test harnesses by combining
 * manifest metadata with parsed payload in one object.
 */
export interface CoreBridgeV1FixtureRecord extends CoreBridgeV1FixtureManifestEntry {
  readonly data: CoreBridgeV1FixtureCase;
}

/**
 * Full canonical Stage 0 fixture corpus.
 * Mirrors the frozen bridge contract inventory in
 * `/Users/cje/dev/city/STAGE_0_CONTRACT_FREEZE_PLAN.md` task 0.5.
 * Parity note: intentionally different from Micropolis C, which has no JSON
 * corpus for bridge envelopes and edge-case transport semantics.
 */
export interface CoreBridgeV1FixtureCorpus {
  readonly version: number;
  readonly fixtures: readonly CoreBridgeV1FixtureRecord[];
}

const FIXTURE_FILE_MAP: Readonly<Record<string, unknown>> = {
  'happy/hello.json': helloHappyJson,
  'happy/command-tool-apply.json': commandToolApplyHappyJson,
  'happy/request-snapshot.json': requestSnapshotHappyJson,
  'happy/ping.json': pingHappyJson,
  'happy/ack.json': ackHappyJson,
  'happy/reject.json': rejectHappyJson,
  'happy/patch.json': patchHappyJson,
  'happy/snapshot.json': snapshotHappyJson,
  'happy/resync.json': resyncHappyJson,
  'happy/presence.json': presenceHappyJson,
  'happy/error.json': errorHappyJson,
  'edge/duplicate-command-id.json': duplicateCommandIdJson,
  'edge/out-of-order-seq.json': outOfOrderSeqJson,
  'edge/version-mismatch-hello.json': versionMismatchHelloJson,
};

/**
 * Load and minimally validate the canonical Stage 0 fixture corpus.
 * Mirrors strict ingress validation intent from `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from C by validating manifest-linked JSON
 * fixture structure before tests consume bridge examples.
 */
export function loadCoreBridgeV1FixtureCorpus(): CoreBridgeV1FixtureCorpus {
  const manifest = parseFixtureManifest(manifestJson);
  const fixtures = manifest.fixtures.map((entry) => {
    const rawFixture = FIXTURE_FILE_MAP[entry.file];
    if (rawFixture === undefined) {
      throw new Error(`missing fixture file mapping for "${entry.file}"`);
    }

    return {
      ...entry,
      data: parseFixtureCase(entry, rawFixture),
    } satisfies CoreBridgeV1FixtureRecord;
  });

  return {
    version: manifest.version,
    fixtures,
  };
}

/**
 * Retrieve one fixture record by name from a loaded corpus.
 * Mirrors deterministic fixture addressing needs for cross-package tests.
 * Parity note: intentionally different from C harnesses by providing named lookup
 * over manifest-defined JSON cases.
 */
export function getCoreBridgeV1FixtureRecord(
  corpus: CoreBridgeV1FixtureCorpus,
  fixtureName: string,
): CoreBridgeV1FixtureRecord {
  const fixture = corpus.fixtures.find((candidate) => candidate.name === fixtureName);
  if (fixture === undefined) {
    throw new Error(`unknown core-bridge fixture: "${fixtureName}"`);
  }

  return fixture;
}

interface CoreBridgeV1FixtureManifest {
  readonly version: number;
  readonly fixtures: readonly CoreBridgeV1FixtureManifestEntry[];
}

function parseFixtureManifest(value: unknown): CoreBridgeV1FixtureManifest {
  if (!isRecord(value)) {
    throw new Error('invalid core-bridge fixture manifest: expected object');
  }

  const version = value.version;
  if (!isInteger(version) || version <= 0) {
    throw new Error('invalid core-bridge fixture manifest: version must be a positive integer');
  }

  const fixturesValue = value.fixtures;
  if (!Array.isArray(fixturesValue)) {
    throw new Error('invalid core-bridge fixture manifest: fixtures must be an array');
  }

  const fixtures = fixturesValue.map(parseFixtureManifestEntry);

  return {
    version,
    fixtures,
  };
}

function parseFixtureManifestEntry(value: unknown): CoreBridgeV1FixtureManifestEntry {
  if (!isRecord(value)) {
    throw new Error('invalid core-bridge fixture manifest entry: expected object');
  }

  const name = requireNonEmptyString(value, 'name');
  const scenario = parseFixtureScenario(value.scenario);
  const file = requireNonEmptyString(value, 'file');

  const envelopeKindValue = value.envelopeKind;
  const envelopeKind =
    envelopeKindValue === undefined
      ? undefined
      : parseEnvelopeKind(envelopeKindValue, `fixtures[${name}].envelopeKind`);

  return {
    name,
    scenario,
    envelopeKind,
    file,
  };
}

function parseFixtureCase(
  entry: CoreBridgeV1FixtureManifestEntry,
  value: unknown,
): CoreBridgeV1FixtureCase {
  if (!isRecord(value)) {
    throw new Error(`fixture "${entry.name}" must be an object`);
  }

  const scenario = parseFixtureScenario(value.scenario);
  if (scenario !== entry.scenario) {
    throw new Error(
      `fixture "${entry.name}" scenario mismatch: expected "${entry.scenario}", got "${scenario}"`,
    );
  }

  switch (scenario) {
    case 'single_envelope':
      return parseSingleEnvelopeFixture(entry, value);
    case 'duplicate_command_id':
      return parseDuplicateCommandIdFixture(entry, value);
    case 'out_of_order_seq':
      return parseOutOfOrderSeqFixture(entry, value);
    case 'version_mismatch':
      return parseVersionMismatchFixture(entry, value);
    default:
      return assertNeverScenario(scenario);
  }
}

function parseSingleEnvelopeFixture(
  entry: CoreBridgeV1FixtureManifestEntry,
  value: UnknownRecord,
): Extract<CoreBridgeV1FixtureCase, { readonly scenario: 'single_envelope' }> {
  const envelope = requireRecord(value, 'envelope', entry.name) as unknown as CoreBridgeV1Envelope;

  if (entry.envelopeKind !== undefined && envelope.kind !== entry.envelopeKind) {
    throw new Error(
      `fixture "${entry.name}" envelope kind mismatch: expected "${entry.envelopeKind}", got "${envelope.kind}"`,
    );
  }

  return {
    scenario: 'single_envelope',
    envelope,
  };
}

function parseDuplicateCommandIdFixture(
  entry: CoreBridgeV1FixtureManifestEntry,
  value: UnknownRecord,
): Extract<CoreBridgeV1FixtureCase, { readonly scenario: 'duplicate_command_id' }> {
  return {
    scenario: 'duplicate_command_id',
    firstCommand: requireRecord(
      value,
      'firstCommand',
      entry.name,
    ) as unknown as CoreBridgeV1CommandEnvelope,
    duplicateCommand: requireRecord(
      value,
      'duplicateCommand',
      entry.name,
    ) as unknown as CoreBridgeV1CommandEnvelope,
    firstAck: requireRecord(value, 'firstAck', entry.name) as unknown as CoreBridgeV1AckEnvelope,
    duplicateAck: requireRecord(
      value,
      'duplicateAck',
      entry.name,
    ) as unknown as CoreBridgeV1AckEnvelope,
  };
}

function parseOutOfOrderSeqFixture(
  entry: CoreBridgeV1FixtureManifestEntry,
  value: UnknownRecord,
): Extract<CoreBridgeV1FixtureCase, { readonly scenario: 'out_of_order_seq' }> {
  const initialState = requireRecord(value, 'initialState', entry.name);
  const lastAppliedServerSeq = requireInteger(initialState, 'lastAppliedServerSeq', entry.name);
  const lastTick = requireInteger(initialState, 'lastTick', entry.name);

  const incomingEnvelope = requireRecord(
    value,
    'incomingEnvelope',
    entry.name,
  ) as unknown as CoreBridgeV1PatchEnvelope;
  const expectedDecision = requireRecord(value, 'expectedDecision', entry.name);

  const action = requireDecisionAction(
    expectedDecision.action,
    `${entry.name}.expectedDecision.action`,
  );
  const reason = requireDecisionReason(
    expectedDecision.reason,
    `${entry.name}.expectedDecision.reason`,
  );
  const expectedServerSeq = requireInteger(expectedDecision, 'expectedServerSeq', entry.name);

  return {
    scenario: 'out_of_order_seq',
    initialState: {
      lastAppliedServerSeq,
      lastTick,
    },
    incomingEnvelope,
    expectedDecision: {
      action,
      reason,
      expectedServerSeq,
    },
  };
}

function parseVersionMismatchFixture(
  entry: CoreBridgeV1FixtureManifestEntry,
  value: UnknownRecord,
): Extract<CoreBridgeV1FixtureCase, { readonly scenario: 'version_mismatch' }> {
  const helloEnvelope = requireRecord(
    value,
    'helloEnvelope',
    entry.name,
  ) as unknown as CoreBridgeV1HelloEnvelope;
  const expectation = requireRecord(
    value,
    'expectation',
    entry.name,
  ) as unknown as CoreBridgeV1HandshakeExpectation;
  const expectedFailure = requireRecord(value, 'expectedFailure', entry.name);

  const code = requireValidationFailureCode(
    expectedFailure.code,
    `${entry.name}.expectedFailure.code`,
  );
  const path = requireNonEmptyString(expectedFailure, 'path');

  return {
    scenario: 'version_mismatch',
    helloEnvelope,
    expectation,
    expectedFailure: {
      code,
      path,
    },
  };
}

function requireRecord(value: UnknownRecord, key: string, fixtureName: string): UnknownRecord {
  const fieldValue = value[key];
  if (!isRecord(fieldValue)) {
    throw new Error(`fixture "${fixtureName}" field "${key}" must be an object`);
  }

  return fieldValue;
}

function requireNonEmptyString(value: UnknownRecord, key: string): string {
  const fieldValue = value[key];
  if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
    throw new Error(`field "${key}" must be a non-empty string`);
  }

  return fieldValue;
}

function requireInteger(value: UnknownRecord, key: string, fixtureName: string): number {
  const fieldValue = value[key];
  if (!isInteger(fieldValue)) {
    throw new Error(`fixture "${fixtureName}" field "${key}" must be an integer`);
  }

  return fieldValue;
}

function parseFixtureScenario(value: unknown): CoreBridgeV1FixtureScenario {
  switch (value) {
    case 'single_envelope':
    case 'duplicate_command_id':
    case 'out_of_order_seq':
    case 'version_mismatch':
      return value;
    default:
      throw new Error(`invalid fixture scenario: "${String(value)}"`);
  }
}

function parseEnvelopeKind(value: unknown, path: string): CoreBridgeV1EnvelopeKind {
  switch (value) {
    case 'hello':
    case 'command':
    case 'request_snapshot':
    case 'ping':
    case 'ack':
    case 'reject':
    case 'patch':
    case 'snapshot':
    case 'resync':
    case 'presence':
    case 'error':
      return value;
    default:
      throw new Error(`invalid envelope kind at ${path}: "${String(value)}"`);
  }
}

function requireDecisionAction(value: unknown, path: string): 'apply' | 'drop' | 'resync' {
  switch (value) {
    case 'apply':
    case 'drop':
    case 'resync':
      return value;
    default:
      throw new Error(`invalid sequence action at ${path}: "${String(value)}"`);
  }
}

function requireDecisionReason(
  value: unknown,
  path: string,
): 'initial_event' | 'in_order' | 'stale_server_seq' | 'server_seq_gap' | 'tick_regression' {
  switch (value) {
    case 'initial_event':
    case 'in_order':
    case 'stale_server_seq':
    case 'server_seq_gap':
    case 'tick_regression':
      return value;
    default:
      throw new Error(`invalid sequence reason at ${path}: "${String(value)}"`);
  }
}

function requireValidationFailureCode(
  value: unknown,
  path: string,
): CoreBridgeV1ValidationFailureCode {
  switch (value) {
    case 'missing_field':
    case 'invalid_type':
    case 'invalid_literal':
    case 'out_of_range':
    case 'version_mismatch':
      return value;
    default:
      throw new Error(`invalid validation failure code at ${path}: "${String(value)}"`);
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function assertNeverScenario(value: never): never {
  throw new Error(`unsupported fixture scenario: "${String(value)}"`);
}
