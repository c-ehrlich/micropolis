import type { CoreHost } from './core-host.ts';
import type {
  ClientCommandEnvelope,
  ClientHelloEnvelope,
  ClientPingEnvelope,
  ClientRequestSnapshotEnvelope,
  CoreHostEnvelope,
} from './types.ts';

type IsExact<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2 ? true : false;
type Assert<Condition extends true> = Condition;

type HelloInputContract = Assert<IsExact<Parameters<CoreHost['hello']>[0], ClientHelloEnvelope>>;
type CommandInputContract = Assert<
  IsExact<Parameters<CoreHost['sendCommand']>[0], ClientCommandEnvelope>
>;
type SnapshotInputContract = Assert<
  IsExact<Parameters<CoreHost['requestSnapshot']>[0], ClientRequestSnapshotEnvelope>
>;
type PingInputContract = Assert<
  IsExact<Parameters<NonNullable<CoreHost['ping']>>[0], ClientPingEnvelope>
>;
type EventStreamContract = Assert<
  IsExact<Parameters<Parameters<CoreHost['subscribe']>[0]>[0], CoreHostEnvelope>
>;
type UnsubscribeContract = Assert<IsExact<ReturnType<CoreHost['subscribe']>, () => void>>;

const compileTimeContracts: [
  HelloInputContract,
  CommandInputContract,
  SnapshotInputContract,
  PingInputContract,
  EventStreamContract,
  UnsubscribeContract,
] = [true, true, true, true, true, true];
void compileTimeContracts;
