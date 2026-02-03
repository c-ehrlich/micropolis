import { assertDefined } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import type { MapStore } from '../core/map-store.ts';
import type { MicropolisRng } from '../core/rng.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import type { MapScanContext } from './map-scan.ts';
import { setZPowerAt } from './power.ts';

const { WORLD_X, WORLD_Y, HWLDY, SmX, SmY } = World;
const { LOMASK } = TileMask;
const { ANIMBIT, BNCNBIT, BULLBIT, BURNBIT, CONDBIT, PWRBIT, ZONEBIT, BLBNCNBIT } = TileFlag;
const {
  AIRPORT,
  CHURCH,
  COALSMOKE1,
  COALSMOKE2,
  COALSMOKE3,
  COALSMOKE4,
  COMBASE,
  COMCLR,
  CZB,
  FIRESTATION,
  FOOTBALLGAME1,
  FOOTBALLGAME2,
  FREEZ,
  FULLSTADIUM,
  HOSPITAL,
  HOUSE,
  HHTHR,
  INDBASE,
  INDCLR,
  IND1,
  IND2,
  IND3,
  IND4,
  IND5,
  IND6,
  IND7,
  IND8,
  IND9,
  IZB,
  LASTRAIL,
  LASTROAD,
  LHTHR,
  NUCLEAR,
  POLICESTATION,
  PORT,
  PORTBASE,
  POWERBASE,
  POWERPLANT,
  RADAR,
  RAILHPOWERV,
  RESBASE,
  ROADBASE,
  RZB,
  SMOKEBASE,
  STADIUM,
} = Tile;

const SHI = 4;

const PERIM_X = [-1, 0, 1, 2, 2, 2, 1, 0, -1, -2, -2, -2] as const;
const PERIM_Y = [-2, -2, -2, -1, 0, 1, 2, 2, 2, 1, 0, -1] as const;
const RES_BORDER = [0, 3, 6, 1, 4, 7, 2, 5, 8] as const;
const MLT_DOWN_TAB = [30000, 20000, 10000] as const;

const ANI_THIS = [1, 0, 1, 1, 0, 0, 1, 1] as const;
const DX1 = [-1, 0, 1, 0, 0, 0, 0, 1] as const;
const DY1 = [-1, 0, -1, -1, 0, 0, -1, -1] as const;
const ANI_TAB_A = [0, 0, 32, 40, 0, 0, 48, 56] as const;
const ANI_TAB_B = [0, 0, 36, 44, 0, 0, 52, 60] as const;
const ANI_TAB_C = [IND1, 0, IND2, IND4, 0, 0, IND6, IND8] as const;
const ANI_TAB_D = [IND1, 0, IND3, IND5, 0, 0, IND7, IND9] as const;

const COAL_SMOKE = [COALSMOKE1, COALSMOKE2, COALSMOKE3, COALSMOKE4] as const;
const COAL_SMOKE_DX = [1, 2, 1, 2] as const;
const COAL_SMOKE_DY = [-1, -1, 0, 0] as const;

export interface ZoneSystemContext {
  state: SimState;
  context: SimContext;
  store: MapStore;
  rng: MicropolisRng;
  map: Uint16Array;
  power: Uint16Array;
  landValueMem: Uint8Array;
  pollutionMem: Uint8Array;
  popDensity: Uint8Array;
  comRate: Int16Array;
  rateOGMem: Int16Array;
  fireStMap: Int16Array;
  policeMap: Int16Array;
}

export type MakeTrafHandler = (
  zoneType: number,
  system: ZoneSystemContext,
  x: number,
  y: number,
) => number;
export type FindPerimeterRoadHandler = (system: ZoneSystemContext, x: number, y: number) => boolean;
export type PushPowerStackHandler = (system: ZoneSystemContext, x: number, y: number) => void;
export type MeltdownHandler = (system: ZoneSystemContext, x: number, y: number) => void;

export interface ZoneHandlerOptions {
  makeTraf?: MakeTrafHandler;
  findPerimeterRoad?: FindPerimeterRoadHandler;
  pushPowerStack?: PushPowerStackHandler;
  doMeltdown?: MeltdownHandler;
}

const noop = () => {};

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

const isInBounds = (x: number, y: number) => x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y;

const toSigned16 = (value: number) => (value << 16) >> 16;

const div = (value: number, divisor: number) => Math.trunc(value / divisor);

export function createZoneSystem(state: SimState, context: SimContext): ZoneSystemContext {
  const store = context.store;
  return {
    state,
    context,
    store,
    rng: context.rng,
    map: store.getLayer('map') as Uint16Array,
    power: store.getLayer('power') as Uint16Array,
    landValueMem: store.getLayer('landValueMem') as Uint8Array,
    pollutionMem: store.getLayer('pollutionMem') as Uint8Array,
    popDensity: store.getLayer('popDensity') as Uint8Array,
    comRate: store.getLayer('comRate') as Int16Array,
    rateOGMem: store.getLayer('rateOGMem') as Int16Array,
    fireStMap: store.getLayer('fireStMap') as Int16Array,
    policeMap: store.getLayer('policeMap') as Int16Array,
  };
}

export function createZoneHandler(
  state: SimState,
  context: SimContext,
  options: ZoneHandlerOptions = {},
): (scan: MapScanContext) => void {
  const system = createZoneSystem(state, context);
  return (scan) => doZone(system, scan.x, scan.y, scan.tile, options);
}

export function doZone(
  system: ZoneSystemContext,
  x: number,
  y: number,
  tile: number,
  options: ZoneHandlerOptions = {},
): void {
  const tileId = tile & LOMASK;
  const powered = setZPowerAt(system.store, system.power, x, y, indexFor(x, y), tile);
  if (powered) {
    system.state.PwrdZCnt += 1;
  } else {
    system.state.unPwrdZCnt += 1;
  }

  if (tileId > PORTBASE) {
    doSpecialZone(system, x, y, tileId, powered, options);
    return;
  }
  if (tileId < HOSPITAL) {
    doResidential(system, x, y, tileId, powered, options);
    return;
  }
  if (tileId < COMBASE) {
    doHospChur(system, x, y, tileId, options);
    return;
  }
  if (tileId < INDBASE) {
    doCommercial(system, x, y, tileId, powered, options);
    return;
  }
  doIndustrial(system, x, y, tileId, powered, options);
}

export function doHospChur(
  system: ZoneSystemContext,
  x: number,
  y: number,
  tileId: number,
  options: ZoneHandlerOptions = {},
): void {
  const { state, rng } = system;
  if (tileId === HOSPITAL) {
    state.HospPop += 1;
    if ((state.CityTime & 15) === 0) {
      repairZone(system, x, y, HOSPITAL, 3);
    }
    if (state.NeedHosp === -1 && rng.rand(20) === 0) {
      zonePlop(system, x, y, RESBASE, options);
    }
  }
  if (tileId === CHURCH) {
    state.ChurchPop += 1;
    if ((state.CityTime & 15) === 0) {
      repairZone(system, x, y, CHURCH, 3);
    }
    if (state.NeedChurch === -1 && rng.rand(20) === 0) {
      zonePlop(system, x, y, RESBASE, options);
    }
  }
}

export function repairZone(
  system: ZoneSystemContext,
  x: number,
  y: number,
  centerTile: number,
  zsize: number,
): void {
  const { map, store } = system;
  let size = zsize - 1;
  let cnt = 0;
  for (let yy = -1; yy < size; yy += 1) {
    for (let xx = -1; xx < size; xx += 1) {
      const tx = x + xx;
      const ty = y + yy;
      cnt += 1;
      if (!isInBounds(tx, ty)) {
        continue;
      }
      const index = indexFor(tx, ty);
      const current = map[index] ?? 0;
      if ((current & ZONEBIT) !== 0) {
        continue;
      }
      if ((current & ANIMBIT) !== 0) {
        continue;
      }
      const tileId = current & LOMASK;
      if (tileId < Tile.RUBBLE || tileId >= ROADBASE) {
        store.write('map', index, centerTile - 3 - size + cnt + CONDBIT + BURNBIT);
      }
    }
  }
}

export function doSpecialZone(
  system: ZoneSystemContext,
  x: number,
  y: number,
  tileId: number,
  powered: boolean,
  options: ZoneHandlerOptions = {},
): void {
  const { state, rng, store, map } = system;
  const findRoad = options.findPerimeterRoad ?? findPerimeterRoad;
  const pushPower = options.pushPowerStack ?? noop;
  const meltdown = options.doMeltdown ?? doMeltdown;

  switch (tileId) {
    case POWERPLANT:
      state.CoalPop += 1;
      if ((state.CityTime & 7) === 0) {
        repairZone(system, x, y, POWERPLANT, 4);
      }
      pushPower(system, x, y);
      coalSmoke(system, x, y);
      return;
    case NUCLEAR:
      if (!state.NoDisasters) {
        const odds = MLT_DOWN_TAB[state.GameLevel] ?? MLT_DOWN_TAB[0];
        if (rng.rand(odds) === 0) {
          meltdown(system, x, y);
          return;
        }
      }
      state.NuclearPop += 1;
      if ((state.CityTime & 7) === 0) {
        repairZone(system, x, y, NUCLEAR, 4);
      }
      pushPower(system, x, y);
      return;
    case FIRESTATION: {
      state.FireStPop += 1;
      if ((state.CityTime & 7) === 0) {
        repairZone(system, x, y, FIRESTATION, 3);
      }
      let z = powered ? state.FireEffect : state.FireEffect >> 1;
      if (!findRoad(system, x, y)) {
        z = z >> 1;
      }
      const index = (x >> 3) * SmY + (y >> 3);
      const current = system.fireStMap[index] ?? 0;
      store.write('fireStMap', index, current + z);
      return;
    }
    case POLICESTATION: {
      state.PolicePop += 1;
      if ((state.CityTime & 7) === 0) {
        repairZone(system, x, y, POLICESTATION, 3);
      }
      let z = powered ? state.PoliceEffect : state.PoliceEffect >> 1;
      if (!findRoad(system, x, y)) {
        z = z >> 1;
      }
      const index = (x >> 3) * SmY + (y >> 3);
      const current = system.policeMap[index] ?? 0;
      store.write('policeMap', index, current + z);
      return;
    }
    case STADIUM:
      state.StadiumPop += 1;
      if ((state.CityTime & 15) === 0) {
        repairZone(system, x, y, STADIUM, 4);
      }
      if (powered && ((state.CityTime + x + y) & 31) === 0) {
        drawStadium(system, x, y, FULLSTADIUM);
        if (isInBounds(x + 1, y)) {
          store.write('map', indexFor(x + 1, y), FOOTBALLGAME1 + ANIMBIT);
        }
        if (isInBounds(x + 1, y + 1)) {
          store.write('map', indexFor(x + 1, y + 1), FOOTBALLGAME2 + ANIMBIT);
        }
      }
      return;
    case FULLSTADIUM:
      state.StadiumPop += 1;
      if (((state.CityTime + x + y) & 7) === 0) {
        drawStadium(system, x, y, STADIUM);
      }
      return;
    case AIRPORT:
      state.APortPop += 1;
      if ((state.CityTime & 7) === 0) {
        repairZone(system, x, y, AIRPORT, 6);
      }
      if (isInBounds(x + 1, y - 1)) {
        const radarIndex = indexFor(x + 1, y - 1);
        const radarTile = map[radarIndex];
        assertDefined(radarTile);
        if (powered) {
          if ((radarTile & LOMASK) === RADAR) {
            store.write('map', radarIndex, RADAR + ANIMBIT + CONDBIT + BURNBIT);
          }
        } else {
          store.write('map', radarIndex, RADAR + CONDBIT + BURNBIT);
        }
      }
      if (powered) {
        doAirport(system);
      }
      return;
    case PORT:
      state.PortPop += 1;
      if ((state.CityTime & 15) === 0) {
        repairZone(system, x, y, PORT, 4);
      }
      if (powered && !system.context.hooks.getSprite(SHI)) {
        system.context.hooks.generateShip();
      }
      return;
    default:
      return;
  }
}

export function doIndustrial(
  system: ZoneSystemContext,
  x: number,
  y: number,
  tileId: number,
  powered: boolean,
  options: ZoneHandlerOptions = {},
): void {
  const { state, rng } = system;
  state.IndZPop += 1;
  setSmoke(system, x, y, tileId, powered);
  const tpop = izPop(tileId);
  state.IndPop += tpop;
  const trfGood = tpop > rng.rand(5) ? makeTraf(system, x, y, 2, options) : 1;

  if (trfGood === -1) {
    doIndOut(system, x, y, tpop, rng.next16() & 1, options);
    return;
  }

  if ((rng.next16() & 7) === 0) {
    let zscore = state.IValve + evalInd(trfGood);
    if (!powered) {
      zscore = -500;
    }
    if (zscore > -350 && toSigned16(zscore - 26380) > toSigned16(rng.next16Signed())) {
      doIndIn(system, x, y, tpop, rng.next16() & 1, options);
      return;
    }
    if (zscore < 350 && toSigned16(zscore + 26380) < toSigned16(rng.next16Signed())) {
      doIndOut(system, x, y, tpop, rng.next16() & 1, options);
    }
  }
}

export function doCommercial(
  system: ZoneSystemContext,
  x: number,
  y: number,
  tileId: number,
  powered: boolean,
  options: ZoneHandlerOptions = {},
): void {
  const { state, rng } = system;
  state.ComZPop += 1;
  const tpop = czPop(tileId);
  state.ComPop += tpop;
  const trfGood = tpop > rng.rand(5) ? makeTraf(system, x, y, 1, options) : 1;

  if (trfGood === -1) {
    const value = getCRVal(system, x, y);
    doComOut(system, x, y, tpop, value, options);
    return;
  }

  if ((rng.next16() & 7) === 0) {
    const locvalve = evalCom(system, x, y, trfGood);
    let zscore = state.CValve + locvalve;
    if (!powered) {
      zscore = -500;
    }
    if (trfGood && zscore > -350 && toSigned16(zscore - 26380) > toSigned16(rng.next16Signed())) {
      const value = getCRVal(system, x, y);
      doComIn(system, x, y, tpop, value, options);
      return;
    }
    if (zscore < 350 && toSigned16(zscore + 26380) < toSigned16(rng.next16Signed())) {
      const value = getCRVal(system, x, y);
      doComOut(system, x, y, tpop, value, options);
    }
  }
}

export function doResidential(
  system: ZoneSystemContext,
  x: number,
  y: number,
  tileId: number,
  powered: boolean,
  options: ZoneHandlerOptions = {},
): void {
  const { state, rng } = system;
  state.ResZPop += 1;
  const tpop = tileId === FREEZ ? doFreePop(system, x, y) : rzPop(tileId);
  state.ResPop += tpop;
  const trfGood = tpop > rng.rand(35) ? makeTraf(system, x, y, 0, options) : 1;

  if (trfGood === -1) {
    const value = getCRVal(system, x, y);
    doResOut(system, x, y, tileId, tpop, value, options);
    return;
  }

  if (tileId === FREEZ || (rng.next16() & 7) === 0) {
    const locvalve = evalRes(system, x, y, trfGood);
    let zscore = state.RValve + locvalve;
    if (!powered) {
      zscore = -500;
    }
    if (zscore > -350 && toSigned16(zscore - 26380) > toSigned16(rng.next16Signed())) {
      if (!tpop && (rng.next16() & 3) === 0) {
        makeHosp(system, x, y, options);
        return;
      }
      const value = getCRVal(system, x, y);
      doResIn(system, x, y, tileId, tpop, value, options);
      return;
    }
    if (zscore < 350 && toSigned16(zscore + 26380) < toSigned16(rng.next16Signed())) {
      const value = getCRVal(system, x, y);
      doResOut(system, x, y, tileId, tpop, value, options);
    }
  }
}

export function makeHosp(
  system: ZoneSystemContext,
  x: number,
  y: number,
  options: ZoneHandlerOptions = {},
): void {
  const { state } = system;
  if (state.NeedHosp > 0) {
    zonePlop(system, x, y, HOSPITAL - 4, options);
    state.NeedHosp = 0;
    return;
  }
  if (state.NeedChurch > 0) {
    zonePlop(system, x, y, CHURCH - 4, options);
    state.NeedChurch = 0;
  }
}

export function getCRVal(system: ZoneSystemContext, x: number, y: number): number {
  const index = (x >> 1) * HWLDY + (y >> 1);
  let lval = system.landValueMem[index] ?? 0;
  lval -= system.pollutionMem[index] ?? 0;
  if (lval < 30) {
    return 0;
  }
  if (lval < 80) {
    return 1;
  }
  if (lval < 150) {
    return 2;
  }
  return 3;
}

export function doResIn(
  system: ZoneSystemContext,
  x: number,
  y: number,
  tileId: number,
  pop: number,
  value: number,
  options: ZoneHandlerOptions = {},
): void {
  const index = (x >> 1) * HWLDY + (y >> 1);
  if ((system.pollutionMem[index] ?? 0) > 128) {
    return;
  }
  if (tileId === FREEZ) {
    if (pop < 8) {
      buildHouse(system, x, y, value);
      incROG(system, x, y, 1);
      return;
    }
    if ((system.popDensity[index] ?? 0) > 64) {
      resPlop(system, x, y, 0, value, options);
      incROG(system, x, y, 8);
    }
    return;
  }
  if (pop < 40) {
    resPlop(system, x, y, div(pop, 8) - 1, value, options);
    incROG(system, x, y, 8);
  }
}

export function doComIn(
  system: ZoneSystemContext,
  x: number,
  y: number,
  pop: number,
  value: number,
  options: ZoneHandlerOptions = {},
): void {
  const index = (x >> 1) * HWLDY + (y >> 1);
  let z = system.landValueMem[index] ?? 0;
  z = z >> 5;
  if (pop > z) {
    return;
  }
  if (pop < 5) {
    comPlop(system, x, y, pop, value, options);
    incROG(system, x, y, 8);
  }
}

export function doIndIn(
  system: ZoneSystemContext,
  x: number,
  y: number,
  pop: number,
  value: number,
  options: ZoneHandlerOptions = {},
): void {
  if (pop < 4) {
    indPlop(system, x, y, pop, value, options);
    incROG(system, x, y, 8);
  }
}

export function incROG(system: ZoneSystemContext, x: number, y: number, amount: number): void {
  const index = (x >> 3) * SmY + (y >> 3);
  const current = system.rateOGMem[index] ?? 0;
  system.store.write('rateOGMem', index, current + (amount << 2));
}

export function doResOut(
  system: ZoneSystemContext,
  x: number,
  y: number,
  tileId: number,
  pop: number,
  value: number,
  options: ZoneHandlerOptions = {},
): void {
  if (pop === 0) {
    return;
  }
  if (pop > 16) {
    resPlop(system, x, y, div(pop - 24, 8), value, options);
    incROG(system, x, y, -8);
    return;
  }
  if (pop === 16) {
    incROG(system, x, y, -8);
    if (isInBounds(x, y)) {
      system.store.write('map', indexFor(x, y), FREEZ | BLBNCNBIT | ZONEBIT);
    }
    for (let xx = x - 1; xx <= x + 1; xx += 1) {
      for (let yy = y - 1; yy <= y + 1; yy += 1) {
        if (!isInBounds(xx, yy)) {
          continue;
        }
        const index = indexFor(xx, yy);
        if (((system.map[index] ?? 0) & LOMASK) !== FREEZ) {
          system.store.write('map', index, LHTHR + value + system.rng.rand(2) + BLBNCNBIT);
        }
      }
    }
    return;
  }

  if (pop < 16) {
    incROG(system, x, y, -1);
    let z = 0;
    for (let xx = x - 1; xx <= x + 1; xx += 1) {
      for (let yy = y - 1; yy <= y + 1; yy += 1) {
        if (!isInBounds(xx, yy)) {
          z += 1;
          continue;
        }
        const index = indexFor(xx, yy);
        const loc = (system.map[index] ?? 0) & LOMASK;
        if (loc >= LHTHR && loc <= HHTHR) {
          const border = RES_BORDER[z];
          assertDefined(border);
          system.store.write('map', index, border + BLBNCNBIT + FREEZ - 4);
          return;
        }
        z += 1;
      }
    }
  }
}

export function doComOut(
  system: ZoneSystemContext,
  x: number,
  y: number,
  pop: number,
  value: number,
  options: ZoneHandlerOptions = {},
): void {
  if (pop > 1) {
    comPlop(system, x, y, pop - 2, value, options);
    incROG(system, x, y, -8);
    return;
  }
  if (pop === 1) {
    zonePlop(system, x, y, COMBASE, options);
    incROG(system, x, y, -8);
  }
}

export function doIndOut(
  system: ZoneSystemContext,
  x: number,
  y: number,
  pop: number,
  value: number,
  options: ZoneHandlerOptions = {},
): void {
  if (pop > 1) {
    indPlop(system, x, y, pop - 2, value, options);
    incROG(system, x, y, -8);
    return;
  }
  if (pop === 1) {
    zonePlop(system, x, y, INDCLR - 4, options);
    incROG(system, x, y, -8);
  }
}

export function rzPop(tileId: number): number {
  const czDen = div(tileId - RZB, 9) % 4;
  return czDen * 8 + 16;
}

export function czPop(tileId: number): number {
  if (tileId === COMCLR) {
    return 0;
  }
  const czDen = (div(tileId - CZB, 9) % 5) + 1;
  return czDen;
}

export function izPop(tileId: number): number {
  if (tileId === INDCLR) {
    return 0;
  }
  const czDen = (div(tileId - IZB, 9) % 4) + 1;
  return czDen;
}

export function buildHouse(system: ZoneSystemContext, x: number, y: number, value: number): void {
  const zeX = [0, -1, 0, 1, -1, 1, -1, 0, 1];
  const zeY = [0, -1, -1, -1, 0, 0, 1, 1, 1];
  let bestLoc = 0;
  let hscore = 0;
  for (let z = 1; z < 9; z += 1) {
    const xx = x + zeX[z]!;
    const yy = y + zeY[z]!;
    if (!isInBounds(xx, yy)) {
      continue;
    }
    const score = evalLot(system, xx, yy);
    if (score !== 0) {
      if (score > hscore) {
        hscore = score;
        bestLoc = z;
      }
      if (score === hscore && (system.rng.next16() & 7) === 0) {
        bestLoc = z;
      }
    }
  }
  if (bestLoc) {
    const xx = x + zeX[bestLoc]!;
    const yy = y + zeY[bestLoc]!;
    if (isInBounds(xx, yy)) {
      const tile = HOUSE + BLBNCNBIT + system.rng.rand(2) + value * 3;
      system.store.write('map', indexFor(xx, yy), tile);
    }
  }
}

export function resPlop(
  system: ZoneSystemContext,
  x: number,
  y: number,
  den: number,
  value: number,
  options: ZoneHandlerOptions = {},
): void {
  const base = (value * 4 + den) * 9 + RZB - 4;
  zonePlop(system, x, y, base, options);
}

export function comPlop(
  system: ZoneSystemContext,
  x: number,
  y: number,
  den: number,
  value: number,
  options: ZoneHandlerOptions = {},
): void {
  const base = (value * 5 + den) * 9 + CZB - 4;
  zonePlop(system, x, y, base, options);
}

export function indPlop(
  system: ZoneSystemContext,
  x: number,
  y: number,
  den: number,
  value: number,
  options: ZoneHandlerOptions = {},
): void {
  const base = (value * 4 + den) * 9 + (IZB - 4);
  zonePlop(system, x, y, base, options);
}

export function evalLot(system: ZoneSystemContext, x: number, y: number): number {
  const index = indexFor(x, y);
  const tileId = (system.map[index] ?? 0) & LOMASK;
  if (tileId && (tileId < RESBASE || tileId > RESBASE + 8)) {
    return -1;
  }
  let score = 1;
  const dx = [0, 1, 0, -1] as const;
  const dy = [-1, 0, 1, 0] as const;
  for (let z = 0; z < 4; z += 1) {
    const xx = x + dx[z]!;
    const yy = y + dy[z]!;
    if (!isInBounds(xx, yy)) {
      continue;
    }
    const neighbor = system.map[indexFor(xx, yy)] ?? 0;
    if (neighbor && (neighbor & LOMASK) <= LASTROAD) {
      score += 1;
    }
  }
  return score;
}

export function zonePlop(
  system: ZoneSystemContext,
  x: number,
  y: number,
  base: number,
  _options: ZoneHandlerOptions = {},
): boolean {
  const { map, store, power } = system;
  const zx = [-1, 0, 1, -1, 0, 1, -1, 0, 1] as const;
  const zy = [-1, -1, -1, 0, 0, 0, 1, 1, 1] as const;

  for (let z = 0; z < 9; z += 1) {
    const xx = x + zx[z]!;
    const yy = y + zy[z]!;
    if (!isInBounds(xx, yy)) {
      continue;
    }
    const tileId = (map[indexFor(xx, yy)] ?? 0) & LOMASK;
    if (tileId >= Tile.FLOOD && tileId < ROADBASE) {
      return false;
    }
  }

  let nextBase = base;
  for (let z = 0; z < 9; z += 1) {
    const xx = x + zx[z]!;
    const yy = y + zy[z]!;
    if (isInBounds(xx, yy)) {
      store.write('map', indexFor(xx, yy), nextBase + BNCNBIT);
    }
    nextBase += 1;
  }

  const centerIndex = indexFor(x, y);
  const centerTile = map[centerIndex] ?? 0;
  setZPowerAt(store, power, x, y, centerIndex, centerTile);
  const updated = map[centerIndex] ?? centerTile;
  store.write('map', centerIndex, updated | ZONEBIT | BULLBIT);
  return true;
}

export function evalRes(system: ZoneSystemContext, x: number, y: number, traf: number): number {
  if (traf < 0) {
    return -3000;
  }
  const index = (x >> 1) * HWLDY + (y >> 1);
  let value = (system.landValueMem[index] ?? 0) - (system.pollutionMem[index] ?? 0);
  if (value < 0) {
    value = 0;
  } else {
    value = value << 5;
  }
  if (value > 6000) {
    value = 6000;
  }
  return value - 3000;
}

export function evalCom(system: ZoneSystemContext, x: number, y: number, traf: number): number {
  if (traf < 0) {
    return -3000;
  }
  const index = (x >> 3) * SmY + (y >> 3);
  return system.comRate[index] ?? 0;
}

export function evalInd(traf: number): number {
  if (traf < 0) {
    return -1000;
  }
  return 0;
}

export function doFreePop(system: ZoneSystemContext, x: number, y: number): number {
  let count = 0;
  for (let xx = x - 1; xx <= x + 1; xx += 1) {
    for (let yy = y - 1; yy <= y + 1; yy += 1) {
      if (!isInBounds(xx, yy)) {
        continue;
      }
      const tileId = (system.map[indexFor(xx, yy)] ?? 0) & LOMASK;
      if (tileId >= LHTHR && tileId <= HHTHR) {
        count += 1;
      }
    }
  }
  return count;
}

export function setSmoke(
  system: ZoneSystemContext,
  x: number,
  y: number,
  tileId: number,
  powered: boolean,
): void {
  if (tileId < IZB) {
    return;
  }
  let z = (tileId - IZB) >> 3;
  z = z & 7;
  if (!ANI_THIS[z]) {
    return;
  }
  const dx = DX1[z];
  const dy = DY1[z];
  assertDefined(dx);
  assertDefined(dy);
  const xx = x + dx;
  const yy = y + dy;
  if (!isInBounds(xx, yy)) {
    return;
  }
  const index = indexFor(xx, yy);
  const currentId = (system.map[index] ?? 0) & LOMASK;
  if (powered) {
    const animC = ANI_TAB_C[z];
    assertDefined(animC);
    const animA = ANI_TAB_A[z];
    const animB = ANI_TAB_B[z];
    assertDefined(animA);
    assertDefined(animB);
    if (currentId === animC) {
      system.store.write('map', index, (SMOKEBASE + animA) | ANIMBIT | CONDBIT | BURNBIT);
      system.store.write('map', index, (SMOKEBASE + animB) | ANIMBIT | CONDBIT | BURNBIT);
    }
  } else {
    const animC = ANI_TAB_C[z];
    const animD = ANI_TAB_D[z];
    assertDefined(animC);
    assertDefined(animD);
    if (currentId > animC) {
      system.store.write('map', index, animC | CONDBIT | BURNBIT);
      system.store.write('map', index, animD | CONDBIT | BURNBIT);
    }
  }
}

export function drawStadium(system: ZoneSystemContext, x: number, y: number, tileId: number): void {
  const { store } = system;
  let z = tileId - 5;
  for (let yy = y - 1; yy < y + 3; yy += 1) {
    for (let xx = x - 1; xx < x + 3; xx += 1) {
      if (isInBounds(xx, yy)) {
        store.write('map', indexFor(xx, yy), z | BNCNBIT);
      }
      z += 1;
    }
  }
  if (isInBounds(x, y)) {
    const index = indexFor(x, y);
    const current = system.map[index] ?? 0;
    store.write('map', index, current | ZONEBIT | PWRBIT);
  }
}

export function doAirport(system: ZoneSystemContext): void {
  if (system.rng.rand(5) === 0) {
    system.context.hooks.generatePlane();
    return;
  }
  if (system.rng.rand(12) === 0) {
    system.context.hooks.generateCopter();
  }
}

export function coalSmoke(system: ZoneSystemContext, x: number, y: number): void {
  const { store } = system;
  for (let z = 0; z < 4; z += 1) {
    const xx = x + COAL_SMOKE_DX[z]!;
    const yy = y + COAL_SMOKE_DY[z]!;
    if (!isInBounds(xx, yy)) {
      continue;
    }
    store.write('map', indexFor(xx, yy), COAL_SMOKE[z]! | ANIMBIT | CONDBIT | PWRBIT | BURNBIT);
  }
}

export function doMeltdown(system: ZoneSystemContext, x: number, y: number): void {
  const { state, rng, store } = system;
  state.MeltX = x;
  state.MeltY = y;

  system.context.hooks.makeExplosion(x - 1, y - 1);
  system.context.hooks.makeExplosion(x - 1, y + 2);
  system.context.hooks.makeExplosion(x + 2, y - 1);
  system.context.hooks.makeExplosion(x + 2, y + 2);

  for (let xx = x - 1; xx < x + 3; xx += 1) {
    for (let yy = y - 1; yy < y + 3; yy += 1) {
      if (!isInBounds(xx, yy)) {
        continue;
      }
      store.write('map', indexFor(xx, yy), Tile.FIRE + (rng.next16() & 3) + ANIMBIT);
    }
  }

  for (let z = 0; z < 200; z += 1) {
    const xx = x - 20 + rng.rand(40);
    const yy = y - 15 + rng.rand(30);
    if (!isInBounds(xx, yy)) {
      continue;
    }
    const index = indexFor(xx, yy);
    const tile = system.map[index] ?? 0;
    if ((tile & ZONEBIT) !== 0) {
      continue;
    }
    if ((tile & BURNBIT) !== 0 || tile === 0) {
      store.write('map', index, Tile.RADTILE);
    }
  }

  system.context.hooks.sendMesAt(-43, x, y);
}

export function roadTest(tile: number): boolean {
  const tileId = tile & LOMASK;
  if (tileId < ROADBASE) {
    return false;
  }
  if (tileId > LASTRAIL) {
    return false;
  }
  if (tileId >= POWERBASE && tileId < RAILHPOWERV) {
    return false;
  }
  return true;
}

export function findPerimeterRoad(system: ZoneSystemContext, x: number, y: number): boolean {
  const { map } = system;
  for (let z = 0; z < 12; z += 1) {
    const tx = x + PERIM_X[z]!;
    const ty = y + PERIM_Y[z]!;
    if (!isInBounds(tx, ty)) {
      continue;
    }
    if (roadTest(map[indexFor(tx, ty)] ?? 0)) {
      return true;
    }
  }
  return false;
}

export function makeTraf(
  system: ZoneSystemContext,
  x: number,
  y: number,
  zoneType: number,
  options: ZoneHandlerOptions = {},
): number {
  if (options.makeTraf) {
    return options.makeTraf(zoneType, system, x, y);
  }
  const findRoad = options.findPerimeterRoad ?? findPerimeterRoad;
  return findRoad(system, x, y) ? 1 : -1;
}

export function decROGMem(state: SimState, context: SimContext): void {
  const store = context.store;
  const rateOGMem = store.getLayer('rateOGMem') as Int16Array;
  for (let x = 0; x < SmX; x += 1) {
    for (let y = 0; y < SmY; y += 1) {
      const index = x * SmY + y;
      const z = rateOGMem[index] ?? 0;
      if (z === 0) {
        continue;
      }
      if (z > 0) {
        let next = z - 1;
        if (z > 200) {
          next = 200;
        }
        store.write('rateOGMem', index, next);
        continue;
      }
      if (z < 0) {
        let next = z + 1;
        if (z < -200) {
          next = -200;
        }
        store.write('rateOGMem', index, next);
      }
    }
  }
}
