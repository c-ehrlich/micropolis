import type { SequencedHostEnvelope } from './protocol.ts';

const MAX_MESSAGE_FEED = 24;
const HUD_MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Message dispatch channel mirrored from Micropolis message hooks.
 * Maps `SendMes` and `SendMesAt` in `ref/micropolis/src/sim/s_msg.c`.
 */
export type RuntimeHudMessageDispatch = 'sendMes' | 'sendMesAt';

/**
 * One HUD message event shown in the Playable Runtime message feed.
 * Mirrors `SendMes` / `SendMesAt` dispatch intent in
 * `ref/micropolis/src/sim/s_msg.c`.
 */
export interface RuntimeHudMessageEvent {
  id: number;
  text: string;
  dispatch: RuntimeHudMessageDispatch;
  x: number | null;
  y: number | null;
  tick: number;
  serverSeq: number;
}

/**
 * Runtime HUD options heads projection consumed by Playable Runtime UI components.
 * Mirrors `updateOptions` / `UISetOptions` output in
 * `ref/micropolis/src/sim/w_update.c`.
 * Difference: values are represented as explicit booleans instead of one packed bitfield.
 */
export interface RuntimeHudOptionsState {
  autoBudget: boolean;
  autoGo: boolean;
  autoBulldoze: boolean;
  disasters: boolean;
  userSoundOn: boolean;
  doAnimation: boolean;
  doMessages: boolean;
  doNotices: boolean;
}

/**
 * Runtime HUD projection consumed by Playable Runtime UI components.
 * Mirrors scalar head updates from `DoUpdateHeads`/`updateDate`/`SetDemand`
 * in `ref/micropolis/src/sim/w_update.c`, speed updates from
 * `ref/micropolis/src/sim/w_util.c`, and message delivery from
 * `ref/micropolis/src/sim/s_msg.c`.
 * Difference: Playable Runtime stores a bounded message feed instead of a single
 * mutable UI label.
 */
export interface RuntimeHudState {
  fundsLabel: string;
  dateLabel: string;
  dateDisplayLabel: string;
  dateMonth: number;
  dateYear: number;
  demandR: number;
  demandC: number;
  demandI: number;
  demandLabel: string;
  speed: number;
  speedLabel: string;
  options: RuntimeHudOptionsState;
  messages: readonly RuntimeHudMessageEvent[];
}

/**
 * Creates the initial HUD projection before the first authoritative snapshot.
 * Mirrors pre-heads-update UI state prior to `DoUpdateHeads` in
 * `ref/micropolis/src/sim/w_update.c`.
 */
export function createInitialRuntimeHudState(): RuntimeHudState {
  const dateLabel = 'Jan 1900';
  const demandR = 0;
  const demandC = 0;
  const demandI = 0;
  const speed = 0;
  return {
    fundsLabel: 'Funds: $0',
    dateLabel,
    dateDisplayLabel: formatDateDisplayLabel(dateLabel),
    dateMonth: 0,
    dateYear: 1900,
    demandR,
    demandC,
    demandI,
    demandLabel: formatDemandLabel(demandR, demandC, demandI),
    speed,
    speedLabel: formatSpeedDisplayLabel(speed),
    options: {
      autoBudget: true,
      autoGo: true,
      autoBulldoze: true,
      disasters: true,
      userSoundOn: true,
      doAnimation: true,
      doMessages: true,
      doNotices: true,
    },
    messages: [],
  };
}

/**
 * Projects snapshot/patch envelopes into the Playable Runtime HUD state.
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

  const parsed = parseHudPayload(
    envelope.payload,
    envelope.kind,
    envelope.tick,
    envelope.serverSeq,
  );
  if (parsed === null) {
    return state;
  }

  const dateLabel = parsed.dateLabel ?? state.dateLabel;
  const demandR = parsed.demandR ?? state.demandR;
  const demandC = parsed.demandC ?? state.demandC;
  const demandI = parsed.demandI ?? state.demandI;
  const speed = parsed.speed ?? state.speed;

  const nextState: RuntimeHudState = {
    fundsLabel: parsed.fundsLabel ?? state.fundsLabel,
    dateLabel,
    dateDisplayLabel: formatDateDisplayLabel(dateLabel),
    dateMonth: parsed.dateMonth ?? state.dateMonth,
    dateYear: parsed.dateYear ?? state.dateYear,
    demandR,
    demandC,
    demandI,
    demandLabel: formatDemandLabel(demandR, demandC, demandI),
    speed,
    speedLabel: formatSpeedDisplayLabel(speed),
    options:
      parsed.options === undefined ? state.options : mergeOptions(state.options, parsed.options),
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
  options?: Partial<RuntimeHudOptionsState>;
  messages: RuntimeHudMessageEvent[];
}

interface ParsedMessageInput {
  id: number;
  text: string;
  dispatch: RuntimeHudMessageDispatch;
  x: number | null;
  y: number | null;
  tick?: number;
  serverSeq?: number;
}

function parseHudPayload(
  payload: unknown,
  envelopeKind: 'snapshot' | 'patch',
  tick: number,
  serverSeq: number,
): ParsedHudPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const parsed: ParsedHudPayload = {
    messages: [],
  };

  let legacyHudMessage: RuntimeHudMessageEvent | null = null;

  const hudRecord = readRecord(payload.hud);
  if (hudRecord !== null) {
    const funds = readRangeInteger(hudRecord.funds, 0, 2_000_000_000);
    if (funds !== null) {
      parsed.fundsLabel = formatFundsLabel(funds);
    }

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

      if (parsed.dateLabel === undefined && month !== null && year !== null) {
        parsed.dateLabel = formatDateLabel(month, year);
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

    const parsedFlatOptions = parseHudOptionsFromRecord(hudRecord);
    if (parsedFlatOptions !== null) {
      parsed.options = {
        ...parsed.options,
        ...parsedFlatOptions,
      };
    }

    const optionsRecord = readRecord(hudRecord.options);
    if (optionsRecord !== null) {
      const parsedNestedOptions = parseHudOptionsFromRecord(optionsRecord);
      if (parsedNestedOptions !== null) {
        parsed.options = {
          ...parsed.options,
          ...parsedNestedOptions,
        };
      }
    }

    const hudMessage = parseMessageInput(hudRecord.message);
    legacyHudMessage = hudMessage === null ? null : toHudMessageEvent(hudMessage, tick, serverSeq);
  }

  const messageDeltaEntries = readMessageArrayEntries(payload.messageDeltas);
  const messageEntries = readMessageArrayEntries(payload.messages);
  const primaryEntries =
    envelopeKind === 'patch'
      ? (messageDeltaEntries ?? messageEntries)
      : (messageEntries ?? messageDeltaEntries);
  if (primaryEntries !== null) {
    for (const rawEntry of primaryEntries) {
      const message = parseMessageDeltaInput(rawEntry);
      if (message !== null) {
        parsed.messages.push(toHudMessageEvent(message, tick, serverSeq));
      }
    }
  } else if (legacyHudMessage !== null) {
    parsed.messages.push(legacyHudMessage);
  }

  return parsed;
}

/**
 * Reads one optional message-entry array from host HUD payloads.
 * Mirrors Playable Runtime bridge migration between legacy and canonical message lists
 * layered above Micropolis `SendMes`/`SendMesAt` delivery in
 * `ref/micropolis/src/sim/s_msg.c`.
 */
function readMessageArrayEntries(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value;
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
    tick: message.tick ?? tick,
    serverSeq: message.serverSeq ?? serverSeq,
  };
}

function parseMessageDeltaInput(value: unknown): ParsedMessageInput | null {
  const direct = parseMessageInput(value);
  if (direct !== null) {
    return direct;
  }

  const record = readRecord(value);
  if (record === null) {
    return null;
  }

  return parseMessageInput(record.message);
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
  const hasX = x !== null;
  const hasY = y !== null;
  if (hasX !== hasY) {
    return null;
  }

  // `doMessage` in s_msg.c checks `if (MesX || MesY)` to decide SendMesAt behavior.
  // Keep `(0, 0)` as plain `SendMes` dispatch to preserve that parity.
  const dispatch = x !== null && y !== null && (x !== 0 || y !== 0) ? 'sendMesAt' : 'sendMes';
  const projectedX = dispatch === 'sendMesAt' ? x : null;
  const projectedY = dispatch === 'sendMesAt' ? y : null;
  const replayTick = readReplayOrderInteger(record.tick);
  if (replayTick === undefined) {
    return null;
  }
  const replayServerSeq = readReplayOrderInteger(record.serverSeq);
  if (replayServerSeq === undefined) {
    return null;
  }

  return {
    id,
    text: record.text,
    dispatch,
    x: projectedX,
    y: projectedY,
    ...(replayTick === null ? {} : { tick: replayTick }),
    ...(replayServerSeq === null ? {} : { serverSeq: replayServerSeq }),
  };
}

function parseHudOptionsFromRecord(
  record: Record<string, unknown>,
): Partial<RuntimeHudOptionsState> | null {
  const options: Partial<RuntimeHudOptionsState> = {};
  addOptionBoolean(options, 'autoBudget', record.autoBudget, record.optionAutoBudget);
  addOptionBoolean(options, 'autoGo', record.autoGo, record.optionAutoGo);
  addOptionBoolean(options, 'autoBulldoze', record.autoBulldoze, record.optionAutoBulldoze);
  addOptionBoolean(options, 'disasters', record.disasters, record.optionDisasters);
  addOptionBoolean(options, 'userSoundOn', record.userSoundOn, record.optionUserSoundOn);
  addOptionBoolean(options, 'doAnimation', record.doAnimation, record.optionDoAnimation);
  addOptionBoolean(options, 'doMessages', record.doMessages, record.optionDoMessages);
  addOptionBoolean(options, 'doNotices', record.doNotices, record.optionDoNotices);

  if (Object.keys(options).length === 0) {
    return null;
  }

  return options;
}

function addOptionBoolean(
  options: Partial<RuntimeHudOptionsState>,
  key: keyof RuntimeHudOptionsState,
  primary: unknown,
  fallback: unknown,
): void {
  const value = readBoolean(primary) ?? readBoolean(fallback);
  if (value !== null) {
    options[key] = value;
  }
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

/**
 * Reads one optional non-negative integer used for replay ordering metadata.
 * Mirrors monotonic tick/sequence progression constraints from
 * `ref/micropolis/src/sim/s_sim.c` and `ref/micropolis/spec/integration/SPEC.md`.
 * Difference: this parser accepts omitted values to keep Playable Runtime compatibility
 * with older message payloads that only carry id/text/coordinates.
 */
function readReplayOrderInteger(value: unknown): number | null | undefined {
  if (value === undefined) {
    return null;
  }

  const parsed = readRangeInteger(value, 0, 2_000_000_000);
  if (parsed === null) {
    return undefined;
  }
  return parsed;
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

function readBoolean(value: unknown): boolean | null {
  if (typeof value !== 'boolean') {
    return null;
  }
  return value;
}

function isHudStateEqual(left: RuntimeHudState, right: RuntimeHudState): boolean {
  if (
    left.fundsLabel !== right.fundsLabel ||
    left.dateLabel !== right.dateLabel ||
    left.dateDisplayLabel !== right.dateDisplayLabel ||
    left.dateMonth !== right.dateMonth ||
    left.dateYear !== right.dateYear ||
    left.demandR !== right.demandR ||
    left.demandC !== right.demandC ||
    left.demandI !== right.demandI ||
    left.demandLabel !== right.demandLabel ||
    left.speed !== right.speed ||
    left.speedLabel !== right.speedLabel ||
    left.options.autoBudget !== right.options.autoBudget ||
    left.options.autoGo !== right.options.autoGo ||
    left.options.autoBulldoze !== right.options.autoBulldoze ||
    left.options.disasters !== right.options.disasters ||
    left.options.userSoundOn !== right.options.userSoundOn ||
    left.options.doAnimation !== right.options.doAnimation ||
    left.options.doMessages !== right.options.doMessages ||
    left.options.doNotices !== right.options.doNotices ||
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
      leftMessage.dispatch !== rightMessage.dispatch ||
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

function mergeOptions(
  previous: RuntimeHudOptionsState,
  delta: Partial<RuntimeHudOptionsState>,
): RuntimeHudOptionsState {
  return {
    autoBudget: delta.autoBudget ?? previous.autoBudget,
    autoGo: delta.autoGo ?? previous.autoGo,
    autoBulldoze: delta.autoBulldoze ?? previous.autoBulldoze,
    disasters: delta.disasters ?? previous.disasters,
    userSoundOn: delta.userSoundOn ?? previous.userSoundOn,
    doAnimation: delta.doAnimation ?? previous.doAnimation,
    doMessages: delta.doMessages ?? previous.doMessages,
    doNotices: delta.doNotices ?? previous.doNotices,
  };
}

function formatDateLabel(month: number, year: number): string {
  return `${HUD_MONTH_LABELS[month] ?? 'Jan'} ${year}`;
}

function formatDateDisplayLabel(dateLabel: string): string {
  return `Date: ${dateLabel}`;
}

function formatDemandLabel(demandR: number, demandC: number, demandI: number): string {
  return `Demand R/C/I: ${demandR}/${demandC}/${demandI}`;
}

/**
 * Formats the visible simulation speed text consumed by the Authoritative Runtime HUD.
 * Mirrors paused-speed display intent from `UISetSpeed` in
 * `ref/micropolis/src/sim/w_util.c`.
 */
function formatSpeedDisplayLabel(speed: number): string {
  return speed <= 0 ? 'Speed: Paused' : `Speed: x${speed}`;
}

function formatFundsLabel(funds: number): string {
  return `Funds: ${formatDollarDecimal(funds)}`;
}

function formatDollarDecimal(value: number): string {
  const raw = Math.max(0, Math.trunc(value)).toString();
  if (raw.length <= 3) {
    return `$${raw}`;
  }

  let left = raw.length % 3;
  if (left === 0) {
    left = 3;
  }

  let output = `$${raw.slice(0, left)}`;
  for (let index = left; index < raw.length; index += 3) {
    output += `,${raw.slice(index, index + 3)}`;
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
