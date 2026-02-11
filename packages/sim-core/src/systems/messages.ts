import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';

type LastDispatched =
  | { kind: 'none' }
  | { kind: 'mes'; id: number }
  | { kind: 'mesAt'; id: number; x: number; y: number; autoGo: boolean };

const LAST_DISPATCHED = new WeakMap<SimState, LastDispatched>();

function getLastDispatched(state: SimState): LastDispatched {
  return LAST_DISPATCHED.get(state) ?? { kind: 'none' };
}

function setLastDispatched(state: SimState, next: LastDispatched): void {
  LAST_DISPATCHED.set(state, next);
}

/**
 * Clears runtime dispatch de-duplication state when no active message remains.
 * Mirrors the lifecycle boundary where `doMessage` in `ref/micropolis/src/sim/s_msg.c`
 * no longer has a current `MesNum` to present.
 *
 * Parity note: C de-duplicates by last rendered text (`SetMessageField` globals),
 * while sim-core de-duplicates hook dispatches by id/coords in this module. Clearing
 * this cache at `MesNum == 0` preserves expiry/requeue behavior for Message Feed message feeds.
 */
function clearLastDispatched(state: SimState): void {
  setLastDispatched(state, { kind: 'none' });
}

function dispatchMes(state: SimState, context: SimContext, id: number): void {
  const x = state.MesX;
  const y = state.MesY;

  // s_msg.c doMessage: both picture and text messages can carry MesX/MesY, but MesX/MesY
  // are only consumed (cleared) when `autoGo` is enabled.
  const wantsAt = x !== 0 || y !== 0;

  // C parity: picture delivery (`UIShowPicture`) is not deduplicated by `SetMessageField`,
  // so always forward negative ids through the hook layer.
  if (id < 0) {
    if (wantsAt) {
      context.hooks.sendMesAt(id, x, y);
    } else {
      context.hooks.sendMes(id);
    }
    return;
  }

  // C parity: `doMessage()` runs every heads tick. Its `SetMessageField` helper suppresses
  // redundant UI updates when the message hasn't changed. sim-core does the same suppression
  // at the id/coordinate level, since message string lookup lives in the UI layer.
  const prev = getLastDispatched(state);
  if (!wantsAt) {
    if (prev.kind !== 'none' && prev.id === id) {
      return;
    }
    setLastDispatched(state, { kind: 'mes', id });
    context.hooks.sendMes(id);
    return;
  }

  if (
    prev.kind === 'mesAt' &&
    prev.id === id &&
    prev.x === x &&
    prev.y === y &&
    prev.autoGo === state.autoGo
  ) {
    return;
  }
  setLastDispatched(state, { kind: 'mesAt', id, x, y, autoGo: state.autoGo });
  context.hooks.sendMesAt(id, x, y);
}

const MESSAGE_SOUND_CHANNEL_CITY = 0;
const MESSAGE_SOUND_HONK_MED = 1;
const MESSAGE_SOUND_HONK_LOW = 2;
const MESSAGE_SOUND_HONK_HIGH = 3;
const MESSAGE_SOUND_SIREN = 4;
const MESSAGE_SOUND_MONSTER = 5;
const MESSAGE_SOUND_EXPLOSION_LOW = 6;
const MESSAGE_SOUND_EXPLOSION_HIGH = 7;
const MESSAGE_SOUND_CHANNEL_NAME_BY_ID: Readonly<Record<number, string>> = {
  [MESSAGE_SOUND_CHANNEL_CITY]: 'city',
};
const MESSAGE_SOUND_SPEC_BY_ID: Readonly<Record<number, string>> = {
  [MESSAGE_SOUND_HONK_MED]: 'HonkHonk-Med',
  [MESSAGE_SOUND_HONK_LOW]: 'HonkHonk-Low',
  [MESSAGE_SOUND_HONK_HIGH]: 'HonkHonk-High',
  [MESSAGE_SOUND_SIREN]: 'Siren',
  [MESSAGE_SOUND_MONSTER]: 'Monster -speed [MonsterSpeed]',
  [MESSAGE_SOUND_EXPLOSION_LOW]: 'Explosion-Low',
  [MESSAGE_SOUND_EXPLOSION_HIGH]: 'Explosion-High',
};

/**
 * One resolved message-sound intent from sim-core `makeSound(channel, sound)` ids.
 * Mirrors the `doMessage` first-display `MakeSound("city", "...")` switch in
 * `ref/micropolis/src/sim/s_msg.c`.
 * Parity note: C routes named channel/spec strings directly, while sim-core emits
 * numeric hook ids; this structure is the canonical id->string bridge for consumers.
 */
export interface DoMessageHookSoundIntent {
  readonly channel: string;
  readonly soundSpec: string;
}

/**
 * Resolves one sim-core `SimHooks.makeSound(channel, sound)` payload to the
 * Micropolis channel/spec pair used by `doMessage` first-display sounds.
 * Mirrors `MakeSound("city", "...")` callsites in
 * `ref/micropolis/src/sim/s_msg.c`.
 * Parity note: unknown ids intentionally return `null` so non-message callers
 * can coexist on the same hook without accidental remapping.
 */
export function resolveDoMessageHookSoundIntent(
  channel: number,
  sound: number,
): DoMessageHookSoundIntent | null {
  const normalizedChannel = Math.trunc(channel);
  const normalizedSound = Math.trunc(sound);
  const channelName = MESSAGE_SOUND_CHANNEL_NAME_BY_ID[normalizedChannel];
  const soundSpec = MESSAGE_SOUND_SPEC_BY_ID[normalizedSound];
  if (channelName === undefined || soundSpec === undefined) {
    return null;
  }
  return {
    channel: channelName,
    soundSpec,
  };
}

/**
 * First-display sound effects for queued messages.
 * Mirrors the `firstTime` sound switch in `doMessage` from
 * `ref/micropolis/src/sim/s_msg.c`.
 *
 * Parity note: C uses named sound strings via `MakeSound("city", "...")`.
 * sim-core forwards stable numeric `(channel, sound)` ids through `SimHooks.makeSound`.
 */
function playFirstDisplaySound(state: SimState, context: SimContext): void {
  const messageId = state.MesNum < 0 ? -state.MesNum : state.MesNum;

  switch (messageId) {
    case 12:
      if (context.rng.rand(5) === 1) {
        context.hooks.makeSound(MESSAGE_SOUND_CHANNEL_CITY, MESSAGE_SOUND_HONK_MED);
      } else if (context.rng.rand(5) === 1) {
        context.hooks.makeSound(MESSAGE_SOUND_CHANNEL_CITY, MESSAGE_SOUND_HONK_LOW);
      } else if (context.rng.rand(5) === 1) {
        context.hooks.makeSound(MESSAGE_SOUND_CHANNEL_CITY, MESSAGE_SOUND_HONK_HIGH);
      }
      return;
    case 11:
    case 20:
    case 22:
    case 23:
    case 24:
    case 25:
    case 26:
    case 27:
    case 44:
      context.hooks.makeSound(MESSAGE_SOUND_CHANNEL_CITY, MESSAGE_SOUND_SIREN);
      return;
    case 21:
      context.hooks.makeSound(MESSAGE_SOUND_CHANNEL_CITY, MESSAGE_SOUND_MONSTER);
      return;
    case 30:
      context.hooks.makeSound(MESSAGE_SOUND_CHANNEL_CITY, MESSAGE_SOUND_EXPLOSION_LOW);
      context.hooks.makeSound(MESSAGE_SOUND_CHANNEL_CITY, MESSAGE_SOUND_SIREN);
      return;
    case 43:
      context.hooks.makeSound(MESSAGE_SOUND_CHANNEL_CITY, MESSAGE_SOUND_EXPLOSION_HIGH);
      context.hooks.makeSound(MESSAGE_SOUND_CHANNEL_CITY, MESSAGE_SOUND_EXPLOSION_LOW);
      context.hooks.makeSound(MESSAGE_SOUND_CHANNEL_CITY, MESSAGE_SOUND_SIREN);
      return;
  }
}

/**
 * Core message port enqueue logic.
 * Mirrors `SendMes` in `ref/micropolis/src/sim/s_msg.c`.
 */
function queueMessage(state: SimState, id: number): boolean {
  if (id < 0) {
    if (id !== state.LastPicNum) {
      state.MessagePort = id;
      state.MesX = 0;
      state.MesY = 0;
      state.LastPicNum = id;
      return true;
    }
    return false;
  }

  if (state.MessagePort === 0) {
    state.MessagePort = id;
    state.MesX = 0;
    state.MesY = 0;
    return true;
  }

  return false;
}

/**
 * Clears the message port and last-picture state.
 * Mirrors `ClearMes` in `ref/micropolis/src/sim/s_msg.c`.
 */
export function clearMes(state: SimState): void {
  state.MessagePort = 0;
  state.MesX = 0;
  state.MesY = 0;
  state.LastPicNum = 0;
}

/**
 * Internal UI helper: consume the queued message and clear MessagePort.
 * Mirrors the MessagePort clear path in `doMessage` from `ref/micropolis/src/sim/s_msg.c`.
 * This is not a 1:1 port of `doMessage`; the UI is expected to call this after
 * it displays the message so the port is freed for subsequent `SendMes` calls.
 */
export function _consumeMessagePort(state: SimState): { id: number; x: number; y: number } | null {
  const id = state.MessagePort;
  if (!id) {
    return null;
  }
  state.MessagePort = 0;
  return { id, x: state.MesX, y: state.MesY };
}

/**
 * Sends a message through the port if permitted.
 * Mirrors `SendMes` in `ref/micropolis/src/sim/s_msg.c` (1:1).
 *
 * Note: In Micropolis C, `SendMes` only enqueues the message in `MessagePort`.
 * Delivery/consumption happens later via `doMessage` (also in `s_msg.c`), which
 * is called from `updateDate` (`ref/micropolis/src/sim/w_update.c`).
 *
 * sim-core follows the same split: callers enqueue via `sendMes`/`sendMesAt`,
 * and the UI is driven by `doMessage()` during the heads update path.
 */
export function sendMes(state: SimState, _context: SimContext, id: number): boolean {
  return queueMessage(state, id);
}

/**
 * Sends a message tagged with a map coordinate if permitted.
 * Mirrors `SendMesAt` in `ref/micropolis/src/sim/s_msg.c` (1:1).
 */
export function sendMesAt(
  state: SimState,
  _context: SimContext,
  id: number,
  x: number,
  y: number,
): boolean {
  if (!queueMessage(state, id)) return false;
  state.MesX = x;
  state.MesY = y;
  return true;
}

/**
 * UI message loop (port consumption, picture requeue, and expiry).
 *
 * Mirrors `doMessage` in `ref/micropolis/src/sim/s_msg.c` (core behavior, 1:1):
 * - Consumes `MessagePort` into `MesNum` and clears the port.
 * - Triggers first-display message sounds from the `firstTime` switch table.
 * - Requeues picture messages by setting `MessagePort = pictId` so the text message
 *   is shown on the next tick.
 * - Expires active non-picture messages after `(60 * 30)` ticks via `TickCount()`.
 *
 * sim-core routes UI delivery through `SimHooks.sendMes` / `SimHooks.sendMesAt`.
 * (C uses `Eval("UISetMessage ...")` / `Eval("UIShowPicture ...")`.)
 */
export function doMessage(state: SimState, context: SimContext): void {
  const tick = context.hooks.tickCount();
  let firstTime = false;

  if (state.MessagePort) {
    state.MesNum = state.MessagePort;
    state.MessagePort = 0;
    state.LastMesTime = tick;
    firstTime = true;
  } else {
    if (state.MesNum === 0) {
      clearLastDispatched(state);
      return;
    }

    // s_msg.c: picture messages flip sign and reset the timer when there is no port input.
    if (state.MesNum < 0) {
      state.MesNum = -state.MesNum;
      state.LastMesTime = tick;
    } else if (tick - state.LastMesTime > 60 * 30) {
      state.MesNum = 0;
      clearLastDispatched(state);
      return;
    }
  }

  if (firstTime) {
    playFirstDisplaySound(state, context);
  }

  if (state.MesNum >= 0) {
    if (state.MesNum === 0) return;
    if (state.MesNum > 60) {
      state.MesNum = 0;
      clearLastDispatched(state);
      return;
    }

    dispatchMes(state, context, state.MesNum);

    // s_msg.c: `autoGo` consumes MesX/MesY after it triggers the UI auto-goto.
    if (state.autoGo && (state.MesX || state.MesY)) {
      state.MesX = 0;
      state.MesY = 0;
    }

    return;
  }

  // Picture message.
  const pictId = -state.MesNum;
  dispatchMes(state, context, -pictId);

  // s_msg.c: requeue the corresponding *text* message.
  state.MessagePort = pictId;

  // s_msg.c: `autoGo` consumes MesX/MesY after it triggers the UI auto-goto.
  if (state.autoGo && (state.MesX || state.MesY)) {
    state.MesX = 0;
    state.MesY = 0;
  }
}

/**
 * Scenario win/lose scoring for SendMessages.
 * Mirrors `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c`.
 */
export function doScenarioScore(state: SimState, context: SimContext, type: number): void {
  let z = -200;

  switch (type) {
    case 1:
    case 2:
    case 3:
      if (state.CityClass >= 4) {
        z = -100;
      }
      break;
    case 4:
      if (state.TrafficAverage < 80) {
        z = -100;
      }
      break;
    case 5:
      if (state.CityScore > 500) {
        z = -100;
      }
      break;
    case 6:
      if (state.CrimeAverage < 60) {
        z = -100;
      }
      break;
    case 7:
    case 8:
      if (state.CityScore > 500) {
        z = -100;
      }
      break;
  }

  clearMes(state);
  sendMes(state, context, z);

  if (z === -200) {
    context.hooks.doLoseGame();
  }
}

/**
 * Population milestone messaging.
 * Mirrors `CheckGrowth` in `ref/micropolis/src/sim/s_msg.c`.
 */
export function checkGrowth(state: SimState, context: SimContext): void {
  if ((state.CityTime & 3) !== 0) {
    return;
  }

  let z = 0;
  const thisCityPop = (state.ResPop + state.ComPop * 8 + state.IndPop * 8) * 20;

  if (state.LastCityPop) {
    if (state.LastCityPop < 2000 && thisCityPop >= 2000) {
      z = 35;
    }
    if (state.LastCityPop < 10000 && thisCityPop >= 10000) {
      z = 36;
    }
    if (state.LastCityPop < 50000 && thisCityPop >= 50000) {
      z = 37;
    }
    if (state.LastCityPop < 100000 && thisCityPop >= 100000) {
      z = 38;
    }
    if (state.LastCityPop < 500000 && thisCityPop >= 500000) {
      z = 39;
    }
  }

  if (z && z !== state.LastCategory) {
    sendMes(state, context, -z);
    state.LastCategory = z;
  }

  state.LastCityPop = thisCityPop;
}

/**
 * Threshold-driven messaging and scenario score countdown.
 * Mirrors `SendMessages` in `ref/micropolis/src/sim/s_msg.c`.
 */
export function sendMessages(state: SimState, context: SimContext): void {
  if (state.ScenarioID && state.ScoreType && state.ScoreWait) {
    state.ScoreWait -= 1;
    if (state.ScoreWait === 0) {
      doScenarioScore(state, context, state.ScoreType);
    }
  }

  checkGrowth(state, context);

  const totalZPop = state.ResZPop + state.ComZPop + state.IndZPop;
  state.TotalZPop = totalZPop;
  const powerPop = state.NuclearPop + state.CoalPop;

  switch (state.CityTime & 63) {
    case 1:
      if (totalZPop >> 2 >= state.ResZPop) {
        sendMes(state, context, 1);
      }
      break;
    case 5:
      if (totalZPop >> 3 >= state.ComZPop) {
        sendMes(state, context, 2);
      }
      break;
    case 10:
      if (totalZPop >> 3 >= state.IndZPop) {
        sendMes(state, context, 3);
      }
      break;
    case 14:
      if (totalZPop > 10 && totalZPop << 1 > state.RoadTotal) {
        sendMes(state, context, 4);
      }
      break;
    case 18:
      if (totalZPop > 50 && totalZPop > state.RailTotal) {
        sendMes(state, context, 5);
      }
      break;
    case 22:
      if (totalZPop > 10 && powerPop === 0) {
        sendMes(state, context, 6);
      }
      break;
    case 26:
      if (state.ResPop > 500 && state.StadiumPop === 0) {
        sendMes(state, context, 7);
        state.ResCap = 1;
      } else {
        state.ResCap = 0;
      }
      break;
    case 28:
      if (state.IndPop > 70 && state.PortPop === 0) {
        sendMes(state, context, 8);
        state.IndCap = 1;
      } else {
        state.IndCap = 0;
      }
      break;
    case 30:
      if (state.ComPop > 100 && state.APortPop === 0) {
        sendMes(state, context, 9);
        state.ComCap = 1;
      } else {
        state.ComCap = 0;
      }
      break;
    case 32: {
      const total = state.unPwrdZCnt + state.PwrdZCnt;
      if (total && state.PwrdZCnt / total < 0.7) {
        sendMes(state, context, 15);
      }
      break;
    }
    case 35:
      if (state.PolluteAverage > 60) {
        sendMes(state, context, -10);
      }
      break;
    case 42:
      if (state.CrimeAverage > 100) {
        sendMes(state, context, -11);
      }
      break;
    case 45:
      if (state.TotalPop > 60 && state.FireStPop === 0) {
        sendMes(state, context, 13);
      }
      break;
    case 48:
      if (state.TotalPop > 60 && state.PolicePop === 0) {
        sendMes(state, context, 14);
      }
      break;
    case 51:
      if (state.CityTax > 12) {
        sendMes(state, context, 16);
      }
      break;
    case 54:
      if (state.RoadEffect < 20 && state.RoadTotal > 30) {
        sendMes(state, context, 17);
      }
      break;
    case 57:
      if (state.FireEffect < 700 && state.TotalPop > 20) {
        sendMes(state, context, 18);
      }
      break;
    case 60:
      if (state.PoliceEffect < 700 && state.TotalPop > 20) {
        sendMes(state, context, 19);
      }
      break;
    case 63:
      if (state.TrafficAverage > 60) {
        sendMes(state, context, -12);
      }
      break;
  }
}
