import type { SequencedHostEnvelope } from './protocol.ts';

const MAX_MESSAGE_FEED = 24;

/**
 * One HUD message event shown in the Stage 2 message feed.
 * Mirrors `UISetMessage` delivery from `SetMessageField` in
 * `ref/micropolis/src/sim/s_msg.c`, with sequencing metadata added from
 * bridge envelopes.
 */
export interface RuntimeHudMessageEvent {
  id: number;
  text: string;
  x: number | null;
  y: number | null;
  tick: number;
  serverSeq: number;
}

/**
 * Runtime HUD projection consumed by Stage 2 UI components.
 * Mirrors scalar head updates from `DoUpdateHeads`/`updateDate`/`SetDemand`
 * in `ref/micropolis/src/sim/w_update.c`, speed updates from
 * `ref/micropolis/src/sim/w_util.c`, and message delivery from
 * `ref/micropolis/src/sim/s_msg.c`.
 * Difference: Stage 2 stores a bounded message feed instead of a single
 * mutable UI label.
 */
export interface RuntimeHudState {
  fundsLabel: string;
  dateLabel: string;
  dateMonth: number;
  dateYear: number;
  demandR: number;
  demandC: number;
  demandI: number;
  speed: number;
  messages: readonly RuntimeHudMessageEvent[];
}

/**
 * Creates the initial HUD projection before the first authoritative snapshot.
 * Mirrors pre-heads-update UI state prior to `DoUpdateHeads` in
 * `ref/micropolis/src/sim/w_update.c`.
 */
export function createInitialRuntimeHudState(): RuntimeHudState {
  return {
    fundsLabel: 'Funds: $0',
    dateLabel: 'Jan 1900',
    dateMonth: 0,
    dateYear: 1900,
    demandR: 0,
    demandC: 0,
    demandI: 0,
    speed: 0,
    messages: [],
  };
}

/**
 * Projects snapshot/patch envelopes into the Stage 2 HUD state.
 * Mirrors ordered scalar/message projection from `DoUpdateHeads` and
 * `doMessage` flows in `ref/micropolis/src/sim/w_update.c` and
 * `ref/micropolis/src/sim/s_msg.c`.
 * Difference: this consumes bridge payloads instead of Tcl `UISet*` calls.
 */
export function projectRuntimeHudState(
  state: RuntimeHudState,
  envelope: SequencedHostEnvelope,
): RuntimeHudState {
  if (envelope.kind !== 'snapshot' && envelope.kind !== 'patch') {
    return state;
  }

  const parsed = parseHudPayload(envelope.payload, envelope.tick, envelope.serverSeq);
  if (parsed === null) {
    return state;
  }

  const nextState: RuntimeHudState = {
    fundsLabel: parsed.fundsLabel ?? state.fundsLabel,
    dateLabel: parsed.dateLabel ?? state.dateLabel,
    dateMonth: parsed.dateMonth ?? state.dateMonth,
    dateYear: parsed.dateYear ?? state.dateYear,
    demandR: parsed.demandR ?? state.demandR,
    demandC: parsed.demandC ?? state.demandC,
    demandI: parsed.demandI ?? state.demandI,
    speed: parsed.speed ?? state.speed,
    messages:
      envelope.kind === 'snapshot'
        ? parsed.messages
        : appendMessages(state.messages, parsed.messages),
  };

  if (isHudStateEqual(state, nextState)) {
    return state;
  }

  return nextState;
}

interface ParsedHudPayload {
  fundsLabel?: string;
  dateLabel?: string;
  dateMonth?: number;
  dateYear?: number;
  demandR?: number;
  demandC?: number;
  demandI?: number;
  speed?: number;
  messages: RuntimeHudMessageEvent[];
}

interface ParsedMessageInput {
  id: number;
  text: string;
  x: number | null;
  y: number | null;
}

function parseHudPayload(
  payload: unknown,
  tick: number,
  serverSeq: number,
): ParsedHudPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const parsed: ParsedHudPayload = {
    messages: [],
  };

  const hudRecord = readRecord(payload.hud);
  if (hudRecord !== null) {
    if (typeof hudRecord.fundsLabel === 'string') {
      parsed.fundsLabel = hudRecord.fundsLabel;
    }

    const dateRecord = readRecord(hudRecord.date);
    if (dateRecord !== null) {
      if (typeof dateRecord.label === 'string') {
        parsed.dateLabel = dateRecord.label;
      }

      const month = readRangeInteger(dateRecord.month, 0, 11);
      if (month !== null) {
        parsed.dateMonth = month;
      }

      const year = readRangeInteger(dateRecord.year, 0, 1_000_000);
      if (year !== null) {
        parsed.dateYear = year;
      }
    }

    const demandRecord = readRecord(hudRecord.demand);
    if (demandRecord !== null) {
      const r = readRangeInteger(demandRecord.r, -15, 15);
      if (r !== null) {
        parsed.demandR = r;
      }

      const c = readRangeInteger(demandRecord.c, -15, 15);
      if (c !== null) {
        parsed.demandC = c;
      }

      const i = readRangeInteger(demandRecord.i, -15, 15);
      if (i !== null) {
        parsed.demandI = i;
      }
    }

    const speed = readRangeInteger(hudRecord.speed, 0, 3);
    if (speed !== null) {
      parsed.speed = speed;
    }

    const hudMessage = parseMessageInput(hudRecord.message);
    if (hudMessage !== null) {
      parsed.messages.push(toHudMessageEvent(hudMessage, tick, serverSeq));
    }
  }

  if (Array.isArray(payload.messages)) {
    for (const rawEntry of payload.messages) {
      const message = parseMessageInput(rawEntry);
      if (message !== null) {
        parsed.messages.push(toHudMessageEvent(message, tick, serverSeq));
      }
    }
  }

  return parsed;
}

function appendMessages(
  previous: readonly RuntimeHudMessageEvent[],
  incoming: readonly RuntimeHudMessageEvent[],
): readonly RuntimeHudMessageEvent[] {
  if (incoming.length === 0) {
    return previous;
  }

  const combined = [...previous, ...incoming];
  if (combined.length <= MAX_MESSAGE_FEED) {
    return combined;
  }

  return combined.slice(combined.length - MAX_MESSAGE_FEED);
}

function toHudMessageEvent(
  message: ParsedMessageInput,
  tick: number,
  serverSeq: number,
): RuntimeHudMessageEvent {
  return {
    ...message,
    tick,
    serverSeq,
  };
}

function parseMessageInput(value: unknown): ParsedMessageInput | null {
  const record = readRecord(value);
  if (record === null) {
    return null;
  }

  const id = readRangeInteger(record.id, -200, 400);
  if (id === null) {
    return null;
  }

  if (typeof record.text !== 'string') {
    return null;
  }

  const x = readNullableInteger(record.x);
  const y = readNullableInteger(record.y);

  return {
    id,
    text: record.text,
    x,
    y,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  return value;
}

function readRangeInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const next = Math.trunc(value);
  if (next < min || next > max) {
    return null;
  }

  return next;
}

function readNullableInteger(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.trunc(value);
}

function isHudStateEqual(left: RuntimeHudState, right: RuntimeHudState): boolean {
  if (
    left.fundsLabel !== right.fundsLabel ||
    left.dateLabel !== right.dateLabel ||
    left.dateMonth !== right.dateMonth ||
    left.dateYear !== right.dateYear ||
    left.demandR !== right.demandR ||
    left.demandC !== right.demandC ||
    left.demandI !== right.demandI ||
    left.speed !== right.speed ||
    left.messages.length !== right.messages.length
  ) {
    return false;
  }

  for (let index = 0; index < left.messages.length; index += 1) {
    const leftMessage = left.messages[index];
    const rightMessage = right.messages[index];
    if (leftMessage === undefined || rightMessage === undefined) {
      return false;
    }

    if (
      leftMessage.id !== rightMessage.id ||
      leftMessage.text !== rightMessage.text ||
      leftMessage.x !== rightMessage.x ||
      leftMessage.y !== rightMessage.y ||
      leftMessage.tick !== rightMessage.tick ||
      leftMessage.serverSeq !== rightMessage.serverSeq
    ) {
      return false;
    }
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
