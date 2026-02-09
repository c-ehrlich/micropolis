import type {
  CityCommandPayloadV1,
  CityMapDeltaV1,
  CityPatchPayloadV1,
  CoreBridgeV1AckEnvelope,
  CoreBridgeV1ClientEnvelope,
  CoreBridgeV1CommandEnvelope,
  CoreBridgeV1HelloEnvelope,
  CoreBridgeV1ServerEnvelope,
} from './types.ts';
import {
  CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION,
  CORE_BRIDGE_V1_DEFAULT_SNAPSHOT_CADENCE_TICKS,
  CORE_BRIDGE_V1_PROTOCOL_VERSION,
} from './types.ts';

type IsRequired<T, K extends keyof T> = undefined extends T[K] ? false : true;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type _CommandRoomIdRequired = Assert<IsRequired<CoreBridgeV1CommandEnvelope, 'roomId'>>;
type _CommandClientIdRequired = Assert<IsRequired<CoreBridgeV1CommandEnvelope, 'clientId'>>;
type _CommandIdRequired = Assert<IsRequired<CoreBridgeV1CommandEnvelope, 'commandId'>>;
type _AckTickRequired = Assert<IsRequired<CoreBridgeV1AckEnvelope, 'tick'>>;
type _AckServerSeqRequired = Assert<IsRequired<CoreBridgeV1AckEnvelope, 'serverSeq'>>;
type _ClientKinds = Assert<
  IsEqual<CoreBridgeV1ClientEnvelope['kind'], 'hello' | 'command' | 'request_snapshot' | 'ping'>
>;
type _ServerKinds = Assert<
  IsEqual<
    CoreBridgeV1ServerEnvelope['kind'],
    'hello' | 'ack' | 'reject' | 'patch' | 'snapshot' | 'resync' | 'presence' | 'error'
  >
>;
type _CommandPayloadKinds = Assert<
  IsEqual<
    CityCommandPayloadV1['type'],
    | 'tool_apply'
    | 'sim_pause'
    | 'sim_resume'
    | 'sim_set_speed'
    | 'city_new'
    | 'city_load'
    | 'city_save'
    | 'scenario_start'
  >
>;
type _PatchDeltaKeys = Assert<IsEqual<keyof CityMapDeltaV1, 'x' | 'y' | 'tile'>>;
type _PatchDeltaElementShape = Assert<
  IsEqual<CityPatchPayloadV1['mapDeltas'][number], CityMapDeltaV1>
>;

const _helloEnvelope: CoreBridgeV1HelloEnvelope = {
  kind: 'hello',
  roomId: 'room-1',
  clientId: 'client-1',
  payload: {
    protocolVersion: CORE_BRIDGE_V1_PROTOCOL_VERSION,
    cityPayloadVersion: CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION,
    coreVersion: '0.0.0',
    snapshotCadenceTicks: CORE_BRIDGE_V1_DEFAULT_SNAPSHOT_CADENCE_TICKS,
  },
};

const _commandEnvelope: CoreBridgeV1CommandEnvelope = {
  kind: 'command',
  roomId: 'room-1',
  clientId: 'client-1',
  commandId: 'cmd-1',
  payload: {
    type: 'sim_set_speed',
    speed: 3,
  },
};

const _ackEnvelope: CoreBridgeV1AckEnvelope = {
  kind: 'ack',
  roomId: 'room-1',
  clientId: 'client-1',
  commandId: 'cmd-1',
  tick: 10,
  serverSeq: 20,
  payload: {
    deduplicated: false,
    commandType: 'sim_set_speed',
  },
};

// @ts-expect-error `protocolVersion` is mandatory in v1 hello payload.
const _invalidHelloPayload: CoreBridgeV1HelloEnvelope['payload'] = {
  cityPayloadVersion: CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION,
  coreVersion: '0.0.0',
  snapshotCadenceTicks: CORE_BRIDGE_V1_DEFAULT_SNAPSHOT_CADENCE_TICKS,
};

// @ts-expect-error `roomId` is mandatory in v1 command envelopes.
const _invalidCommandMissingRoomId: CoreBridgeV1CommandEnvelope = {
  kind: 'command',
  clientId: 'client-1',
  commandId: 'cmd-1',
  payload: {
    type: 'sim_pause',
  },
};

// @ts-expect-error `tick` is mandatory for sequenced host envelopes.
const _invalidAckMissingTick: CoreBridgeV1AckEnvelope = {
  kind: 'ack',
  roomId: 'room-1',
  clientId: 'client-1',
  commandId: 'cmd-1',
  serverSeq: 20,
  payload: {
    deduplicated: false,
    commandType: 'sim_pause',
  },
};

const _invalidCommandPayload: CityCommandPayloadV1 = {
  // @ts-expect-error Unknown command payload variants are rejected by the frozen union.
  type: 'unknown_command',
};

const _invalidPatchDelta: CityMapDeltaV1 = {
  // @ts-expect-error Canonical patch deltas are `{ x, y, tile }` and do not allow linear `index`.
  index: 0,
  tile: 7,
};

const _visitClientEnvelope = (envelope: CoreBridgeV1ClientEnvelope): string => {
  switch (envelope.kind) {
    case 'hello':
      return envelope.payload.protocolVersion;
    case 'command':
      return envelope.commandId;
    case 'request_snapshot':
      return envelope.payload.reason;
    case 'ping':
      return envelope.payload.pingId;
    default: {
      const _exhaustive: never = envelope;
      return _exhaustive;
    }
  }
};

const _visitServerEnvelope = (envelope: CoreBridgeV1ServerEnvelope): number => {
  switch (envelope.kind) {
    case 'hello':
      return envelope.payload.snapshotCadenceTicks;
    case 'ack':
    case 'reject':
    case 'patch':
    case 'snapshot':
    case 'resync':
    case 'presence':
    case 'error':
      return envelope.serverSeq;
    default: {
      const _exhaustive: never = envelope;
      return _exhaustive;
    }
  }
};

void _helloEnvelope;
void _commandEnvelope;
void _ackEnvelope;
void _invalidHelloPayload;
void _visitClientEnvelope;
void _visitServerEnvelope;
