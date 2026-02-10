import type {
  CoreBridgeV1CommandEnvelope,
  CoreBridgeV1HelloEnvelope,
  CoreBridgeV1HelloPayload,
} from './types.ts';
import { CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION, CORE_BRIDGE_V1_PROTOCOL_VERSION } from './types.ts';

const CITY_TOOL_VALUES = [
  'road',
  'rail',
  'wire',
  'bulldoze',
  'residential',
  'commercial',
  'industrial',
  'police_dept',
  'fire_dept',
  'stadium',
  'park',
  'seaport',
  'airport',
  'coal_power',
  'nuclear_power',
  'query',
] as const;

const CITY_NEW_DIFFICULTY_VALUES = ['easy', 'medium', 'hard'] as const;
const CITY_SAVE_TARGET_VALUES = ['download', 'autosave', 'slot'] as const;
const COMMAND_PAYLOAD_TYPE_VALUES = [
  'tool_apply',
  'sim_pause',
  'sim_resume',
  'sim_set_speed',
  'city_new',
  'city_load',
  'city_save',
  'scenario_start',
] as const;

type UnknownRecord = Record<string, unknown>;

/**
 * Validator families used by Bridge V1 schema checks.
 * Mirrors command gate separation in `ref/micropolis/src/sim/w_sim.c` where
 * command parsing and command execution are distinct steps.
 * Parity note: intentionally different from C integer Tcl return codes by
 * exposing named validator channels for TypeScript diagnostics.
 */
export type CoreBridgeV1ValidatorName = 'command_envelope' | 'hello_envelope' | 'hello_handshake';

/**
 * Deterministic validation failure categories for Bridge V1 contract checks.
 * Mirrors explicit argument rejection branches in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from C's generic `TCL_ERROR` by freezing
 * machine-readable failure classes for bridge clients and tests.
 */
export type CoreBridgeV1ValidationFailureCode =
  | 'missing_field'
  | 'invalid_type'
  | 'invalid_literal'
  | 'out_of_range'
  | 'version_mismatch';

/**
 * Structured schema failure returned by bridge validators.
 * Mirrors deterministic command rejection intent from
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_tk.c`.
 * Parity note: intentionally different from Tcl interpreter error strings by
 * including a stable path/expected/actual tuple.
 */
export interface CoreBridgeV1ValidationFailure {
  readonly code: CoreBridgeV1ValidationFailureCode;
  readonly path: string;
  readonly expected: string;
  readonly actual: unknown;
  readonly message: string;
}

/**
 * Error payload shape for validator-driven protocol failures.
 * Mirrors `error` envelope fault reporting intent in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from Micropolis stdout/stderr prints by
 * producing typed, transport-safe protocol violation payloads.
 */
export interface CoreBridgeV1ValidationErrorPayload {
  readonly code: 'protocol_violation';
  readonly message: string;
  readonly retryable: false;
  readonly extensions: Readonly<{
    readonly validator: CoreBridgeV1ValidatorName;
    readonly failureCode: CoreBridgeV1ValidationFailureCode;
    readonly path: string;
    readonly expected: string;
    readonly actual: unknown;
  }>;
}

/**
 * Canonical result shape for Bridge V1 runtime validators.
 * Mirrors success/error branching from Tcl eval flows in
 * `ref/micropolis/src/sim/w_tk.c` (`TCL_OK` vs `TCL_ERROR`).
 * Parity note: intentionally different from integer return flags by carrying a
 * typed value on success and typed diagnostics on failure.
 */
export type CoreBridgeV1ValidationResult<T> =
  | Readonly<{
      readonly ok: true;
      readonly value: T;
    }>
  | Readonly<{
      readonly ok: false;
      readonly failure: CoreBridgeV1ValidationFailure;
      readonly errorPayload: CoreBridgeV1ValidationErrorPayload;
    }>;

/**
 * Expected local handshake versions for strict lockstep negotiation.
 * Mirrors Bridge V1 lockstep requirements in
 * `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`.
 * Parity note: intentionally different from Micropolis startup flags by making
 * protocol/core compatibility explicit data.
 */
export interface CoreBridgeV1HandshakeExpectation {
  readonly coreVersion: string;
  readonly protocolVersion?: CoreBridgeV1HelloPayload['protocolVersion'];
  readonly cityPayloadVersion?: CoreBridgeV1HelloPayload['cityPayloadVersion'];
}

/**
 * Build a typed `error` payload from one schema failure.
 * Mirrors protocol fault reporting categories from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C `fprintf` side effects by
 * returning a serializable payload object for transport.
 */
export function createCoreBridgeV1ValidationErrorPayload(
  validator: CoreBridgeV1ValidatorName,
  failure: CoreBridgeV1ValidationFailure,
): CoreBridgeV1ValidationErrorPayload {
  return {
    code: 'protocol_violation',
    message: failure.message,
    retryable: false,
    extensions: {
      validator,
      failureCode: failure.code,
      path: failure.path,
      expected: failure.expected,
      actual: failure.actual,
    },
  };
}

/**
 * Validate unknown wire input as a frozen v1 `command` envelope.
 * Mirrors command argument validation entry points in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from Tcl argv parsing by validating a
 * typed JSON-style envelope contract.
 */
export function validateCoreBridgeV1CommandEnvelope(
  value: unknown,
): CoreBridgeV1ValidationResult<CoreBridgeV1CommandEnvelope> {
  if (!isRecord(value)) {
    return fail('command_envelope', invalidType('$', 'object', value));
  }

  const kind = value.kind;
  if (kind !== 'command') {
    return fail('command_envelope', invalidLiteral('kind', '"command"', kind));
  }

  const roomId = requireNonEmptyStringField(value, 'roomId', 'command_envelope');
  if (!roomId.ok) {
    return roomId.result;
  }

  const clientId = requireNonEmptyStringField(value, 'clientId', 'command_envelope');
  if (!clientId.ok) {
    return clientId.result;
  }

  const commandId = requireNonEmptyStringField(value, 'commandId', 'command_envelope');
  if (!commandId.ok) {
    return commandId.result;
  }

  const payload = value.payload;
  if (!isRecord(payload)) {
    return fail('command_envelope', invalidType('payload', 'object', payload));
  }

  const payloadType = payload.type;
  if (payloadType === undefined) {
    return fail('command_envelope', missingField('payload.type'));
  }
  if (typeof payloadType !== 'string') {
    return fail('command_envelope', invalidType('payload.type', 'string', payloadType));
  }

  const payloadFailure = validateCommandPayloadByType(payload, payloadType);
  if (payloadFailure !== undefined) {
    return fail('command_envelope', payloadFailure);
  }

  const extensionsFailure = validateOptionalExtensions(payload, 'payload.extensions');
  if (extensionsFailure !== undefined) {
    return fail('command_envelope', extensionsFailure);
  }

  return {
    ok: true,
    value: value as unknown as CoreBridgeV1CommandEnvelope,
  };
}

/**
 * Boolean type guard wrapper around `command` envelope validation.
 * Mirrors command acceptance gate behavior in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from C integer status codes by exposing
 * a TypeScript type predicate.
 */
export function isCoreBridgeV1CommandEnvelope(
  value: unknown,
): value is CoreBridgeV1CommandEnvelope {
  return validateCoreBridgeV1CommandEnvelope(value).ok;
}

/**
 * Validate unknown wire input as a frozen v1 `hello` envelope.
 * Mirrors startup argument validation mindset from
 * `ref/micropolis/src/sim/w_tk.c` and integration handshake intent in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from Micropolis process bootstrap by
 * validating an explicit transport-level hello payload.
 */
export function validateCoreBridgeV1HelloEnvelope(
  value: unknown,
): CoreBridgeV1ValidationResult<CoreBridgeV1HelloEnvelope> {
  if (!isRecord(value)) {
    return fail('hello_envelope', invalidType('$', 'object', value));
  }

  const kind = value.kind;
  if (kind !== 'hello') {
    return fail('hello_envelope', invalidLiteral('kind', '"hello"', kind));
  }

  const roomId = requireNonEmptyStringField(value, 'roomId', 'hello_envelope');
  if (!roomId.ok) {
    return roomId.result;
  }

  const clientId = requireNonEmptyStringField(value, 'clientId', 'hello_envelope');
  if (!clientId.ok) {
    return clientId.result;
  }

  const payload = value.payload;
  if (!isRecord(payload)) {
    return fail('hello_envelope', invalidType('payload', 'object', payload));
  }

  const protocolVersion = requireNonEmptyStringField(
    payload,
    'protocolVersion',
    'hello_envelope',
    'payload.protocolVersion',
  );
  if (!protocolVersion.ok) {
    return protocolVersion.result;
  }

  const cityPayloadVersion = requireNonEmptyStringField(
    payload,
    'cityPayloadVersion',
    'hello_envelope',
    'payload.cityPayloadVersion',
  );
  if (!cityPayloadVersion.ok) {
    return cityPayloadVersion.result;
  }

  const coreVersion = requireNonEmptyStringField(
    payload,
    'coreVersion',
    'hello_envelope',
    'payload.coreVersion',
  );
  if (!coreVersion.ok) {
    return coreVersion.result;
  }

  const snapshotCadenceTicks = payload.snapshotCadenceTicks;
  if (snapshotCadenceTicks === undefined) {
    return fail('hello_envelope', missingField('payload.snapshotCadenceTicks'));
  }
  if (!isInteger(snapshotCadenceTicks)) {
    return fail(
      'hello_envelope',
      invalidType('payload.snapshotCadenceTicks', 'integer', snapshotCadenceTicks),
    );
  }
  if (snapshotCadenceTicks <= 0) {
    return fail(
      'hello_envelope',
      outOfRange('payload.snapshotCadenceTicks', 'integer > 0', snapshotCadenceTicks),
    );
  }

  const extensionsFailure = validateOptionalExtensions(payload, 'payload.extensions');
  if (extensionsFailure !== undefined) {
    return fail('hello_envelope', extensionsFailure);
  }

  return {
    ok: true,
    value: value as unknown as CoreBridgeV1HelloEnvelope,
  };
}

/**
 * Boolean type guard wrapper around `hello` envelope validation.
 * Mirrors handshake gating expectations from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C startup globals by exposing a
 * typed predicate for runtime adapters.
 */
export function isCoreBridgeV1HelloEnvelope(value: unknown): value is CoreBridgeV1HelloEnvelope {
  return validateCoreBridgeV1HelloEnvelope(value).ok;
}

/**
 * Enforce strict lockstep protocol/city-payload/core versions for v1 hello.
 * Mirrors Bridge V1 compatibility lock requirements and command rejection
 * strictness in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from Micropolis, which does not carry a
 * typed version handshake envelope, by making mismatch rejection explicit.
 */
export function validateCoreBridgeV1Handshake(
  value: unknown,
  expectation: CoreBridgeV1HandshakeExpectation,
): CoreBridgeV1ValidationResult<CoreBridgeV1HelloEnvelope> {
  const helloResult = validateCoreBridgeV1HelloEnvelope(value);
  if (!helloResult.ok) {
    return helloResult;
  }

  if (expectation.coreVersion.trim() === '') {
    return fail('hello_handshake', invalidType('expectation.coreVersion', 'non-empty string', ''));
  }

  const expectedProtocolVersion = expectation.protocolVersion ?? CORE_BRIDGE_V1_PROTOCOL_VERSION;
  const expectedCityPayloadVersion =
    expectation.cityPayloadVersion ?? CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION;
  const expectedCoreVersion = expectation.coreVersion;

  const payload = helloResult.value.payload;
  if (payload.protocolVersion !== expectedProtocolVersion) {
    return fail(
      'hello_handshake',
      versionMismatch('payload.protocolVersion', expectedProtocolVersion, payload.protocolVersion),
    );
  }
  if (payload.cityPayloadVersion !== expectedCityPayloadVersion) {
    return fail(
      'hello_handshake',
      versionMismatch(
        'payload.cityPayloadVersion',
        expectedCityPayloadVersion,
        payload.cityPayloadVersion,
      ),
    );
  }
  if (payload.coreVersion !== expectedCoreVersion) {
    return fail(
      'hello_handshake',
      versionMismatch('payload.coreVersion', expectedCoreVersion, payload.coreVersion),
    );
  }

  return helloResult;
}

function validateCommandPayloadByType(
  payload: UnknownRecord,
  payloadType: string,
): CoreBridgeV1ValidationFailure | undefined {
  switch (payloadType) {
    case 'tool_apply':
      return validateToolApplyPayload(payload);
    case 'sim_pause':
    case 'sim_resume':
      return undefined;
    case 'sim_set_speed':
      return validateSimSetSpeedPayload(payload);
    case 'city_new':
      return validateCityNewPayload(payload);
    case 'city_load':
      return validateCityLoadPayload(payload);
    case 'city_save':
      return validateCitySavePayload(payload);
    case 'scenario_start':
      return validateScenarioStartPayload(payload);
    default:
      return invalidLiteral(
        'payload.type',
        COMMAND_PAYLOAD_TYPE_VALUES.map((value) => `"${value}"`).join(' | '),
        payloadType,
      );
  }
}

function validateToolApplyPayload(
  payload: UnknownRecord,
): CoreBridgeV1ValidationFailure | undefined {
  const tool = payload.tool;
  if (tool === undefined) {
    return missingField('payload.tool');
  }
  if (typeof tool !== 'string') {
    return invalidType('payload.tool', 'string', tool);
  }
  if (!includesLiteral(CITY_TOOL_VALUES, tool)) {
    return invalidLiteral(
      'payload.tool',
      CITY_TOOL_VALUES.map((value) => `"${value}"`).join(' | '),
      tool,
    );
  }

  const xFailure = validateRequiredIntegerField(payload, 'x', 'payload.x');
  if (xFailure !== undefined) {
    return xFailure;
  }

  const yFailure = validateRequiredIntegerField(payload, 'y', 'payload.y');
  if (yFailure !== undefined) {
    return yFailure;
  }

  const dragTo = payload.dragTo;
  if (dragTo !== undefined) {
    if (!isRecord(dragTo)) {
      return invalidType('payload.dragTo', 'object', dragTo);
    }

    const dragToXFailure = validateRequiredIntegerField(dragTo, 'x', 'payload.dragTo.x');
    if (dragToXFailure !== undefined) {
      return dragToXFailure;
    }

    const dragToYFailure = validateRequiredIntegerField(dragTo, 'y', 'payload.dragTo.y');
    if (dragToYFailure !== undefined) {
      return dragToYFailure;
    }
  }

  return undefined;
}

function validateSimSetSpeedPayload(
  payload: UnknownRecord,
): CoreBridgeV1ValidationFailure | undefined {
  const speed = payload.speed;
  if (speed === undefined) {
    return missingField('payload.speed');
  }
  if (!isInteger(speed)) {
    return invalidType('payload.speed', 'integer', speed);
  }
  if (speed < 0 || speed > 7) {
    return outOfRange('payload.speed', 'integer between 0 and 7', speed);
  }

  return undefined;
}

function validateCityNewPayload(payload: UnknownRecord): CoreBridgeV1ValidationFailure | undefined {
  const cityName = payload.cityName;
  if (cityName === undefined) {
    return missingField('payload.cityName');
  }
  if (typeof cityName !== 'string' || cityName.length === 0) {
    return invalidType('payload.cityName', 'non-empty string', cityName);
  }

  const difficulty = payload.difficulty;
  if (difficulty === undefined) {
    return missingField('payload.difficulty');
  }
  if (typeof difficulty !== 'string') {
    return invalidType('payload.difficulty', 'string', difficulty);
  }
  if (!includesLiteral(CITY_NEW_DIFFICULTY_VALUES, difficulty)) {
    return invalidLiteral(
      'payload.difficulty',
      CITY_NEW_DIFFICULTY_VALUES.map((value) => `"${value}"`).join(' | '),
      difficulty,
    );
  }

  const terrainSeedFailure = validateRequiredIntegerField(
    payload,
    'terrainSeed',
    'payload.terrainSeed',
  );
  if (terrainSeedFailure !== undefined) {
    return terrainSeedFailure;
  }

  const createIsland = payload.createIsland;
  if (createIsland === undefined) {
    return missingField('payload.createIsland');
  }
  if (typeof createIsland !== 'boolean') {
    return invalidType('payload.createIsland', 'boolean', createIsland);
  }

  return undefined;
}

function validateCityLoadPayload(
  payload: UnknownRecord,
): CoreBridgeV1ValidationFailure | undefined {
  const format = payload.format;
  if (format !== 'cty') {
    return format === undefined
      ? missingField('payload.format')
      : invalidLiteral('payload.format', '"cty"', format);
  }

  const encoding = payload.encoding;
  if (encoding !== 'base64') {
    return encoding === undefined
      ? missingField('payload.encoding')
      : invalidLiteral('payload.encoding', '"base64"', encoding);
  }

  const encodedCityData = payload.encodedCityData;
  if (encodedCityData === undefined) {
    return missingField('payload.encodedCityData');
  }
  if (typeof encodedCityData !== 'string' || encodedCityData.length === 0) {
    return invalidType('payload.encodedCityData', 'non-empty string', encodedCityData);
  }

  return undefined;
}

function validateCitySavePayload(
  payload: UnknownRecord,
): CoreBridgeV1ValidationFailure | undefined {
  const format = payload.format;
  if (format !== 'cty') {
    return format === undefined
      ? missingField('payload.format')
      : invalidLiteral('payload.format', '"cty"', format);
  }

  const target = payload.target;
  if (target === undefined) {
    return missingField('payload.target');
  }
  if (typeof target !== 'string') {
    return invalidType('payload.target', 'string', target);
  }
  if (!includesLiteral(CITY_SAVE_TARGET_VALUES, target)) {
    return invalidLiteral(
      'payload.target',
      CITY_SAVE_TARGET_VALUES.map((value) => `"${value}"`).join(' | '),
      target,
    );
  }

  const slotId = payload.slotId;
  if (target === 'slot') {
    if (slotId === undefined) {
      return missingField('payload.slotId');
    }
    if (typeof slotId !== 'string' || slotId.length === 0) {
      return invalidType('payload.slotId', 'non-empty string', slotId);
    }
    return undefined;
  }

  if (slotId !== undefined && typeof slotId !== 'string') {
    return invalidType('payload.slotId', 'string', slotId);
  }

  return undefined;
}

function validateScenarioStartPayload(
  payload: UnknownRecord,
): CoreBridgeV1ValidationFailure | undefined {
  return validateRequiredIntegerField(payload, 'scenarioId', 'payload.scenarioId');
}

function requireNonEmptyStringField(
  value: UnknownRecord,
  key: string,
  validator: CoreBridgeV1ValidatorName,
  path = key,
): Readonly<
  | {
      readonly ok: true;
      readonly value: string;
    }
  | {
      readonly ok: false;
      readonly result: CoreBridgeV1ValidationResult<never>;
    }
> {
  const fieldValue = value[key];
  if (fieldValue === undefined) {
    return {
      ok: false,
      result: fail(validator, missingField(path)),
    };
  }

  if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
    return {
      ok: false,
      result: fail(validator, invalidType(path, 'non-empty string', fieldValue)),
    };
  }

  return {
    ok: true,
    value: fieldValue,
  };
}

function validateRequiredIntegerField(
  value: UnknownRecord,
  key: string,
  path: string,
): CoreBridgeV1ValidationFailure | undefined {
  const fieldValue = value[key];
  if (fieldValue === undefined) {
    return missingField(path);
  }
  if (!isInteger(fieldValue)) {
    return invalidType(path, 'integer', fieldValue);
  }

  return undefined;
}

function validateOptionalExtensions(
  value: UnknownRecord,
  path: string,
): CoreBridgeV1ValidationFailure | undefined {
  const extensions = value.extensions;
  if (extensions !== undefined && !isRecord(extensions)) {
    return invalidType(path, 'object', extensions);
  }

  return undefined;
}

function fail<T>(
  validator: CoreBridgeV1ValidatorName,
  failure: CoreBridgeV1ValidationFailure,
): CoreBridgeV1ValidationResult<T> {
  return {
    ok: false,
    failure,
    errorPayload: createCoreBridgeV1ValidationErrorPayload(validator, failure),
  };
}

function missingField(path: string): CoreBridgeV1ValidationFailure {
  return {
    code: 'missing_field',
    path,
    expected: 'defined value',
    actual: undefined,
    message: `Missing required field "${path}".`,
  };
}

function invalidType(
  path: string,
  expected: string,
  actual: unknown,
): CoreBridgeV1ValidationFailure {
  return {
    code: 'invalid_type',
    path,
    expected,
    actual,
    message: `Field "${path}" must be ${expected}.`,
  };
}

function invalidLiteral(
  path: string,
  expected: string,
  actual: unknown,
): CoreBridgeV1ValidationFailure {
  return {
    code: 'invalid_literal',
    path,
    expected,
    actual,
    message: `Field "${path}" must match ${expected}.`,
  };
}

function outOfRange(
  path: string,
  expected: string,
  actual: unknown,
): CoreBridgeV1ValidationFailure {
  return {
    code: 'out_of_range',
    path,
    expected,
    actual,
    message: `Field "${path}" is out of range; expected ${expected}.`,
  };
}

function versionMismatch(
  path: string,
  expected: string,
  actual: unknown,
): CoreBridgeV1ValidationFailure {
  return {
    code: 'version_mismatch',
    path,
    expected,
    actual,
    message: `Handshake mismatch at "${path}": expected "${expected}".`,
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function includesLiteral<TLiteral extends string>(
  values: readonly TLiteral[],
  value: string,
): value is TLiteral {
  return values.includes(value as TLiteral);
}
