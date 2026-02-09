import type {
  CoreHost,
  CoreHostAckEvent,
  CoreHostCommand,
  CoreHostEvent,
  CoreHostEventListener,
  CoreHostPatchEvent,
  CoreHostPlacement,
  CoreHostRejectEvent,
  CoreHostSnapshotPlacement,
} from './core-host';
import { HELLO_VERSION_MISMATCH_CODE, validateHelloCompatibility } from './handshake';

/**
 * Startup status for the web runtime bootstrap state machine.
 * Mirrors startup/connection gating intent mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: explicit UI-facing startup states are a TypeScript runtime addition.
 */
export type RuntimeBootstrapStatus =
  | 'idle'
  | 'bootstrapping'
  | 'ready'
  | 'handshake-error'
  | 'runtime-error'
  | 'stopped';

/**
 * Runtime diagnostic details surfaced to UI for startup/runtime failures.
 * Mirrors deterministic integration diagnostics mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: code + detail structure is intentionally explicit for browser UX.
 */
export interface RuntimeDiagnostic {
  readonly code: string;
  readonly message: string;
}

/**
 * Visual-only pending placement tracked before authoritative host commit.
 * Mirrors pending tool-preview intent from `DoPendTool(...)` in
 * `ref/micropolis/src/sim/w_tool.c`.
 * Parity note: this pending model is intentionally client-side and non-authoritative.
 */
export interface PendingVisualPlacement {
  readonly commandId: string;
  readonly tool: CoreHostPlacement['tool'];
  readonly x: number;
  readonly y: number;
}

/**
 * Authoritative placement committed from host `patch` events.
 * Mirrors successful tool outcomes in `ref/micropolis/src/sim/w_tool.c`
 * and downstream zone mutation in `ref/micropolis/src/sim/s_zone.c`.
 */
export interface CommittedPlacement extends CoreHostPlacement {
  readonly commandId: string;
}

/**
 * External runtime state snapshot consumed by route components.
 * Mirrors deterministic startup sequencing mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
export interface GameRuntimeState {
  readonly mode: CoreHost['mode'];
  readonly status: RuntimeBootstrapStatus;
  readonly diagnostic?: RuntimeDiagnostic;
  readonly pendingCommands: ReadonlyArray<string>;
  readonly pendingPlacements: ReadonlyArray<PendingVisualPlacement>;
  readonly committedPlacements: ReadonlyArray<CommittedPlacement>;
  readonly lastAppliedServerSeq: number;
  readonly lastAppliedTick: number;
  readonly isResyncing: boolean;
  readonly commandLifecycleLog: ReadonlyArray<string>;
}

/**
 * UI-friendly bootstrapping/error copy derived from runtime state.
 * Mirrors integration startup/fault visibility intent mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: explicit text formatting is a web UX concern, not a C behavior.
 */
export interface RuntimeStatusViewModel {
  readonly headline: string;
  readonly detail: string;
  readonly isError: boolean;
}

/**
 * Runtime wrapper consumed by `apps/web` to manage host lifecycle wiring and
 * bootstrap state transitions.
 * Mirrors Micropolis simulation start/stop orchestration boundaries in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this wrapper centralizes bridge handshake UX uniformly across hosts.
 */
export interface GameRuntime {
  readonly host: CoreHost;
  readonly mode: CoreHost['mode'];
  start(): void;
  stop(): void;
  sendCommand(command: CoreHostCommand): void;
  subscribe(listener: CoreHostEventListener): () => void;
  subscribeState(listener: (state: GameRuntimeState) => void): () => void;
  getState(): GameRuntimeState;
}

/**
 * Convert runtime bootstrap state into user-facing text.
 * Mirrors Stage startup diagnostics mapping from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: C integration mostly logs/prints; web presents explicit UI copy.
 */
export function describeRuntimeStatus(state: GameRuntimeState): RuntimeStatusViewModel {
  if (state.status === 'ready') {
    return {
      headline: `Connected (${state.mode})`,
      detail: 'Handshake complete. Authoritative events can now drive the UI.',
      isError: false,
    };
  }

  if (state.status === 'bootstrapping') {
    return {
      headline: `Connecting (${state.mode})`,
      detail: 'Opening host connection and waiting for hello handshake.',
      isError: false,
    };
  }

  if (state.status === 'handshake-error') {
    const diagnostic = state.diagnostic;
    return {
      headline: 'Handshake failed',
      detail: diagnostic
        ? `${diagnostic.code}: ${diagnostic.message}`
        : `${HELLO_VERSION_MISMATCH_CODE}: incompatible hello versions.`,
      isError: true,
    };
  }

  if (state.status === 'runtime-error') {
    const diagnostic = state.diagnostic;
    return {
      headline: 'Runtime error',
      detail: diagnostic
        ? `${diagnostic.code}: ${diagnostic.message}`
        : 'Unexpected host/runtime fault.',
      isError: true,
    };
  }

  if (state.status === 'stopped') {
    return {
      headline: 'Disconnected',
      detail: 'Runtime stopped and host connection closed.',
      isError: false,
    };
  }

  return {
    headline: 'Idle',
    detail: 'Runtime has not started yet.',
    isError: false,
  };
}

/**
 * Create a host-agnostic runtime that binds only to `CoreHost` and enforces
 * shared bootstrap/handshake behavior in local and DO modes.
 * Mirrors transport-independent command dispatch intent in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: unlike C globals, this runtime is created via dependency injection.
 */
export function createGameRuntime(host: CoreHost): GameRuntime {
  const eventListeners = new Set<CoreHostEventListener>();
  const stateListeners = new Set<(state: GameRuntimeState) => void>();
  const appliedPatchPlacements = new Set<string>();
  let state: GameRuntimeState = {
    mode: host.mode,
    status: 'idle',
    pendingCommands: [],
    pendingPlacements: [],
    committedPlacements: [],
    lastAppliedServerSeq: 0,
    lastAppliedTick: 0,
    isResyncing: false,
    commandLifecycleLog: [],
  };
  let started = false;

  const emitState = (): void => {
    for (const listener of stateListeners) {
      listener(state);
    }
  };

  const updateState = (updater: (current: GameRuntimeState) => GameRuntimeState): void => {
    state = updater(state);
    emitState();
  };

  host.subscribe((event: CoreHostEvent) => {
    for (const listener of eventListeners) {
      listener(event);
    }

    if (event.type === 'hello') {
      const result = validateHelloCompatibility(event.payload);
      if (result.ok) {
        updateState((current) => ({
          ...current,
          mode: host.mode,
          status: 'ready',
          diagnostic: undefined,
        }));
        return;
      }

      updateState((current) => ({
        ...current,
        mode: host.mode,
        status: 'handshake-error',
        diagnostic: {
          code: result.mismatch.code,
          message: result.mismatch.message,
        },
      }));
      started = false;
      host.disconnect();
      return;
    }

    if (event.type === 'snapshot') {
      appliedPatchPlacements.clear();
      for (const placement of event.placements) {
        appliedPatchPlacements.add(toPlacementKey(placement.commandId, placement));
      }

      updateState((current) => ({
        ...current,
        pendingCommands: [],
        pendingPlacements: [],
        committedPlacements: event.placements.map(toCommittedPlacement),
        lastAppliedServerSeq: event.baseServerSeq,
        lastAppliedTick: event.tick,
        isResyncing: false,
        commandLifecycleLog: [
          ...current.commandLifecycleLog,
          `snapshot:${event.baseServerSeq}@${event.tick}`,
        ],
      }));
      return;
    }

    if (event.type === 'resync') {
      if (!state.isResyncing) {
        updateState((current) => ({
          ...current,
          isResyncing: true,
          commandLifecycleLog: [...current.commandLifecycleLog, `resync:host:${event.reason}`],
        }));
      }
      host.requestSnapshot(state.lastAppliedServerSeq);
      return;
    }

    if (isSequencedEvent(event)) {
      const staleServerSeq = event.serverSeq <= state.lastAppliedServerSeq;
      const staleTick = event.tick < state.lastAppliedTick;
      if (staleServerSeq || staleTick) {
        updateState((current) => ({
          ...current,
          commandLifecycleLog: [
            ...current.commandLifecycleLog,
            `stale-drop:${event.type}:${event.serverSeq}@${event.tick}`,
          ],
        }));
        return;
      }

      const expectedServerSeq = state.lastAppliedServerSeq + 1;
      if (event.serverSeq > expectedServerSeq) {
        if (!state.isResyncing) {
          updateState((current) => ({
            ...current,
            isResyncing: true,
            commandLifecycleLog: [
              ...current.commandLifecycleLog,
              `resync-request:gap:expected=${expectedServerSeq}:received=${event.serverSeq}`,
            ],
          }));
          host.requestSnapshot(state.lastAppliedServerSeq);
        }
        return;
      }
    }

    if (event.type === 'ack') {
      updateState((current) => ({
        ...current,
        pendingCommands: current.pendingCommands.filter(
          (commandId) => commandId !== event.commandId,
        ),
        pendingPlacements: current.pendingPlacements.filter(
          (placement) => placement.commandId !== event.commandId,
        ),
        lastAppliedServerSeq: event.serverSeq,
        lastAppliedTick: event.tick,
        isResyncing: false,
        commandLifecycleLog: [...current.commandLifecycleLog, `ack:${event.commandId}`],
      }));
      return;
    }

    if (event.type === 'reject') {
      updateState((current) => ({
        ...current,
        pendingCommands: current.pendingCommands.filter(
          (commandId) => commandId !== event.commandId,
        ),
        pendingPlacements: current.pendingPlacements.filter(
          (placement) => placement.commandId !== event.commandId,
        ),
        lastAppliedServerSeq: event.serverSeq,
        lastAppliedTick: event.tick,
        isResyncing: false,
        commandLifecycleLog: [
          ...current.commandLifecycleLog,
          `reject:${event.commandId}:${event.code}`,
        ],
      }));
      return;
    }

    if (event.type === 'patch') {
      updateState((current) => {
        const committedPlacements = [...current.committedPlacements];
        const commandLifecycleLog = [...current.commandLifecycleLog];
        for (const placement of event.placements) {
          const placementKey = `${event.commandId}:${placement.tool}:${placement.x},${placement.y}`;
          if (appliedPatchPlacements.has(placementKey)) {
            continue;
          }
          appliedPatchPlacements.add(placementKey);
          committedPlacements.push({ ...placement, commandId: event.commandId });
          commandLifecycleLog.push(
            `patch:${event.commandId}:${placement.tool}@${placement.x},${placement.y}`,
          );
        }

        return {
          ...current,
          committedPlacements,
          lastAppliedServerSeq: event.serverSeq,
          lastAppliedTick: event.tick,
          isResyncing: false,
          commandLifecycleLog,
        };
      });
      return;
    }

    if (event.type === 'error') {
      updateState((current) => ({
        ...current,
        mode: host.mode,
        status: 'runtime-error',
        diagnostic: {
          code: event.code,
          message: event.message,
        },
      }));
      started = false;
      return;
    }

    if (event.type === 'disconnected' && !started && state.status !== 'handshake-error') {
      updateState((current) => ({
        ...current,
        mode: host.mode,
        status: 'stopped',
      }));
    }
  });

  return {
    host,
    mode: host.mode,
    start() {
      if (started) {
        return;
      }

      started = true;
      updateState((current) => ({
        ...current,
        mode: host.mode,
        status: 'bootstrapping',
        diagnostic: undefined,
      }));
      host.connect();
    },
    stop() {
      if (!started) {
        return;
      }

      started = false;
      host.disconnect();
      if (state.status !== 'handshake-error') {
        updateState((current) => ({
          ...current,
          mode: host.mode,
          status: 'stopped',
        }));
      }
    },
    sendCommand(command: CoreHostCommand): void {
      if (!started || state.status !== 'ready') {
        return;
      }

      if (command.type === 'sim-control-command') {
        updateState((current) => {
          const hasPendingCommand = current.pendingCommands.includes(command.commandId);

          return {
            ...current,
            pendingCommands: hasPendingCommand
              ? current.pendingCommands
              : [...current.pendingCommands, command.commandId],
            commandLifecycleLog: [
              ...current.commandLifecycleLog,
              `pending:${command.commandId}:sim-control:${command.control}`,
            ],
          };
        });
        host.sendCommand(command);
        return;
      }

      updateState((current) => {
        const hasPendingCommand = current.pendingCommands.includes(command.commandId);
        const hasPendingPlacement = current.pendingPlacements.some(
          (placement) => placement.commandId === command.commandId,
        );

        return {
          ...current,
          pendingCommands: hasPendingCommand
            ? current.pendingCommands
            : [...current.pendingCommands, command.commandId],
          pendingPlacements: hasPendingPlacement
            ? current.pendingPlacements
            : [
                ...current.pendingPlacements,
                {
                  commandId: command.commandId,
                  tool: command.tool,
                  x: command.x,
                  y: command.y,
                },
              ],
          commandLifecycleLog: [
            ...current.commandLifecycleLog,
            `pending:${command.commandId}:${command.tool}@${command.x},${command.y}`,
          ],
        };
      });
      host.sendCommand(command);
    },
    subscribe(listener: CoreHostEventListener): () => void {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    subscribeState(listener: (snapshot: GameRuntimeState) => void): () => void {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    getState(): GameRuntimeState {
      return state;
    },
  };
}

function isSequencedEvent(
  event: CoreHostEvent,
): event is CoreHostAckEvent | CoreHostRejectEvent | CoreHostPatchEvent {
  return event.type === 'ack' || event.type === 'reject' || event.type === 'patch';
}

function toPlacementKey(
  commandId: string,
  placement: CoreHostPlacement | CoreHostSnapshotPlacement,
): string {
  return `${commandId}:${placement.tool}:${placement.x},${placement.y}`;
}

function toCommittedPlacement(placement: CoreHostSnapshotPlacement): CommittedPlacement {
  return {
    commandId: placement.commandId,
    tool: placement.tool,
    x: placement.x,
    y: placement.y,
  };
}
