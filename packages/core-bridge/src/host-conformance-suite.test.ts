import {
  LOCAL_HOST_DEFAULT_CLIENT_ID,
  LOCAL_HOST_DEFAULT_CORE_VERSION,
  LOCAL_HOST_DEFAULT_PROTOCOL_VERSION,
  LOCAL_HOST_DEFAULT_ROOM_ID,
  LocalHost,
} from './local-host.ts';
import { MockHost } from './mock-host.ts';
import { defineCoreHostConformanceSuite } from './host-conformance-suite.ts';

defineCoreHostConformanceSuite({
  suiteName: 'MockHost',
  identity: {
    roomId: LOCAL_HOST_DEFAULT_ROOM_ID,
    clientId: LOCAL_HOST_DEFAULT_CLIENT_ID,
  },
  protocolVersion: LOCAL_HOST_DEFAULT_PROTOCOL_VERSION,
  coreVersion: LOCAL_HOST_DEFAULT_CORE_VERSION,
  createHost(options) {
    return new MockHost({
      snapshotCadenceTicks: options?.snapshotCadenceTicks,
    });
  },
});

defineCoreHostConformanceSuite({
  suiteName: 'LocalHost',
  identity: {
    roomId: LOCAL_HOST_DEFAULT_ROOM_ID,
    clientId: LOCAL_HOST_DEFAULT_CLIENT_ID,
  },
  protocolVersion: LOCAL_HOST_DEFAULT_PROTOCOL_VERSION,
  coreVersion: LOCAL_HOST_DEFAULT_CORE_VERSION,
  createHost(options) {
    return new LocalHost({
      snapshotCadenceTicks: options?.snapshotCadenceTicks,
    });
  },
});
