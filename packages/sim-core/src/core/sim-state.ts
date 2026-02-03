import { CITY_HISTORY_LENGTH, CITY_MISC_LENGTH } from '../io/cty.ts';
import { PowerMap } from './constants.ts';
import { MAP_FLAG_COUNT } from './map-flags.ts';

export const PROBLEM_COUNT = 10;
export const PROBLEM_ORDER_COUNT = 4;

export interface SimState {
  // Time + speed
  CityTime: number;
  StartingYear: number;
  SimSpeed: number;
  SimMetaSpeed: number;
  Fcycle: number;
  Scycle: number;
  Spdcycle: number;
  LastCityTime: number;
  LastCityYear: number;
  LastCityMonth: number;
  LastFunds: number;

  // Economy + budget
  TotalFunds: number;
  CityTax: number;
  GameLevel: number;
  AvCityTax: number;
  CashFlow: number;
  TaxFund: number;
  RoadFund: number;
  PoliceFund: number;
  FireFund: number;
  RoadSpend: number;
  PoliceSpend: number;
  FireSpend: number;
  RoadEffect: number;
  PoliceEffect: number;
  FireEffect: number;
  roadPercent: number;
  policePercent: number;
  firePercent: number;
  autoBudget: boolean;
  autoBulldoze: boolean;

  // Population + census
  ResPop: number;
  ComPop: number;
  IndPop: number;
  TotalPop: number;
  LastTotalPop: number;
  ResZPop: number;
  ComZPop: number;
  IndZPop: number;
  TotalZPop: number;
  HospPop: number;
  ChurchPop: number;
  StadiumPop: number;
  PolicePop: number;
  FireStPop: number;
  CoalPop: number;
  NuclearPop: number;
  PortPop: number;
  APortPop: number;
  NeedHosp: number;
  NeedChurch: number;

  // Infrastructure counts
  RoadTotal: number;
  RailTotal: number;
  FirePop: number;

  // Demand valves
  RValve: number;
  CValve: number;
  IValve: number;
  ResCap: number;
  ComCap: number;
  IndCap: number;
  ValveFlag: number;
  EMarket: number;

  // Evaluation + scoring
  CityScore: number;
  deltaCityScore: number;
  OldCityScore: number;
  CityClass: number;
  CityPop: number;
  deltaCityPop: number;
  OldCityPop: number;
  CityAssValue: number;
  CityYes: number;
  CityNo: number;
  ProblemTable: Int16Array;
  ProblemVotes: Int16Array;
  ProblemOrder: Int16Array;

  // Environment
  LVAverage: number;
  CrimeAverage: number;
  PolluteAverage: number;
  TrafficAverage: number;
  CrimeRamp: number;
  PolluteRamp: number;

  // Power + traffic maxima
  TrafMaxX: number;
  TrafMaxY: number;
  PolMaxX: number;
  PolMaxY: number;
  PwrdZCnt: number;
  unPwrdZCnt: number;
  PowerStackNum: number;
  PowerStackX: Uint8Array;
  PowerStackY: Uint8Array;

  // Map scan scratch
  CChr9: number;

  // Disasters + scenarios
  NoDisasters: boolean;
  DisasterEvent: number;
  DisasterWait: number;
  FloodCnt: number;
  FloodX: number;
  FloodY: number;
  MeltX: number;
  MeltY: number;
  CrashX: number;
  CrashY: number;
  ScenarioID: number;
  ScoreType: number;
  ScoreWait: number;

  // City center
  CCx: number;
  CCy: number;
  CCx2: number;
  CCy2: number;

  // Histories
  ResHis: Int16Array;
  ComHis: Int16Array;
  IndHis: Int16Array;
  CrimeHis: Int16Array;
  PollutionHis: Int16Array;
  MoneyHis: Int16Array;
  MiscHis: Int16Array;

  // Flags / init state
  NewMap: number;
  NewMapFlags: Uint8Array;
  NewGraph: number;
  NewPower: number;
  DoInitialEval: number;
  InitSimLoad: number;
  TaxFlag: number;
  MustUpdateOptions: number;
}

export function createSimState(): SimState {
  return {
    // Time + speed
    CityTime: 50,
    StartingYear: 1900,
    SimSpeed: 3,
    SimMetaSpeed: 0,
    Fcycle: 0,
    Scycle: 0,
    Spdcycle: 0,
    LastCityTime: -1,
    LastCityYear: -1,
    LastCityMonth: -1,
    LastFunds: -1,

    // Economy + budget
    TotalFunds: 0,
    CityTax: 7,
    GameLevel: 0,
    AvCityTax: 0,
    CashFlow: 0,
    TaxFund: 0,
    RoadFund: 0,
    PoliceFund: 0,
    FireFund: 0,
    RoadSpend: 0,
    PoliceSpend: 0,
    FireSpend: 0,
    RoadEffect: 32,
    PoliceEffect: 1000,
    FireEffect: 1000,
    roadPercent: 1,
    policePercent: 1,
    firePercent: 1,
    autoBudget: true,
    autoBulldoze: true,

    // Population + census
    ResPop: 0,
    ComPop: 0,
    IndPop: 0,
    TotalPop: 0,
    LastTotalPop: 0,
    ResZPop: 0,
    ComZPop: 0,
    IndZPop: 0,
    TotalZPop: 0,
    HospPop: 0,
    ChurchPop: 0,
    StadiumPop: 0,
    PolicePop: 0,
    FireStPop: 0,
    CoalPop: 0,
    NuclearPop: 0,
    PortPop: 0,
    APortPop: 0,
    NeedHosp: 0,
    NeedChurch: 0,

    // Infrastructure counts
    RoadTotal: 0,
    RailTotal: 0,
    FirePop: 0,

    // Demand valves
    RValve: 0,
    CValve: 0,
    IValve: 0,
    ResCap: 0,
    ComCap: 0,
    IndCap: 0,
    ValveFlag: 1,
    EMarket: 6,

    // Evaluation + scoring
    CityScore: 500,
    deltaCityScore: 0,
    OldCityScore: 0,
    CityClass: 0,
    CityPop: -1,
    deltaCityPop: 0,
    OldCityPop: 0,
    CityAssValue: 0,
    CityYes: 0,
    CityNo: 0,
    ProblemTable: new Int16Array(PROBLEM_COUNT),
    ProblemVotes: new Int16Array(PROBLEM_COUNT),
    ProblemOrder: new Int16Array(PROBLEM_ORDER_COUNT),

    // Environment
    LVAverage: 0,
    CrimeAverage: 0,
    PolluteAverage: 0,
    TrafficAverage: 0,
    CrimeRamp: 0,
    PolluteRamp: 0,

    // Power + traffic maxima
    TrafMaxX: 0,
    TrafMaxY: 0,
    PolMaxX: 0,
    PolMaxY: 0,
    PwrdZCnt: 0,
    unPwrdZCnt: 0,
    PowerStackNum: 0,
    PowerStackX: new Uint8Array(PowerMap.PWRSTKSIZE),
    PowerStackY: new Uint8Array(PowerMap.PWRSTKSIZE),

    CChr9: 0,

    // Disasters + scenarios
    NoDisasters: false,
    DisasterEvent: 0,
    DisasterWait: 0,
    FloodCnt: 0,
    FloodX: 0,
    FloodY: 0,
    MeltX: 0,
    MeltY: 0,
    CrashX: 0,
    CrashY: 0,
    ScenarioID: 0,
    ScoreType: 0,
    ScoreWait: 0,

    // City center
    CCx: 0,
    CCy: 0,
    CCx2: 0,
    CCy2: 0,

    // Histories
    ResHis: new Int16Array(CITY_HISTORY_LENGTH),
    ComHis: new Int16Array(CITY_HISTORY_LENGTH),
    IndHis: new Int16Array(CITY_HISTORY_LENGTH),
    CrimeHis: new Int16Array(CITY_HISTORY_LENGTH),
    PollutionHis: new Int16Array(CITY_HISTORY_LENGTH),
    MoneyHis: new Int16Array(CITY_HISTORY_LENGTH),
    MiscHis: new Int16Array(CITY_MISC_LENGTH),

    // Flags / init state
    NewMap: 0,
    NewMapFlags: new Uint8Array(MAP_FLAG_COUNT),
    NewGraph: 0,
    NewPower: 0,
    DoInitialEval: 0,
    InitSimLoad: 2,
    TaxFlag: 0,
    MustUpdateOptions: 0,
  };
}
