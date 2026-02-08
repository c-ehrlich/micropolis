import type {
  IntegrationBroadcaster,
  IntegrationClientCommandEnvelope,
  IntegrationClientId,
  IntegrationCommandId,
  IntegrationMultiplayerRuntime,
  IntegrationPatchTailEvent,
  IntegrationPersistedSnapshot,
  IntegrationReplayBootstrap,
  IntegrationRoomId,
  IntegrationServerSnapshotEnvelope,
  IntegrationSnapshotPatchTailPersistence,
} from './types.ts';

interface QueuedCommand<TCommandPayload> {
  command: IntegrationClientCommandEnvelope<TCommandPayload>;
  receivedOrder: number;
}

interface ProcessedCommandAckOutcome {
  kind: 'ack';
}

interface ProcessedCommandRejectOutcome {
  kind: 'reject';
  reason: string;
  code?: string;
}

interface ProcessedCommandErrorOutcome {
  kind: 'error';
  message: string;
  code?: string;
}

type ProcessedCommandOutcome =
  | ProcessedCommandAckOutcome
  | ProcessedCommandRejectOutcome
  | ProcessedCommandErrorOutcome;

interface RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload> {
  roomId: IntegrationRoomId;
  tick: number;
  serverSeq: number;
  connectedClients: Set<IntegrationClientId>;
  pendingCommands: QueuedCommand<TCommandPayload>[];
  processedCommands: Map<IntegrationCommandId, ProcessedCommandOutcome>;
  patchTail: IntegrationPatchTailEvent<TPatchPayload, TSnapshotPayload>[];
  persistedSnapshot: IntegrationPersistedSnapshot<TSnapshotPayload> | null;
  lastSnapshotTick: number;
  bootstrapPromise: Promise<void> | null;
}

/**
 * Default snapshot persistence cadence for authoritative room runtime ticks.
 * Mirrors periodic baseline-save intent around Micropolis save/load lifecycle
 * in `ref/micropolis/src/sim/s_fileio.c`, with an intentionally explicit
 * bridge-runtime default cadence instead of ad-hoc UI/file triggers.
 */
export const DEFAULT_SNAPSHOT_CADENCE_TICKS = 64;

/**
 * Accepted authoritative command result.
 * Mirrors command-then-update sequencing intent from `SimFrame`/`Simulate` in
 * `ref/micropolis/src/sim/s_sim.c` by emitting one acceptance record and then
 * ordered downstream state updates.
 * Parity note: patch/snapshot payload carriage is bridge-v1 envelope shaping
 * and is intentionally additive versus C global state/UI callback wiring.
 */
export interface AuthoritativeCommandAccepted<TPatchPayload, TSnapshotPayload> {
  kind: 'ack';
  patches?: ReadonlyArray<TPatchPayload>;
  snapshot?: TSnapshotPayload;
}

/**
 * Rejected authoritative command result.
 * Mirrors expected-denial handling intent in Micropolis command paths
 * (`ref/micropolis/src/sim/w_sim.c`) while mapping outcomes to bridge `reject`
 * envelopes instead of Tcl string results.
 */
export interface AuthoritativeCommandRejected {
  kind: 'reject';
  reason: string;
  code?: string;
}

/**
 * Command application decision returned by authoritative runtime adapters.
 * Mirrors command admission gating from Micropolis transport entry points
 * (`ref/micropolis/src/sim/w_sim.c`, `ref/micropolis/src/sim/w_net.c`).
 * Parity note: this is intentionally transport-agnostic and adapter-driven.
 */
export type AuthoritativeCommandDecision<TPatchPayload, TSnapshotPayload> =
  | AuthoritativeCommandAccepted<TPatchPayload, TSnapshotPayload>
  | AuthoritativeCommandRejected;

/**
 * Context passed to authoritative command handlers.
 * Mirrors room-scoped authority progression built on top of the simulation step
 * progression in `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: explicit `roomId`/`serverSeq` context is additive versus C.
 */
export interface AuthoritativeCommandContext {
  roomId: IntegrationRoomId;
  tick: number;
  nowMs: number;
  connectedClients: ReadonlySet<IntegrationClientId>;
}

/**
 * Hook used to apply one mutating command in an authoritative room.
 * Mirrors command dispatch surfaces in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: command payload typing is generic and bridge-owned.
 */
export type AuthoritativeCommandHandler<TCommandPayload, TPatchPayload, TSnapshotPayload> = (
  command: IntegrationClientCommandEnvelope<TCommandPayload>,
  context: AuthoritativeCommandContext,
) =>
  | AuthoritativeCommandDecision<TPatchPayload, TSnapshotPayload>
  | Promise<AuthoritativeCommandDecision<TPatchPayload, TSnapshotPayload>>;

/**
 * Hook used to build snapshot payloads for snapshot requests.
 * Mirrors state-baseline retrieval intent from Micropolis initialization and
 * simulation lifecycle (`ref/micropolis/src/sim/s_sim.c`, `ref/micropolis/src/sim/sim.c`).
 * Parity note: explicit snapshot envelope payload construction is additive vs C.
 */
export type AuthoritativeSnapshotFactory<TSnapshotPayload> = (
  roomId: IntegrationRoomId,
  tick: number,
) => TSnapshotPayload | Promise<TSnapshotPayload>;

/**
 * Options for creating the authoritative room runtime.
 * Mirrors authoritative room orchestration requirements from bridge stage plans
 * and command/tick intent from `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: broadcaster and command/snapshot hooks are adapter seams and
 * intentionally not 1:1 C global/function wiring.
 */
export interface AuthoritativeRoomRuntimeOptions<
  TCommandPayload,
  TPatchPayload,
  TSnapshotPayload,
  TPresencePayload,
> {
  broadcaster: IntegrationBroadcaster<TPatchPayload, TSnapshotPayload, TPresencePayload>;
  applyCommand: AuthoritativeCommandHandler<TCommandPayload, TPatchPayload, TSnapshotPayload>;
  createSnapshotPayload?: AuthoritativeSnapshotFactory<TSnapshotPayload>;
  initialTick?: number;
  persistence?: IntegrationSnapshotPatchTailPersistence<TPatchPayload, TSnapshotPayload>;
  snapshotCadenceTicks?: number;
}

/**
 * Create an authoritative room-scoped runtime with deterministic command
 * ordering, per-room `commandId` idempotency, and bridge-envelope emissions.
 * Mirrors simulation step progression from `ref/micropolis/src/sim/s_sim.c`
 * (tick progression and deterministic phase handling) and command routing from
 * `ref/micropolis/src/sim/w_sim.c`/`w_net.c`.
 * Parity note: explicit room registry, `commandId` dedupe map, and bridge
 * envelopes are intentional TypeScript additions for host/runtime contracts.
 */
export function createAuthoritativeRoomRuntime<
  TCommandPayload = unknown,
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
>(
  options: AuthoritativeRoomRuntimeOptions<
    TCommandPayload,
    TPatchPayload,
    TSnapshotPayload,
    TPresencePayload
  >,
): IntegrationMultiplayerRuntime<
  TCommandPayload,
  TPatchPayload,
  TSnapshotPayload,
  TPresencePayload
> {
  return new AuthoritativeRoomRuntimeImpl(options);
}

class AuthoritativeRoomRuntimeImpl<
  TCommandPayload,
  TPatchPayload,
  TSnapshotPayload,
  TPresencePayload,
> implements IntegrationMultiplayerRuntime<
  TCommandPayload,
  TPatchPayload,
  TSnapshotPayload,
  TPresencePayload
> {
  private readonly rooms = new Map<
    IntegrationRoomId,
    RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>
  >();
  private nextReceiveOrder = 0;
  private readonly snapshotCadenceTicks: number;

  constructor(
    private readonly options: AuthoritativeRoomRuntimeOptions<
      TCommandPayload,
      TPatchPayload,
      TSnapshotPayload,
      TPresencePayload
    >,
  ) {
    this.snapshotCadenceTicks = normalizeSnapshotCadenceTicks(options.snapshotCadenceTicks);
  }

  async connectClient(roomId: IntegrationRoomId, clientId: IntegrationClientId): Promise<void> {
    const room = await this.getOrCreateRoom(roomId);
    room.connectedClients.add(clientId);
  }

  async disconnectClient(roomId: IntegrationRoomId, clientId: IntegrationClientId): Promise<void> {
    const room = this.rooms.get(roomId);
    if (room === undefined) {
      return;
    }
    await this.ensureRoomBootstrapped(room);
    room.connectedClients.delete(clientId);
  }

  async receiveCommand(command: IntegrationClientCommandEnvelope<TCommandPayload>): Promise<void> {
    const room = await this.getOrCreateRoom(command.roomId);
    room.pendingCommands.push({
      command,
      receivedOrder: this.nextReceiveOrder,
    });
    this.nextReceiveOrder += 1;
  }

  async tick(nowMs: number): Promise<void> {
    const roomIds = [...this.rooms.keys()].sort(compareText);
    for (const roomId of roomIds) {
      const room = this.rooms.get(roomId);
      if (room === undefined) {
        continue;
      }
      await this.ensureRoomBootstrapped(room);
      room.tick += 1;

      if (room.pendingCommands.length > 0) {
        const queuedCommands = [...room.pendingCommands].sort(compareQueuedCommands);
        room.pendingCommands.length = 0;
        for (const queued of queuedCommands) {
          await this.processQueuedCommand(room, queued.command, nowMs);
        }
      }

      await this.persistSnapshotOnCadence(room);
    }
  }

  async getSnapshot(
    roomId: IntegrationRoomId,
  ): Promise<IntegrationServerSnapshotEnvelope<TSnapshotPayload>> {
    const room = await this.getOrCreateRoom(roomId);
    const payload = await this.createSnapshotPayload(room.roomId, room.tick);
    return {
      kind: 'snapshot',
      roomId: room.roomId,
      tick: room.tick,
      serverSeq: this.nextServerSeq(room),
      payload,
    };
  }

  async bootstrapReplay(
    roomId: IntegrationRoomId,
    afterServerSeq: number,
  ): Promise<IntegrationReplayBootstrap<TPatchPayload, TSnapshotPayload>> {
    const room = await this.getOrCreateRoom(roomId);
    const snapshot = await this.getOrCreateBootstrapSnapshot(room);
    const replayStartSeq = Math.max(afterServerSeq, snapshot.serverSeq);
    const replayTail = room.patchTail.filter((event) => event.serverSeq > replayStartSeq);
    return {
      snapshot: toSnapshotEnvelope(snapshot),
      replayTail,
    };
  }

  private async getOrCreateRoom(
    roomId: IntegrationRoomId,
  ): Promise<RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>> {
    const room = this.rooms.get(roomId);
    if (room !== undefined) {
      await this.ensureRoomBootstrapped(room);
      return room;
    }

    const initialTick = this.options.initialTick ?? 0;
    const created: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload> = {
      roomId,
      tick: initialTick,
      serverSeq: 0,
      connectedClients: new Set<IntegrationClientId>(),
      pendingCommands: [],
      processedCommands: new Map<IntegrationCommandId, ProcessedCommandOutcome>(),
      patchTail: [],
      persistedSnapshot: null,
      lastSnapshotTick: initialTick,
      bootstrapPromise: null,
    };
    created.bootstrapPromise = this.bootstrapRoomFromPersistence(created);
    this.rooms.set(roomId, created);
    await this.ensureRoomBootstrapped(created);
    return created;
  }

  private async ensureRoomBootstrapped(
    room: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>,
  ): Promise<void> {
    if (room.bootstrapPromise === null) {
      return;
    }
    await room.bootstrapPromise;
    room.bootstrapPromise = null;
  }

  private async bootstrapRoomFromPersistence(
    room: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>,
  ): Promise<void> {
    const persistence = this.options.persistence;
    if (persistence === undefined) {
      return;
    }

    const persistedSnapshot = await persistence.loadSnapshot(room.roomId);
    if (persistedSnapshot !== null) {
      if (persistedSnapshot.roomId !== room.roomId) {
        throw new Error(
          `snapshot room mismatch for ${room.roomId}: received ${persistedSnapshot.roomId}`,
        );
      }
      room.persistedSnapshot = persistedSnapshot;
      room.lastSnapshotTick = persistedSnapshot.tick;
      room.tick = Math.max(room.tick, persistedSnapshot.tick);
      room.serverSeq = Math.max(room.serverSeq, persistedSnapshot.serverSeq);
    }

    const persistedTail = await persistence.loadPatchTail(room.roomId, room.serverSeq);
    assertPatchTailContinuity(room.roomId, room.serverSeq, persistedTail);
    room.patchTail.push(...persistedTail);
    const lastPersistedTailEvent = persistedTail.at(-1);
    if (lastPersistedTailEvent !== undefined) {
      room.tick = Math.max(room.tick, lastPersistedTailEvent.tick);
      room.serverSeq = Math.max(room.serverSeq, lastPersistedTailEvent.serverSeq);
    }
  }

  private async processQueuedCommand(
    room: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>,
    command: IntegrationClientCommandEnvelope<TCommandPayload>,
    nowMs: number,
  ): Promise<void> {
    const priorOutcome = room.processedCommands.get(command.commandId);
    if (priorOutcome !== undefined) {
      this.emitPriorOutcome(room, command, priorOutcome);
      return;
    }

    if (!room.connectedClients.has(command.clientId)) {
      const rejectOutcome: ProcessedCommandRejectOutcome = {
        kind: 'reject',
        reason: 'client must connect before sending commands',
        code: 'NOT_CONNECTED',
      };
      room.processedCommands.set(command.commandId, rejectOutcome);
      this.emitReject(room, command, rejectOutcome.reason, rejectOutcome.code);
      return;
    }

    try {
      const decision = await this.options.applyCommand(command, {
        roomId: room.roomId,
        tick: room.tick,
        nowMs,
        connectedClients: room.connectedClients,
      });

      if (decision.kind === 'reject') {
        room.processedCommands.set(command.commandId, decision);
        this.emitReject(room, command, decision.reason, decision.code);
        return;
      }

      room.processedCommands.set(command.commandId, {
        kind: 'ack',
      });
      this.emitAck(room, command);

      for (const patchPayload of decision.patches ?? []) {
        await this.emitPatch(room, patchPayload);
      }

      if (decision.snapshot !== undefined) {
        await this.emitSnapshot(room, decision.snapshot);
      }
    } catch (error: unknown) {
      const errorOutcome: ProcessedCommandErrorOutcome = {
        kind: 'error',
        message: toErrorMessage(error),
        code: 'AUTHORITATIVE_RUNTIME_ERROR',
      };
      room.processedCommands.set(command.commandId, errorOutcome);
      this.emitError(room, command, errorOutcome.message, errorOutcome.code);
    }
  }

  private emitPriorOutcome(
    room: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>,
    command: IntegrationClientCommandEnvelope<TCommandPayload>,
    outcome: ProcessedCommandOutcome,
  ): void {
    if (outcome.kind === 'ack') {
      this.emitAck(room, command);
      return;
    }

    if (outcome.kind === 'reject') {
      this.emitReject(room, command, outcome.reason, outcome.code);
      return;
    }

    this.emitError(room, command, outcome.message, outcome.code);
  }

  private emitAck(
    room: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>,
    command: IntegrationClientCommandEnvelope<TCommandPayload>,
  ): void {
    this.options.broadcaster.sendToClient(command.clientId, {
      kind: 'ack',
      roomId: room.roomId,
      tick: room.tick,
      serverSeq: this.nextServerSeq(room),
      payload: {
        commandId: command.commandId,
      },
    });
  }

  private emitReject(
    room: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>,
    command: IntegrationClientCommandEnvelope<TCommandPayload>,
    reason: string,
    code?: string,
  ): void {
    this.options.broadcaster.sendToClient(command.clientId, {
      kind: 'reject',
      roomId: room.roomId,
      tick: room.tick,
      serverSeq: this.nextServerSeq(room),
      payload: {
        commandId: command.commandId,
        reason,
        code,
      },
    });
  }

  private emitError(
    room: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>,
    command: IntegrationClientCommandEnvelope<TCommandPayload>,
    message: string,
    code?: string,
  ): void {
    this.options.broadcaster.sendToClient(command.clientId, {
      kind: 'error',
      roomId: room.roomId,
      tick: room.tick,
      serverSeq: this.nextServerSeq(room),
      payload: {
        message,
        code,
        commandId: command.commandId,
      },
    });
  }

  private async emitPatch(
    room: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>,
    payload: TPatchPayload,
  ): Promise<void> {
    const event: IntegrationPatchTailEvent<TPatchPayload, TSnapshotPayload> = {
      kind: 'patch',
      roomId: room.roomId,
      tick: room.tick,
      serverSeq: this.nextServerSeq(room),
      payload,
    };
    this.options.broadcaster.sendToRoom(room.roomId, event);
    await this.recordPatchTailEvent(room, event);
  }

  private async emitSnapshot(
    room: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>,
    payload: TSnapshotPayload,
  ): Promise<void> {
    const event: IntegrationPatchTailEvent<TPatchPayload, TSnapshotPayload> = {
      kind: 'snapshot',
      roomId: room.roomId,
      tick: room.tick,
      serverSeq: this.nextServerSeq(room),
      payload,
    };
    this.options.broadcaster.sendToRoom(room.roomId, event);
    await this.recordPatchTailEvent(room, event);
  }

  private async recordPatchTailEvent(
    room: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>,
    event: IntegrationPatchTailEvent<TPatchPayload, TSnapshotPayload>,
  ): Promise<void> {
    const lastEvent = room.patchTail.at(-1);
    if (lastEvent !== undefined && event.serverSeq <= lastEvent.serverSeq) {
      throw new Error(
        `patch-tail sequence regression for ${room.roomId}: ${event.serverSeq} <= ${lastEvent.serverSeq}`,
      );
    }
    room.patchTail.push(event);

    if (this.options.persistence !== undefined) {
      await this.options.persistence.appendPatchTail(room.roomId, [event]);
    }
  }

  private async persistSnapshotOnCadence(
    room: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>,
  ): Promise<void> {
    const persistence:
      | IntegrationSnapshotPatchTailPersistence<TPatchPayload, TSnapshotPayload>
      | undefined = this.options.persistence;
    if (persistence === undefined) {
      return;
    }

    if (room.tick - room.lastSnapshotTick < this.snapshotCadenceTicks) {
      return;
    }

    const snapshot: IntegrationPersistedSnapshot<TSnapshotPayload> = {
      roomId: room.roomId,
      tick: room.tick,
      serverSeq: room.serverSeq,
      payload: await this.createSnapshotPayload(room.roomId, room.tick),
    };

    await persistence.saveSnapshot(room.roomId, snapshot);
    await persistence.truncatePatchTail(room.roomId, snapshot.serverSeq);
    room.persistedSnapshot = snapshot;
    room.lastSnapshotTick = snapshot.tick;
    room.patchTail = room.patchTail.filter((event) => event.serverSeq > snapshot.serverSeq);
  }

  private async getOrCreateBootstrapSnapshot(
    room: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>,
  ): Promise<IntegrationPersistedSnapshot<TSnapshotPayload>> {
    if (room.persistedSnapshot !== null) {
      return room.persistedSnapshot;
    }

    return {
      roomId: room.roomId,
      tick: room.tick,
      serverSeq: room.serverSeq,
      payload: await this.createSnapshotPayload(room.roomId, room.tick),
    };
  }

  private async createSnapshotPayload(
    roomId: IntegrationRoomId,
    tick: number,
  ): Promise<TSnapshotPayload> {
    if (this.options.createSnapshotPayload !== undefined) {
      return this.options.createSnapshotPayload(roomId, tick);
    }
    return undefined as TSnapshotPayload;
  }

  private nextServerSeq(
    room: RoomRuntimeContext<TCommandPayload, TPatchPayload, TSnapshotPayload>,
  ): number {
    room.serverSeq += 1;
    return room.serverSeq;
  }
}

function toSnapshotEnvelope<TSnapshotPayload>(
  snapshot: IntegrationPersistedSnapshot<TSnapshotPayload>,
): IntegrationServerSnapshotEnvelope<TSnapshotPayload> {
  return {
    kind: 'snapshot',
    roomId: snapshot.roomId,
    tick: snapshot.tick,
    serverSeq: snapshot.serverSeq,
    payload: snapshot.payload,
  };
}

function assertPatchTailContinuity<TPatchPayload, TSnapshotPayload>(
  roomId: IntegrationRoomId,
  startingServerSeq: number,
  tail: ReadonlyArray<IntegrationPatchTailEvent<TPatchPayload, TSnapshotPayload>>,
): void {
  let priorServerSeq = startingServerSeq;
  let priorTick = Number.NEGATIVE_INFINITY;

  for (const event of tail) {
    if (event.roomId !== roomId) {
      throw new Error(`patch-tail room mismatch for ${roomId}: received ${event.roomId}`);
    }
    if (event.serverSeq <= priorServerSeq) {
      throw new Error(
        `patch-tail sequence regression for ${roomId}: ${event.serverSeq} <= ${priorServerSeq}`,
      );
    }
    if (event.tick < priorTick) {
      throw new Error(`patch-tail tick regression for ${roomId}: ${event.tick} < ${priorTick}`);
    }
    priorServerSeq = event.serverSeq;
    priorTick = event.tick;
  }
}

function normalizeSnapshotCadenceTicks(value: number | undefined): number {
  const resolved = value ?? DEFAULT_SNAPSHOT_CADENCE_TICKS;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`snapshotCadenceTicks must be a positive integer, received ${resolved}`);
  }
  return resolved;
}

function compareQueuedCommands<TCommandPayload>(
  left: QueuedCommand<TCommandPayload>,
  right: QueuedCommand<TCommandPayload>,
): number {
  const bySentAtMs = compareNumbers(left.command.sentAtMs, right.command.sentAtMs);
  if (bySentAtMs !== 0) {
    return bySentAtMs;
  }

  const byClientId = compareText(left.command.clientId, right.command.clientId);
  if (byClientId !== 0) {
    return byClientId;
  }

  const byCommandId = compareText(left.command.commandId, right.command.commandId);
  if (byCommandId !== 0) {
    return byCommandId;
  }

  return compareNumbers(left.receivedOrder, right.receivedOrder);
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return 'authoritative room command failed';
}
