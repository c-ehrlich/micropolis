import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';

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
 * Mirrors `SendMes` in `ref/micropolis/src/sim/s_msg.c`.
 */
export function sendMes(state: SimState, context: SimContext, id: number): boolean {
  if (!queueMessage(state, id)) {
    return false;
  }
  context.hooks.sendMes(id);
  return true;
}

/**
 * Sends a message tagged with a map coordinate if permitted.
 * Mirrors `SendMesAt` in `ref/micropolis/src/sim/s_msg.c`.
 */
export function sendMesAt(
  state: SimState,
  context: SimContext,
  id: number,
  x: number,
  y: number,
): boolean {
  if (!queueMessage(state, id)) {
    return false;
  }
  state.MesX = x;
  state.MesY = y;
  context.hooks.sendMesAt(id, x, y);
  return true;
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
