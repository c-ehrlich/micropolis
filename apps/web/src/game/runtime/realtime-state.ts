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
  id?: string;
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

  const parsed = parseRealtimeObjectsFromPayload(state.objects, envelope.payload);
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
type ParsedRealtimeObjectDelta =
  | {
      kind: 'upsert';
      object: RuntimeRealtimeObject & { id: string };
    }
  | {
      kind: 'remove';
      id: string;
    };

/**
 * Parses one realtime payload section into the next object projection.
 * Mirrors snapshot-baseline vs incremental update ordering from
 * `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: explicit snapshot/delta parsing is a bridge transport addition
 * on top of C in-memory sprite mutation.
 */
function parseRealtimeObjectsFromPayload(
  currentObjects: readonly RuntimeRealtimeObject[],
  payload: unknown,
): ParsedRealtimeObjects {
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

  const snapshotObjects = readRealtimeObjectArrayField(realtimeRecord, 'snapshot');
  if (snapshotObjects === null) {
    return null;
  }

  const legacyObjects = readRealtimeObjectArrayField(realtimeRecord, 'objects');
  if (legacyObjects === null) {
    return null;
  }

  const deltas = readRealtimeObjectDeltasField(realtimeRecord, 'deltas');
  if (deltas === null) {
    return null;
  }

  let nextObjects =
    snapshotObjects ??
    legacyObjects ??
    (deltas !== undefined ? (currentObjects.length === 0 ? [] : [...currentObjects]) : []);

  if (deltas !== undefined) {
    nextObjects = applyRealtimeObjectDeltas(nextObjects, deltas);
  }

  return nextObjects;
}

/**
 * Reads one optional realtime object array field from the payload.
 * Mirrors full sprite-list baseline intent from `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: invalid entries are ignored for runtime resilience.
 */
function readRealtimeObjectArrayField(
  record: Record<string, unknown>,
  key: 'snapshot' | 'objects',
): RuntimeRealtimeObject[] | null | undefined {
  if (!(key in record) || record[key] === undefined) {
    return undefined;
  }

  const raw = record[key];
  if (!Array.isArray(raw)) {
    return null;
  }

  const objects: RuntimeRealtimeObject[] = [];
  for (const rawObject of raw) {
    const object = parseRealtimeObject(rawObject);
    if (object !== null) {
      objects.push(object);
    }
  }
  return objects;
}

/**
 * Reads one optional realtime delta array field from the payload.
 * Mirrors ordered sprite lifecycle progression in `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: explicit `upsert`/`remove` records are bridge payload metadata.
 */
function readRealtimeObjectDeltasField(
  record: Record<string, unknown>,
  key: 'deltas',
): ParsedRealtimeObjectDelta[] | null | undefined {
  if (!(key in record) || record[key] === undefined) {
    return undefined;
  }

  const raw = record[key];
  if (!Array.isArray(raw)) {
    return null;
  }

  const deltas: ParsedRealtimeObjectDelta[] = [];
  for (const rawDelta of raw) {
    const delta = parseRealtimeObjectDelta(rawDelta);
    if (delta !== null) {
      deltas.push(delta);
    }
  }
  return deltas;
}

/**
 * Applies parsed realtime deltas onto a baseline object list.
 * Mirrors per-tick sprite mutate/remove behavior in `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: stable-id keyed merges are a TypeScript transport projection aid.
 */
function applyRealtimeObjectDeltas(
  baseObjects: readonly RuntimeRealtimeObject[],
  deltas: readonly ParsedRealtimeObjectDelta[],
): RuntimeRealtimeObject[] {
  const indexedObjects = new Map<string, RuntimeRealtimeObject>();
  const unindexedObjects: RuntimeRealtimeObject[] = [];

  for (const object of baseObjects) {
    if (object.id === undefined) {
      unindexedObjects.push(object);
      continue;
    }
    indexedObjects.set(object.id, object);
  }

  for (const delta of deltas) {
    if (delta.kind === 'remove') {
      indexedObjects.delete(delta.id);
      continue;
    }
    indexedObjects.set(delta.object.id, delta.object);
  }

  return [...indexedObjects.values(), ...unindexedObjects];
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
  const id = readNonEmptyString(record.id);
  return {
    id,
    name: record.name,
    type,
    x,
    y,
    frame,
  };
}

/**
 * Parses one realtime delta entry.
 * Mirrors sprite add/update/remove transitions in `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: explicit discriminated unions are transport-only.
 */
function parseRealtimeObjectDelta(value: unknown): ParsedRealtimeObjectDelta | null {
  const record = readRecord(value);
  if (record === null) {
    return null;
  }

  if (record.kind === 'remove') {
    const id = readNonEmptyString(record.id);
    if (id === undefined) {
      return null;
    }
    return {
      kind: 'remove',
      id,
    };
  }

  if (record.kind !== 'upsert') {
    return null;
  }

  const object = parseRealtimeObject(record.object);
  if (object === null || object.id === undefined) {
    return null;
  }

  return {
    kind: 'upsert',
    object: {
      ...object,
      id: object.id,
    },
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
      leftObject?.id !== rightObject?.id ||
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

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  return value;
}
