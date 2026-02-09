import type { SequencedHostEnvelope } from './protocol.ts';

const EMPTY_RUNTIME_REALTIME_OBJECTS: readonly RuntimeRealtimeObject[] = [];

/**
 * One realtime object projected into Stage 2 runtime state.
 * Mirrors sprite/object fields from `SimSprite` in
 * `packages/sim-core/src/sim/realtime.ts`, which ports moving object behavior
 * from `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: Stage 2 intentionally carries only a minimal field subset until
 * Stage 7 overlay rendering lands.
 */
export interface RuntimeRealtimeObject {
  name: string;
  type: number;
  x: number;
  y: number;
  frame: number;
}

/**
 * Runtime realtime-object projection state.
 * Mirrors sprite snapshot ownership from `ref/micropolis/src/sim/w_sprite.c`
 * through the TypeScript realtime port in `packages/sim-core/src/sim/realtime.ts`.
 * Parity note: Stage 2 keeps this as an additive payload placeholder with no
 * rendering side effects yet.
 */
export interface RuntimeRealtimeState {
  objects: readonly RuntimeRealtimeObject[];
}

/**
 * Creates the initial realtime-object projection before the first snapshot.
 * Mirrors startup behavior where Micropolis has no active sprite feed until
 * simulation update loops run (`ref/micropolis/src/sim/w_sprite.c`).
 */
export function createInitialRuntimeRealtimeState(): RuntimeRealtimeState {
  return {
    objects: EMPTY_RUNTIME_REALTIME_OBJECTS,
  };
}

/**
 * Projects optional realtime-object payloads from snapshot/patch envelopes.
 * Mirrors staged sprite stream projection intent from
 * `packages/sim-core/src/sim/realtime.ts` and `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: when snapshot payload omits realtime data, Stage 2 clears to an
 * empty set so recovery snapshots cannot retain stale overlay objects.
 */
export function projectRuntimeRealtimeState(
  state: RuntimeRealtimeState,
  envelope: SequencedHostEnvelope,
): RuntimeRealtimeState {
  if (envelope.kind !== 'snapshot' && envelope.kind !== 'patch') {
    return state;
  }

  const parsed = parseRealtimeObjectsFromPayload(envelope.payload);
  if (parsed === undefined) {
    if (envelope.kind === 'snapshot') {
      return clearRealtimeObjects(state);
    }
    return state;
  }

  if (parsed === null) {
    return state;
  }

  if (areRealtimeObjectsEqual(state.objects, parsed)) {
    return state;
  }

  return {
    objects: parsed.length === 0 ? EMPTY_RUNTIME_REALTIME_OBJECTS : parsed,
  };
}

type ParsedRealtimeObjects = RuntimeRealtimeObject[] | null | undefined;

function parseRealtimeObjectsFromPayload(payload: unknown): ParsedRealtimeObjects {
  if (!isRecord(payload)) {
    return null;
  }

  if (!('realtime' in payload)) {
    return undefined;
  }

  const realtimeRecord = readRecord(payload.realtime);
  if (realtimeRecord === null) {
    return null;
  }

  if (!('objects' in realtimeRecord) || realtimeRecord.objects === undefined) {
    return [];
  }

  if (!Array.isArray(realtimeRecord.objects)) {
    return null;
  }

  const objects: RuntimeRealtimeObject[] = [];
  for (const rawObject of realtimeRecord.objects) {
    const object = parseRealtimeObject(rawObject);
    if (object !== null) {
      objects.push(object);
    }
  }

  return objects;
}

function parseRealtimeObject(value: unknown): RuntimeRealtimeObject | null {
  const record = readRecord(value);
  if (record === null) {
    return null;
  }

  if (typeof record.name !== 'string') {
    return null;
  }

  const type = readInteger(record.type);
  const x = readInteger(record.x);
  const y = readInteger(record.y);
  if (type === null || x === null || y === null) {
    return null;
  }

  const frame = readInteger(record.frame) ?? 0;
  return {
    name: record.name,
    type,
    x,
    y,
    frame,
  };
}

function clearRealtimeObjects(state: RuntimeRealtimeState): RuntimeRealtimeState {
  if (state.objects.length === 0) {
    return state;
  }

  return {
    objects: EMPTY_RUNTIME_REALTIME_OBJECTS,
  };
}

function areRealtimeObjectsEqual(
  left: readonly RuntimeRealtimeObject[],
  right: readonly RuntimeRealtimeObject[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftObject = left[index];
    const rightObject = right[index];
    if (
      leftObject?.name !== rightObject?.name ||
      leftObject?.type !== rightObject?.type ||
      leftObject?.x !== rightObject?.x ||
      leftObject?.y !== rightObject?.y ||
      leftObject?.frame !== rightObject?.frame
    ) {
      return false;
    }
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.trunc(value);
}
