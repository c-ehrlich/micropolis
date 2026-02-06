/*
 * Headless Micropolis core oracle.
 *
 * This binary keeps deterministic, non-UI simulation state in a filesystem
 * state directory with JSON metadata + binary array sidecars.
 *
 * Primary references:
 * - ref/micropolis/src/sim/s_traf.c (compiled directly)
 * - ref/micropolis/src/sim/s_sim.c (Simulate/DecTrafficMem/DecROGMem logic)
 * - ref/micropolis/src/sim/s_power.c (DoPowerScan/MoveMapSim/PowerStack)
 * - ref/micropolis/src/sim/s_scan.c (PTL/Crime/PopDensity/Fire scan systems)
 * - ref/micropolis/src/sim/s_sim.c + ref/micropolis/src/sim/rand.c (RNG)
 */

#include "sim.h"

#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SNAPSHOT_VERSION 2
#define MAP_FILE "map.u16le"
#define TRF_FILE "trf-density.u8"
#define ROG_FILE "rate-og-mem.i16le"
#define POWER_FILE "power.u16le"
#define POWER_STACK_X_FILE "power-stack-x.u8"
#define POWER_STACK_Y_FILE "power-stack-y.u8"
#define POP_DENSITY_FILE "pop-density.u8"
#define POLLUTION_FILE "pollution-mem.u8"
#define LAND_VALUE_FILE "land-value-mem.u8"
#define CRIME_FILE "crime-mem.u8"
#define TERRAIN_FILE "terrain-mem.u8"
#define FIRE_ST_FILE "fire-st-map.i16le"
#define POLICE_FILE "police-map.i16le"
#define POLICE_EFFECT_FILE "police-map-effect.i16le"
#define FIRE_RATE_FILE "fire-rate.i16le"
#define COM_RATE_FILE "com-rate.i16le"
#define SNAPSHOT_FILE "snapshot.json"

#define MAP_WORD_COUNT (WORLD_X * WORLD_Y)
#define TRF_BYTE_COUNT (HWLDX * HWLDY)
#define ROG_WORD_COUNT (SmX * SmY)
#define POWER_WORD_COUNT PWRMAPSIZE
#define POWER_STACK_BYTE_COUNT PWRSTKSIZE
#define HALF_BYTE_COUNT (HWLDX * HWLDY)
#define QUARTER_BYTE_COUNT (QWX * QWY)
#define SMALL_WORD_COUNT (SmX * SmY)

/* --- Reference-sim globals required by core parity commands. --- */

static uint16_t gMapStorage[WORLD_X][WORLD_Y];
static Byte gTrfStorage[HWLDX][HWLDY];
static Byte gPopDensityStorage[HWLDX][HWLDY];
static Byte gPollutionStorage[HWLDX][HWLDY];
static Byte gLandValueStorage[HWLDX][HWLDY];
static Byte gCrimeStorage[HWLDX][HWLDY];
static Byte gTemStorage[HWLDX][HWLDY];
static Byte gTem2Storage[HWLDX][HWLDY];
static Byte gTerrainStorage[QWX][QWY];
static Byte gQtemStorage[QWX][QWY];
short RateOGMem[SmX][SmY];
short FireStMap[SmX][SmY];
short PoliceMap[SmX][SmY];
short PoliceMapEffect[SmX][SmY];
short ComRate[SmX][SmY];
short FireRate[SmX][SmY];
short STem[SmX][SmY];
short PowerMap[POWERMAPLEN];

short *Map[WORLD_X];
Byte *PopDensity[HWLDX];
Byte *TrfDensity[HWLDX];
Byte *PollutionMem[HWLDX];
Byte *LandValueMem[HWLDX];
Byte *CrimeMem[HWLDX];
Byte *tem[HWLDX];
Byte *tem2[HWLDX];
Byte *TerrainMem[QWX];
Byte *Qtem[QWX];

short SMapX;
short SMapY;
short CChr;
short CChr9;

short SimSpeed;
short GameLevel;
short TaxFlag;
short CityTax;
short AvCityTax;
short Scycle;
short Fcycle;
short DoInitialEval;
short NewPower;
short NewMap;
short MustUpdateOptions;
short NewMapFlags[NMAPS];
QUAD CityTime;
short StartingYear;
QUAD LastCityTime;
QUAD LastCityYear;
QUAD LastCityMonth;
QUAD LastFunds;
QUAD LastMesTime;
short LastPicNum;
short MessagePort;
short MesX;
short MesY;
short MesNum;
short autoGo;
short UserSoundOn;
short DoAnimation;
short DoMessages;
short DoNotices;
short ScenarioID;
short ScoreType;
short ScoreWait;
QUAD LastCityPop;
short LastCategory;
short CityClass;
short CityScore;
short TrafficAverage;
short CrimeAverage;
short PolluteAverage;
short ResPop;
short ComPop;
short IndPop;
short TotalPop;
short ResZPop;
short ComZPop;
short IndZPop;
short TotalZPop;
short StadiumPop;
short PortPop;
short APortPop;
short ResCap;
short ComCap;
short IndCap;
QUAD TotalFunds;
QUAD TaxFund;
QUAD RoadFund;
QUAD PoliceFund;
QUAD FireFund;
QUAD CashFlow;
QUAD RoadSpend;
QUAD PoliceSpend;
QUAD FireSpend;
short RoadTotal;
short RailTotal;
short RoadEffect;
short PoliceEffect;
short FireEffect;
short PolicePop;
short FireStPop;
short LVAverage;
float roadPercent;
float policePercent;
float firePercent;
short autoBudget;
short autoBulldoze;
short NoDisasters;
short DisasterEvent;
short DisasterWait;
short FloodCnt;
short FloodX;
short FloodY;
short CrashX;
short CrashY;
short CCx;
short CCy;
short CoalPop;
short NuclearPop;
short PwrdZCnt;
short unPwrdZCnt;

/* s_traf.c defines these globals. */
extern short TrafMaxX;
extern short TrafMaxY;

static SimSprite gCopSprite;
static QUAD gTickNow;
static short gDidLoseGame;
static short gDidWinGame;
static short gDidEarthquake;

/* --- Deterministic RNG (`rand.c` + `s_sim.c`) --- */

#define SIM_RAND_MAX 0xffffu
#define RANDOM_RANGE 0xffff
static uint32_t gRandNext = 1;

static int sim_rand(void)
{
  gRandNext = gRandNext * 1103515245u + 12345u;
  return (int)(((gRandNext % (((SIM_RAND_MAX + 1u) << 8u))) >> 8u) & 0xffffu);
}

static void sim_srand(uint32_t seed) { gRandNext = seed; }

int Rand16(void) { return sim_rand(); }

int Rand(int range)
{
  int maxMultiple;
  int rnum;

  range++;
  maxMultiple = RANDOM_RANGE / range;
  maxMultiple *= range;
  while ((rnum = Rand16()) >= maxMultiple)
    continue;
  return (rnum % range);
}

static void SeedRand(int seed) { sim_srand((uint32_t)seed); }

/* --- No-op UI/system hooks that do not affect deterministic oracle state. --- */

void CityEvaluation(void) {}
void SetValves(void) {}
void TakeCensus(void) {}
void Take2Census(void) {}
void makeDollarDecimalStr(char *numStr, char *dollarStr)
{
  if ((numStr == NULL) || (dollarStr == NULL)) {
    return;
  }
  snprintf(dollarStr, 256u, "$%s", numStr);
}

void ShowBudgetWindowAndStartWaiting(void) {}
void drawBudgetWindow(void) {}
void drawCurrPercents(void) {}
void MakeTornado(void) {}
void MakeMonster(void) {}
void DropFireBombs(void) {}
void DoEarthQuake(void) { gDidEarthquake = 1; }
void DoMeltdown(short x, short y)
{
  (void)x;
  (void)y;
}

void DoLoseGame(void) { gDidLoseGame = 1; }
void DoWinGame(void) { gDidWinGame = 1; }

QUAD TickCount(void) { return gTickNow; }

void UpdateFunds(void)
{
  /* Mirrors w_stubs.c UpdateFunds side effect needed by budget parity. */
}

void SetFunds(int dollars)
{
  TotalFunds = dollars;
  UpdateFunds();
}

void Spend(int dollars) { SetFunds((int)(TotalFunds - dollars)); }

/*
 * Population helpers required by `GetPDen` in `ref/micropolis/src/sim/s_scan.c`.
 *
 * These mirror the corresponding routines in `ref/micropolis/src/sim/s_zone.c`.
 */
int RZPop(int ch9)
{
  short czDen;

  czDen = (((ch9 - RZB) / 9) % 4);
  return ((czDen * 8) + 16);
}

int CZPop(int ch9)
{
  short czDen;

  if (ch9 == COMCLR)
    return 0;
  czDen = (((ch9 - CZB) / 9) % 5) + 1;
  return czDen;
}

int IZPop(int ch9)
{
  short czDen;

  if (ch9 == INDCLR)
    return 0;
  czDen = (((ch9 - IZB) / 9) % 4) + 1;
  return czDen;
}

int DoFreePop(int ch9)
{
  short count;
  short loc;
  short x;
  short y;

  (void)ch9;
  count = 0;
  for (x = SMapX - 1; x <= SMapX + 1; x++) {
    for (y = SMapY - 1; y <= SMapY + 1; y++) {
      if ((x >= 0) && (x < WORLD_X) && (y >= 0) && (y < WORLD_Y)) {
        loc = Map[x][y] & LOMASK;
        if ((loc >= LHTHR) && (loc <= HHTHR)) {
          count++;
        }
      }
    }
  }
  return count;
}

SimSprite *GetSprite(int type)
{
  if (type == COP) {
    return &gCopSprite;
  }
  return NULL;
}

/*
 * Set `PWRBIT` on the current `Map[SMapX][SMapY]` tile.
 *
 * Mirrors `SetZPower` in `ref/micropolis/src/sim/s_zone.c` (power-only subset):
 * - `NUCLEAR` / `POWERPLANT` are always powered.
 * - Other conductive tiles depend on `PowerMap`.
 */
static short SetZPower(void)
{
  QUAD powerWord;

  if ((CChr9 == NUCLEAR) || (CChr9 == POWERPLANT) ||
      ((powerWord = POWERWORD(SMapX, SMapY)),
       ((powerWord < PWRMAPSIZE) && (PowerMap[powerWord] & (1 << (SMapX & 15)))))) {
    Map[SMapX][SMapY] = CChr | PWRBIT;
    return 1;
  }

  Map[SMapX][SMapY] = CChr & (~PWRBIT);
  return 0;
}

/*
 * Zone power/counter behavior required by phase-level power parity.
 *
 * Mirrors the `DoZone` + power-plant subset in:
 * - `ref/micropolis/src/sim/s_zone.c`
 */
static void DoZoneLite(void)
{
  short zonePwrFlg;

  zonePwrFlg = SetZPower();
  if (zonePwrFlg) {
    PwrdZCnt++;
  } else {
    unPwrdZCnt++;
  }

  if (CChr9 == POWERPLANT) {
    CoalPop++;
    PushPowerStack();
    return;
  }
  if (CChr9 == NUCLEAR) {
    NuclearPop++;
    PushPowerStack();
  }
}

/*
 * Minimal `MapScan` behavior for power+zone interaction parity.
 *
 * Mirrors `MapScan` in `ref/micropolis/src/sim/s_sim.c` for:
 * - `CChr/CChr9` tracking
 * - `NewPower` conductive updates (`SetZPower`)
 * - zone power counters (`DoZone` path)
 */
void MapScan(int x1, int x2)
{
  short x;
  short y;

  for (x = x1; x < x2; x++) {
    for (y = 0; y < WORLD_Y; y++) {
      if ((CChr = Map[x][y]) != 0) {
        CChr9 = CChr & LOMASK;
        if (CChr9 >= FLOOD) {
          SMapX = x;
          SMapY = y;

          if (NewPower && (CChr & CONDBIT)) {
            SetZPower();
          }

          if (CChr & ZONEBIT) {
            DoZoneLite();
            continue;
          }

          if ((CChr9 >= SOMETINYEXP) && (CChr9 <= LASTTINYEXP)) {
            Map[x][y] = RUBBLE + (Rand16() & 3) + BULLBIT;
          }
        }
      }
    }
  }
}

/*
 * Per-tick census reset required for phase progression parity.
 *
 * Mirrors `ClearCensus` in `ref/micropolis/src/sim/s_sim.c` (power subset).
 */
void ClearCensus(void)
{
  short z;

  z = 0;
  PwrdZCnt = z;
  unPwrdZCnt = z;
  CoalPop = z;
  NuclearPop = z;
  PowerStackNum = z;
}

/* `DecTrafficMem` from ref/micropolis/src/sim/s_sim.c. */
void DecTrafficMem(void)
{
  short x;
  short y;
  short z;

  for (x = 0; x < HWLDX; x++)
    for (y = 0; y < HWLDY; y++)
      if ((z = TrfDensity[x][y]) != 0) {
        if (z > 24) {
          if (z > 200)
            TrfDensity[x][y] = (Byte)(z - 34);
          else
            TrfDensity[x][y] = (Byte)(z - 24);
        } else
          TrfDensity[x][y] = 0;
      }
}

/* `DecROGMem` from ref/micropolis/src/sim/s_sim.c. */
void DecROGMem(void)
{
  short x;
  short y;
  short z;

  for (x = 0; x < SmX; x++)
    for (y = 0; y < SmY; y++) {
      z = RateOGMem[x][y];
      if (z == 0)
        continue;
      if (z > 0) {
        --RateOGMem[x][y];
        if (z > 200)
          RateOGMem[x][y] = 200;
        continue;
      }
      if (z < 0) {
        ++RateOGMem[x][y];
        if (z < -200)
          RateOGMem[x][y] = -200;
      }
    }
}

/* `Simulate` phase dispatcher from ref/micropolis/src/sim/s_sim.c. */
void Simulate(int mod16)
{
  static short SpdPwr[4] = {1, 2, 4, 5};
  static short SpdPtl[4] = {1, 2, 7, 17};
  static short SpdCri[4] = {1, 1, 8, 18};
  static short SpdPop[4] = {1, 1, 9, 19};
  static short SpdFir[4] = {1, 1, 10, 20};
  short x;

  x = SimSpeed;
  if (x > 3)
    x = 3;

  switch (mod16) {
  case 0:
    if (++Scycle > 1023)
      Scycle = 0;
    if (DoInitialEval) {
      DoInitialEval = 0;
      CityEvaluation();
    }
    CityTime++;
    AvCityTax += CityTax;
    if (!(Scycle & 1))
      SetValves();
    ClearCensus();
    break;
  case 1:
    MapScan(0, 1 * WORLD_X / 8);
    break;
  case 2:
    MapScan(1 * WORLD_X / 8, 2 * WORLD_X / 8);
    break;
  case 3:
    MapScan(2 * WORLD_X / 8, 3 * WORLD_X / 8);
    break;
  case 4:
    MapScan(3 * WORLD_X / 8, 4 * WORLD_X / 8);
    break;
  case 5:
    MapScan(4 * WORLD_X / 8, 5 * WORLD_X / 8);
    break;
  case 6:
    MapScan(5 * WORLD_X / 8, 6 * WORLD_X / 8);
    break;
  case 7:
    MapScan(6 * WORLD_X / 8, 7 * WORLD_X / 8);
    break;
  case 8:
    MapScan(7 * WORLD_X / 8, WORLD_X);
    break;
  case 9:
    if (!(CityTime % CENSUSRATE))
      TakeCensus();
    if (!(CityTime % (CENSUSRATE * 12)))
      Take2Census();

    if (!(CityTime % TAXFREQ)) {
      CollectTax();
      CityEvaluation();
    }
    break;
  case 10:
    if (!(Scycle % 5))
      DecROGMem();
    DecTrafficMem();
    NewMapFlags[TDMAP] = 1;
    NewMapFlags[RDMAP] = 1;
    NewMapFlags[ALMAP] = 1;
    NewMapFlags[REMAP] = 1;
    NewMapFlags[COMAP] = 1;
    NewMapFlags[INMAP] = 1;
    NewMapFlags[DYMAP] = 1;
    SendMessages();
    break;
  case 11:
    if (!(Scycle % SpdPwr[x])) {
      DoPowerScan();
      NewMapFlags[PRMAP] = 1;
      NewPower = 1;
    }
    break;
  case 12:
    if (!(Scycle % SpdPtl[x]))
      PTLScan();
    break;
  case 13:
    if (!(Scycle % SpdCri[x]))
      CrimeScan();
    break;
  case 14:
    if (!(Scycle % SpdPop[x]))
      PopDenScan();
    break;
  case 15:
    if (!(Scycle % SpdFir[x]))
      FireAnalysis();
    DoDisasters();
    break;
  }
}

/* --- Phase 4 systems: messages, heads/date, budget, and disasters. --- */

void ClearMes(void)
{
  MessagePort = 0;
  MesX = 0;
  MesY = 0;
  LastPicNum = 0;
}

void SendMes(int Mnum)
{
  if (Mnum < 0) {
    if (Mnum != LastPicNum) {
      MessagePort = (short)Mnum;
      MesX = 0;
      MesY = 0;
      LastPicNum = (short)Mnum;
      return;
    }
  } else if (!MessagePort) {
    MessagePort = (short)Mnum;
    MesX = 0;
    MesY = 0;
  }
}

void SendMesAt(short Mnum, short x, short y)
{
  short beforePort;
  beforePort = MessagePort;
  SendMes(Mnum);
  if (MessagePort != beforePort) {
    MesX = x;
    MesY = y;
  }
}

static void DoScenarioScore(int type)
{
  short z;

  z = -200;
  switch (type) {
  case 1:
  case 2:
  case 3:
    if (CityClass >= 4)
      z = -100;
    break;
  case 4:
    if (TrafficAverage < 80)
      z = -100;
    break;
  case 5:
    if (CityScore > 500)
      z = -100;
    break;
  case 6:
    if (CrimeAverage < 60)
      z = -100;
    break;
  case 7:
  case 8:
    if (CityScore > 500)
      z = -100;
    break;
  default:
    break;
  }

  ClearMes();
  SendMes(z);

  if (z == -200) {
    DoLoseGame();
  }
}

static void CheckGrowth(void)
{
  QUAD thisCityPop;
  short z;

  if (CityTime & 3) {
    return;
  }

  z = 0;
  thisCityPop = ((ResPop) + (ComPop * 8L) + (IndPop * 8L)) * 20L;
  if (LastCityPop) {
    if ((LastCityPop < 2000) && (thisCityPop >= 2000))
      z = 35;
    if ((LastCityPop < 10000) && (thisCityPop >= 10000))
      z = 36;
    if ((LastCityPop < 50000L) && (thisCityPop >= 50000L))
      z = 37;
    if ((LastCityPop < 100000L) && (thisCityPop >= 100000L))
      z = 38;
    if ((LastCityPop < 500000L) && (thisCityPop >= 500000L))
      z = 39;
  }

  if (z && (z != LastCategory)) {
    SendMes(-z);
    LastCategory = z;
  }
  LastCityPop = thisCityPop;
}

void SendMessages(void)
{
  short z;
  short powerPop;
  double TM;

  if ((ScenarioID) && (ScoreType) && (ScoreWait)) {
    ScoreWait--;
    if (!ScoreWait) {
      DoScenarioScore(ScoreType);
    }
  }

  CheckGrowth();

  TotalZPop = ResZPop + ComZPop + IndZPop;
  powerPop = NuclearPop + CoalPop;

  z = (short)(CityTime & 63);
  switch (z) {
  case 1:
    if ((TotalZPop >> 2) >= ResZPop)
      SendMes(1);
    break;
  case 5:
    if ((TotalZPop >> 3) >= ComZPop)
      SendMes(2);
    break;
  case 10:
    if ((TotalZPop >> 3) >= IndZPop)
      SendMes(3);
    break;
  case 14:
    if ((TotalZPop > 10) && ((TotalZPop << 1) > RoadTotal))
      SendMes(4);
    break;
  case 18:
    if ((TotalZPop > 50) && (TotalZPop > RailTotal))
      SendMes(5);
    break;
  case 22:
    if ((TotalZPop > 10) && (powerPop == 0))
      SendMes(6);
    break;
  case 26:
    if ((ResPop > 500) && (StadiumPop == 0)) {
      SendMes(7);
      ResCap = 1;
    } else {
      ResCap = 0;
    }
    break;
  case 28:
    if ((IndPop > 70) && (PortPop == 0)) {
      SendMes(8);
      IndCap = 1;
    } else {
      IndCap = 0;
    }
    break;
  case 30:
    if ((ComPop > 100) && (APortPop == 0)) {
      SendMes(9);
      ComCap = 1;
    } else {
      ComCap = 0;
    }
    break;
  case 32:
    TM = unPwrdZCnt + PwrdZCnt;
    if (TM != 0.0) {
      if (((double)PwrdZCnt / TM) < 0.7) {
        SendMes(15);
      }
    }
    break;
  case 35:
    if (PolluteAverage > 60)
      SendMes(-10);
    break;
  case 42:
    if (CrimeAverage > 100)
      SendMes(-11);
    break;
  case 45:
    if ((TotalPop > 60) && (FireStPop == 0))
      SendMes(13);
    break;
  case 48:
    if ((TotalPop > 60) && (PolicePop == 0))
      SendMes(14);
    break;
  case 51:
    if (CityTax > 12)
      SendMes(16);
    break;
  case 54:
    if ((RoadEffect < 20) && (RoadTotal > 30))
      SendMes(17);
    break;
  case 57:
    if ((FireEffect < 700) && (TotalPop > 20))
      SendMes(18);
    break;
  case 60:
    if ((PoliceEffect < 700) && (TotalPop > 20))
      SendMes(19);
    break;
  case 63:
    if (TrafficAverage > 60)
      SendMes(-12);
    break;
  default:
    break;
  }
}

static void doMessage(void)
{
  short pictId;

  if (MessagePort) {
    MesNum = MessagePort;
    MessagePort = 0;
    LastMesTime = TickCount();
  } else {
    if (MesNum == 0)
      return;
    if (MesNum < 0) {
      MesNum = (short)(-MesNum);
      LastMesTime = TickCount();
    } else if ((TickCount() - LastMesTime) > (60 * 30)) {
      MesNum = 0;
      return;
    }
  }

  if (MesNum >= 0) {
    if (MesNum == 0) {
      return;
    }
    if (MesNum > 60) {
      MesNum = 0;
      return;
    }

    if (autoGo && (MesX || MesY)) {
      MesX = 0;
      MesY = 0;
    }
    return;
  }

  pictId = (short)(-MesNum);
  MessagePort = pictId;

  if (autoGo && (MesX || MesY)) {
    MesX = 0;
    MesY = 0;
  }
}

static void OracleUpdateOptions(void)
{
  if (!MustUpdateOptions) {
    return;
  }
  MustUpdateOptions = 0;
}

static void OracleReallyUpdateFunds(void)
{
  if (TotalFunds < 0) {
    TotalFunds = 0;
  }
  if (TotalFunds != LastFunds) {
    LastFunds = TotalFunds;
  }
}

static void OracleUpdateDate(void);

static void OracleSetYear(int year)
{
  if (year < StartingYear) {
    year = StartingYear;
  }

  year = (year - StartingYear) - ((int)CityTime / 48);
  CityTime += (QUAD)year * 48;
  OracleUpdateDate();
}

static void OracleUpdateDate(void)
{
  int y;
  int m;
  int megalinium;

  megalinium = 1000000;
  LastCityTime = CityTime >> 2;

  y = ((int)CityTime / 48) + (int)StartingYear;
  m = ((int)CityTime % 48) >> 2;

  if (y >= megalinium) {
    OracleSetYear(StartingYear);
    y = StartingYear;
    SendMes(-40);
  }

  doMessage();

  if ((LastCityYear != y) || (LastCityMonth != m)) {
    LastCityYear = y;
    LastCityMonth = m;
  }
}

void DoUpdateHeads(void)
{
  OracleUpdateDate();
  OracleReallyUpdateFunds();
  OracleUpdateOptions();
}

void DoBudgetNow(int fromMenu)
{
  QUAD yumDuckets;
  QUAD total;
  QUAD moreDough;
  QUAD fireInt;
  QUAD policeInt;
  QUAD roadInt;

  fireInt = (int)(((float)FireFund) * firePercent);
  policeInt = (int)(((float)PoliceFund) * policePercent);
  roadInt = (int)(((float)RoadFund) * roadPercent);
  total = fireInt + policeInt + roadInt;
  yumDuckets = TaxFund + TotalFunds;

  if (yumDuckets > total) {
    FireSpend = fireInt;
    PoliceSpend = policeInt;
    RoadSpend = roadInt;
  } else if (total > 0) {
    if (yumDuckets > roadInt) {
      RoadSpend = roadInt;
      yumDuckets -= roadInt;

      if (yumDuckets > fireInt) {
        FireSpend = fireInt;
        yumDuckets -= fireInt;

        if (yumDuckets > policeInt) {
          PoliceSpend = policeInt;
          yumDuckets -= policeInt;
        } else {
          PoliceSpend = yumDuckets;
          if (yumDuckets > 0)
            policePercent = ((float)yumDuckets) / ((float)PoliceFund);
          else
            policePercent = 0.0f;
        }
      } else {
        FireSpend = yumDuckets;
        PoliceSpend = 0;
        policePercent = 0.0f;
        if (yumDuckets > 0)
          firePercent = ((float)yumDuckets) / ((float)FireFund);
        else
          firePercent = 0.0f;
      }
    } else {
      RoadSpend = yumDuckets;
      if (yumDuckets > 0)
        roadPercent = ((float)yumDuckets) / ((float)RoadFund);
      else
        roadPercent = 0.0f;

      FireSpend = 0;
      PoliceSpend = 0;
      firePercent = 0.0f;
      policePercent = 0.0f;
    }
  } else {
    FireSpend = 0;
    PoliceSpend = 0;
    RoadSpend = 0;
    firePercent = 1.0f;
    policePercent = 1.0f;
    roadPercent = 1.0f;
  }

noMoney:
  if ((!autoBudget) || fromMenu) {
    ShowBudgetWindowAndStartWaiting();

    if (!fromMenu) {
      total = FireSpend + PoliceSpend + RoadSpend;
      moreDough = (QUAD)(TaxFund - total);
      Spend((int)(-moreDough));
    }
    drawBudgetWindow();
    drawCurrPercents();
    DoUpdateHeads();
  } else {
    if ((yumDuckets) > total) {
      moreDough = (QUAD)(TaxFund - total);
      Spend((int)(-moreDough));
      FireSpend = FireFund;
      PoliceSpend = PoliceFund;
      RoadSpend = RoadFund;
      drawBudgetWindow();
      drawCurrPercents();
      DoUpdateHeads();
    } else {
      autoBudget = 0;
      MustUpdateOptions = 1;
      ClearMes();
      SendMes(29);
      goto noMoney;
    }
  }
}

void DoBudget(void) { DoBudgetNow(0); }

void CollectTax(void)
{
  static float RLevels[3] = {0.7f, 0.9f, 1.2f};
  static float FLevels[3] = {1.4f, 1.2f, 0.8f};
  short z;
  short level;

  CashFlow = 0;
  if (TaxFlag) {
    return;
  }

  z = (short)(AvCityTax / 48);
  (void)z;
  AvCityTax = 0;
  PoliceFund = PolicePop * 100;
  FireFund = FireStPop * 100;

  level = GameLevel;
  if (level < 0 || level > 2) {
    level = 0;
  }

  RoadFund = (QUAD)(((RoadTotal + (RailTotal * 2)) * RLevels[level]));
  TaxFund = (((QUAD)TotalPop * LVAverage) / 120) * CityTax * FLevels[level];
  if (TotalPop) {
    CashFlow = TaxFund - (PoliceFund + FireFund + RoadFund);
    DoBudget();
  } else {
    RoadEffect = 32;
    PoliceEffect = 1000;
    FireEffect = 1000;
  }
}

void FireZone(short xloc, short yloc, short tile)
{
  short rx;
  short ry;
  short xymax;
  short zoneId;
  short x;
  short y;
  short xt;
  short yt;
  short value;

  rx = xloc >> 3;
  ry = yloc >> 3;
  if ((rx >= 0) && (rx < SmX) && (ry >= 0) && (ry < SmY)) {
    RateOGMem[rx][ry] -= 20;
  }

  xymax = 4;
  zoneId = (short)(tile & LOMASK);
  if (zoneId < PORTBASE) {
    xymax = 2;
  } else if (zoneId == AIRPORT) {
    xymax = 5;
  }

  for (x = -1; x < xymax; x++) {
    for (y = -1; y < xymax; y++) {
      xt = xloc + x;
      yt = yloc + y;
      if (!TestBounds(xt, yt)) {
        continue;
      }
      value = Map[xt][yt];
      if ((value & LOMASK) >= ROADBASE) {
        Map[xt][yt] = value | BULLBIT;
      }
    }
  }
}

static int Vunerable(int tem)
{
  int tem2;

  tem2 = tem & LOMASK;
  if ((tem2 < RESBASE) || (tem2 > LASTZONE) || (tem & ZONEBIT))
    return FALSE;
  return TRUE;
}

static void SetFire(void)
{
  short x;
  short y;
  short z;

  x = (short)Rand(WORLD_X - 1);
  y = (short)Rand(WORLD_Y - 1);
  z = Map[x][y];
  if (!(z & ZONEBIT)) {
    z = (short)(z & LOMASK);
    if ((z > LHTHR) && (z < LASTZONE)) {
      Map[x][y] = FIRE + ANIMBIT + (Rand16() & 7);
      CrashX = x;
      CrashY = y;
      SendMesAt(-20, x, y);
    }
  }
}

static void MakeFlood(void)
{
  static short Dx[4] = {0, 1, 0, -1};
  static short Dy[4] = {-1, 0, 1, 0};
  short xx;
  short yy;
  short c;
  short z;
  short t;
  short x;
  short y;

  for (z = 0; z < 300; z++) {
    x = (short)Rand(WORLD_X - 1);
    y = (short)Rand(WORLD_Y - 1);
    c = (short)(Map[x][y] & LOMASK);
    if ((c > 4) && (c < 21)) {
      for (t = 0; t < 4; t++) {
        xx = x + Dx[t];
        yy = y + Dy[t];
        if (TestBounds(xx, yy)) {
          c = Map[xx][yy];
          if ((c == 0) || ((c & BULLBIT) && (c & BURNBIT))) {
            Map[xx][yy] = FLOOD;
            FloodCnt = 30;
            SendMesAt(-42, xx, yy);
            FloodX = xx;
            FloodY = yy;
            return;
          }
        }
      }
    }
  }
}

static void MakeEarthquake(void)
{
  short x;
  short y;
  short z;
  short time;

  DoEarthQuake();
  SendMesAt(-23, CCx, CCy);

  time = (short)(Rand(700) + 300);
  for (z = 0; z < time; z++) {
    x = (short)Rand(WORLD_X - 1);
    y = (short)Rand(WORLD_Y - 1);
    if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1)))
      continue;
    if (Vunerable(Map[x][y])) {
      if (z & 0x3)
        Map[x][y] = (RUBBLE + BULLBIT) + (Rand16() & 3);
      else
        Map[x][y] = (FIRE + ANIMBIT) + (Rand16() & 7);
    }
  }
}

static void ScenarioDisaster(void)
{
  switch (DisasterEvent) {
  case 1:
    break;
  case 2:
    if (DisasterWait == 1)
      MakeEarthquake();
    break;
  case 3:
    DropFireBombs();
    break;
  case 4:
    break;
  case 5:
    if (DisasterWait == 1)
      MakeMonster();
    break;
  case 6:
    break;
  case 7:
    if (DisasterWait == 1)
      DoMeltdown(CCx, CCy);
    break;
  case 8:
    if ((DisasterWait % 24) == 0)
      MakeFlood();
    break;
  default:
    break;
  }
  if (DisasterWait)
    DisasterWait--;
  else
    DisasterEvent = 0;
}

void DoDisasters(void)
{
  static short DisChance[3] = {10 * 48, 5 * 48, 60};
  short x;

  if (FloodCnt)
    FloodCnt--;
  if (DisasterEvent)
    ScenarioDisaster();

  x = GameLevel;
  if (x > 2)
    x = 0;

  if (NoDisasters)
    return;
  if (!Rand(DisChance[x])) {
    x = (short)Rand(8);
    switch (x) {
    case 0:
    case 1:
      SetFire();
      break;
    case 2:
    case 3:
      MakeFlood();
      break;
    case 4:
      break;
    case 5:
      MakeTornado();
      break;
    case 6:
      MakeEarthquake();
      break;
    case 7:
    case 8:
      if (PolluteAverage > 60)
        MakeMonster();
      break;
    }
  }
}

/* --- Tool and CTY load commands (headless parity extensions). --- */

#define CTY_HISTORY_WORDS 240
#define CTY_MISC_WORDS 120
#define CTY_HEADER_WORDS ((CTY_HISTORY_WORDS * 6) + CTY_MISC_WORDS)
#define CTY_HEADER_BYTES (CTY_HEADER_WORDS * 2)

enum {
  TOOL_RESIDENTIAL = 0,
  TOOL_COMMERCIAL = 1,
  TOOL_INDUSTRIAL = 2,
  TOOL_FIRE = 3,
  TOOL_QUERY = 4,
  TOOL_POLICE = 5,
  TOOL_WIRE = 6,
  TOOL_BULLDOZE = 7,
  TOOL_RAIL = 8,
  TOOL_ROAD = 9,
  TOOL_CHALK = 10,
  TOOL_ERASER = 11,
  TOOL_STADIUM = 12,
  TOOL_PARK = 13,
  TOOL_SEAPORT = 14,
  TOOL_COAL = 15,
  TOOL_NUCLEAR = 16,
  TOOL_AIRPORT = 17,
  TOOL_NETWORK = 18,
  TOOL_COUNT = 19
};

static QUAD ToolCost[20] = {100, 100, 100, 500, 0,   500, 5,   1,   20, 10,
                            0,   0,   5000, 10,  3000, 3000, 5000, 10000, 100, 0};

static short ToolSize[20] = {3, 3, 3, 3, 1, 3, 1, 1, 1, 1, 0, 0, 4, 1, 4, 4, 4, 6, 1, 0};
static short ToolOffset[20] = {1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0};

static uint16_t ReadBEU16(const unsigned char *src)
{
  return (uint16_t)(((uint16_t)src[0] << 8) | (uint16_t)src[1]);
}

static int16_t ReadBEI16(const unsigned char *src) { return (int16_t)ReadBEU16(src); }

static int32_t ReadMiscI32(const short misc[CTY_MISC_WORDS], int index)
{
  uint32_t hi;
  uint32_t lo;
  uint32_t packed;

  hi = (uint32_t)((uint16_t)misc[index]);
  lo = (uint32_t)((uint16_t)misc[index + 1]);
  packed = (hi << 16) | lo;
  return (int32_t)packed;
}

static void ClearDerivedLayersForLoad(void)
{
  int x;
  int y;

  for (x = 0; x < HWLDX; x++) {
    for (y = 0; y < HWLDY; y++) {
      gTrfStorage[x][y] = 0;
      gPopDensityStorage[x][y] = 0;
      gPollutionStorage[x][y] = 0;
      gLandValueStorage[x][y] = 0;
      gCrimeStorage[x][y] = 0;
      gTemStorage[x][y] = 0;
      gTem2Storage[x][y] = 0;
    }
  }

  for (x = 0; x < QWX; x++) {
    for (y = 0; y < QWY; y++) {
      gTerrainStorage[x][y] = 0;
      gQtemStorage[x][y] = 0;
    }
  }

  for (x = 0; x < SmX; x++) {
    for (y = 0; y < SmY; y++) {
      RateOGMem[x][y] = 0;
      FireStMap[x][y] = 0;
      PoliceMap[x][y] = 0;
      PoliceMapEffect[x][y] = 0;
      ComRate[x][y] = 0;
      FireRate[x][y] = 0;
      STem[x][y] = 0;
    }
  }

  for (x = 0; x < PWRMAPSIZE; x++) {
    PowerMap[x] = 0;
  }
  for (x = PWRMAPSIZE; x < POWERMAPLEN; x++) {
    PowerMap[x] = 0;
  }
  for (x = 0; x < PWRSTKSIZE; x++) {
    PowerStackX[x] = 0;
    PowerStackY[x] = 0;
  }

  TrafMaxX = 0;
  TrafMaxY = 0;
  PowerStackNum = 0;
  NewPower = 0;
  CChr = 0;
  CChr9 = 0;
  CoalPop = 0;
  NuclearPop = 0;
  PwrdZCnt = 0;
  unPwrdZCnt = 0;
}

static int LoadCtyFile(const char *path)
{
  FILE *file;
  long size;
  unsigned char *buffer;
  size_t readLen;
  int mapWords;
  int i;
  short misc[CTY_MISC_WORDS];
  int32_t cityTime;
  int32_t totalFunds;
  int32_t cityTax;
  int32_t simSpeed;

  file = fopen(path, "rb");
  if (file == NULL) {
    fprintf(stderr, "failed to open cty file: %s (%s)\n", path, strerror(errno));
    return 0;
  }

  if (fseek(file, 0L, SEEK_END) != 0) {
    fclose(file);
    return 0;
  }
  size = ftell(file);
  if (size < 0) {
    fclose(file);
    return 0;
  }
  if (fseek(file, 0L, SEEK_SET) != 0) {
    fclose(file);
    return 0;
  }

  if ((size != 27120L) && (size != 99120L) && (size != 219120L)) {
    fclose(file);
    fprintf(stderr, "unsupported cty size: %ld\n", size);
    return 0;
  }
  if (size < (CTY_HEADER_BYTES + (MAP_WORD_COUNT * 2))) {
    fclose(file);
    fprintf(stderr, "cty file too small for 120x100 map: %s\n", path);
    return 0;
  }

  buffer = (unsigned char *)malloc((size_t)size);
  if (buffer == NULL) {
    fclose(file);
    return 0;
  }

  readLen = fread(buffer, 1u, (size_t)size, file);
  fclose(file);
  if (readLen != (size_t)size) {
    free(buffer);
    fprintf(stderr, "failed to read cty bytes: %s\n", path);
    return 0;
  }

  mapWords = (int)((size - CTY_HEADER_BYTES) / 2L);
  if (mapWords < MAP_WORD_COUNT) {
    free(buffer);
    fprintf(stderr, "cty map payload too short: %s\n", path);
    return 0;
  }

  for (i = 0; i < MAP_WORD_COUNT; i++) {
    int x;
    int y;
    uint16_t word;
    const unsigned char *src;

    x = i / WORLD_Y;
    y = i % WORLD_Y;
    src = buffer + CTY_HEADER_BYTES + (i * 2);
    word = ReadBEU16(src);
    gMapStorage[x][y] = (short)word;
  }

  for (i = 0; i < CTY_MISC_WORDS; i++) {
    misc[i] = ReadBEI16(buffer + ((CTY_HISTORY_WORDS * 6 + i) * 2));
  }

  cityTime = ReadMiscI32(misc, 8);
  totalFunds = ReadMiscI32(misc, 50);
  cityTax = (int32_t)misc[56];
  simSpeed = (int32_t)misc[57];

  if (cityTime < 0) {
    cityTime = 0;
  }
  if ((cityTax < 0) || (cityTax > 20)) {
    cityTax = 7;
  }
  if ((simSpeed < 0) || (simSpeed > 3)) {
    simSpeed = 3;
  }

  CityTime = (QUAD)cityTime;
  CityTax = (short)cityTax;
  SimSpeed = (short)simSpeed;
  autoBulldoze = (misc[52] != 0) ? 1 : 0;
  autoBudget = (misc[53] != 0) ? 1 : 0;
  autoGo = (misc[54] != 0) ? 1 : 0;
  UserSoundOn = (misc[55] != 0) ? 1 : 0;
  MustUpdateOptions = 1;
  ScenarioID = 0;
  DoInitialEval = 0;

  policePercent = 1.0f;
  firePercent = 1.0f;
  roadPercent = 1.0f;
  SetFunds((int)totalFunds);

  ClearMes();
  MesNum = 0;
  LastMesTime = 0;
  LastCityTime = -1;
  LastCityYear = -1;
  LastCityMonth = -1;

  for (i = 0; i < NMAPS; i++) {
    NewMapFlags[i] = 0;
  }
  NewMap = 0;

  ClearDerivedLayersForLoad();

  free(buffer);
  return 1;
}

static short ToolTally(short tileValue)
{
  if (((tileValue >= FIRSTRIVEDGE) && (tileValue <= LASTRUBBLE)) ||
      ((tileValue >= (POWERBASE + 2)) && (tileValue <= (POWERBASE + 12))) ||
      ((tileValue >= TINYEXP) && (tileValue <= (LASTTINYEXP + 2)))) {
    return 1;
  }
  return 0;
}

static short CheckBigZone(short id, short *deltaHPtr, short *deltaVPtr)
{
  switch (id) {
  case POWERPLANT:
  case PORT:
  case NUCLEAR:
  case STADIUM:
    *deltaHPtr = 0;
    *deltaVPtr = 0;
    return 4;
  case POWERPLANT + 1:
  case COALSMOKE3:
  case COALSMOKE3 + 1:
  case COALSMOKE3 + 2:
  case PORT + 1:
  case NUCLEAR + 1:
  case STADIUM + 1:
    *deltaHPtr = -1;
    *deltaVPtr = 0;
    return 4;
  case POWERPLANT + 4:
  case PORT + 4:
  case NUCLEAR + 4:
  case STADIUM + 4:
    *deltaHPtr = 0;
    *deltaVPtr = -1;
    return 4;
  case POWERPLANT + 5:
  case PORT + 5:
  case NUCLEAR + 5:
  case STADIUM + 5:
    *deltaHPtr = -1;
    *deltaVPtr = -1;
    return 4;
  case AIRPORT:
    *deltaHPtr = 0;
    *deltaVPtr = 0;
    return 6;
  case AIRPORT + 1:
    *deltaHPtr = -1;
    *deltaVPtr = 0;
    return 6;
  case AIRPORT + 2:
    *deltaHPtr = -2;
    *deltaVPtr = 0;
    return 6;
  case AIRPORT + 3:
    *deltaHPtr = -3;
    *deltaVPtr = 0;
    return 6;
  case AIRPORT + 6:
    *deltaHPtr = 0;
    *deltaVPtr = -1;
    return 6;
  case AIRPORT + 7:
    *deltaHPtr = -1;
    *deltaVPtr = -1;
    return 6;
  case AIRPORT + 8:
    *deltaHPtr = -2;
    *deltaVPtr = -1;
    return 6;
  case AIRPORT + 9:
    *deltaHPtr = -3;
    *deltaVPtr = -1;
    return 6;
  case AIRPORT + 12:
    *deltaHPtr = 0;
    *deltaVPtr = -2;
    return 6;
  case AIRPORT + 13:
    *deltaHPtr = -1;
    *deltaVPtr = -2;
    return 6;
  case AIRPORT + 14:
    *deltaHPtr = -2;
    *deltaVPtr = -2;
    return 6;
  case AIRPORT + 15:
    *deltaHPtr = -3;
    *deltaVPtr = -2;
    return 6;
  case AIRPORT + 18:
    *deltaHPtr = 0;
    *deltaVPtr = -3;
    return 6;
  case AIRPORT + 19:
    *deltaHPtr = -1;
    *deltaVPtr = -3;
    return 6;
  case AIRPORT + 20:
    *deltaHPtr = -2;
    *deltaVPtr = -3;
    return 6;
  case AIRPORT + 21:
    *deltaHPtr = -3;
    *deltaVPtr = -3;
    return 6;
  default:
    *deltaHPtr = 0;
    *deltaVPtr = 0;
    return 0;
  }
}

static short CheckSize(short temp)
{
  if (((temp >= (RESBASE - 1)) && (temp <= (PORTBASE - 1))) ||
      ((temp >= (LASTPOWERPLANT + 1)) && (temp <= (POLICESTATION + 4)))) {
    return 3;
  }
  if (((temp >= PORTBASE) && (temp <= LASTPORT)) || ((temp >= COALBASE) && (temp <= LASTPOWERPLANT)) ||
      ((temp >= STADIUMBASE) && (temp <= LASTZONE))) {
    return 4;
  }
  return 0;
}

static void Check3x3Border(short xMap, short yMap)
{
  short xPos;
  short yPos;
  short cnt;

  xPos = xMap;
  yPos = yMap - 1;
  for (cnt = 0; cnt < 3; cnt++) {
    ConnecTile(xPos, yPos, &Map[xPos][yPos], 0);
    xPos++;
  }

  xPos = xMap - 1;
  yPos = yMap;
  for (cnt = 0; cnt < 3; cnt++) {
    ConnecTile(xPos, yPos, &Map[xPos][yPos], 0);
    yPos++;
  }

  xPos = xMap;
  yPos = yMap + 3;
  for (cnt = 0; cnt < 3; cnt++) {
    ConnecTile(xPos, yPos, &Map[xPos][yPos], 0);
    xPos++;
  }

  xPos = xMap + 3;
  yPos = yMap;
  for (cnt = 0; cnt < 3; cnt++) {
    ConnecTile(xPos, yPos, &Map[xPos][yPos], 0);
    yPos++;
  }
}

static void Check4x4Border(short xMap, short yMap)
{
  short xPos;
  short yPos;
  short cnt;

  xPos = xMap;
  yPos = yMap - 1;
  for (cnt = 0; cnt < 4; cnt++) {
    ConnecTile(xPos, yPos, &Map[xPos][yPos], 0);
    xPos++;
  }

  xPos = xMap - 1;
  yPos = yMap;
  for (cnt = 0; cnt < 4; cnt++) {
    ConnecTile(xPos, yPos, &Map[xPos][yPos], 0);
    yPos++;
  }

  xPos = xMap;
  yPos = yMap + 4;
  for (cnt = 0; cnt < 4; cnt++) {
    ConnecTile(xPos, yPos, &Map[xPos][yPos], 0);
    xPos++;
  }

  xPos = xMap + 4;
  yPos = yMap;
  for (cnt = 0; cnt < 4; cnt++) {
    ConnecTile(xPos, yPos, &Map[xPos][yPos], 0);
    yPos++;
  }
}

static void Check6x6Border(short xMap, short yMap)
{
  short xPos;
  short yPos;
  short cnt;

  xPos = xMap;
  yPos = yMap - 1;
  for (cnt = 0; cnt < 6; cnt++) {
    ConnecTile(xPos, yPos, &Map[xPos][yPos], 0);
    xPos++;
  }

  xPos = xMap - 1;
  yPos = yMap;
  for (cnt = 0; cnt < 6; cnt++) {
    ConnecTile(xPos, yPos, &Map[xPos][yPos], 0);
    yPos++;
  }

  xPos = xMap;
  yPos = yMap + 6;
  for (cnt = 0; cnt < 6; cnt++) {
    ConnecTile(xPos, yPos, &Map[xPos][yPos], 0);
    xPos++;
  }

  xPos = xMap + 6;
  yPos = yMap;
  for (cnt = 0; cnt < 6; cnt++) {
    ConnecTile(xPos, yPos, &Map[xPos][yPos], 0);
    yPos++;
  }
}

static int Check3x3Tool(short mapH, short mapV, short base, short tool)
{
  short rowNum;
  short columnNum;
  short holdMapH;
  short holdMapV;
  short xPos;
  short yPos;
  short cost;
  short tileValue;
  short flag;

  mapH--;
  mapV--;
  if ((mapH < 0) || (mapH > (WORLD_X - 3)) || (mapV < 0) || (mapV > (WORLD_Y - 3))) {
    return -1;
  }

  xPos = holdMapH = mapH;
  yPos = holdMapV = mapV;
  flag = 1;
  cost = 0;

  for (rowNum = 0; rowNum <= 2; rowNum++) {
    mapH = holdMapH;
    for (columnNum = 0; columnNum <= 2; columnNum++) {
      tileValue = Map[mapH++][mapV] & LOMASK;
      if (autoBulldoze) {
        if (tileValue != 0) {
          if (ToolTally(tileValue)) {
            cost++;
          } else {
            flag = 0;
          }
        }
      } else if (tileValue != 0) {
        flag = 0;
      }
    }
    mapV++;
  }

  if (flag == 0) {
    return -1;
  }

  cost += (short)ToolCost[tool];
  if ((TotalFunds - cost) < 0) {
    return -2;
  }

  Spend(cost);
  UpdateFunds();

  mapV = holdMapV;
  for (rowNum = 0; rowNum <= 2; rowNum++) {
    mapH = holdMapH;
    for (columnNum = 0; columnNum <= 2; columnNum++) {
      if ((columnNum == 1) && (rowNum == 1)) {
        Map[mapH++][mapV] = base + BNCNBIT + ZONEBIT;
      } else {
        Map[mapH++][mapV] = base + BNCNBIT;
      }
      base++;
    }
    mapV++;
  }
  Check3x3Border(xPos, yPos);
  return 1;
}

static int Check4x4Tool(short mapH, short mapV, short base, short aniFlag, short tool)
{
  short rowNum;
  short columnNum;
  short h;
  short v;
  short holdMapH;
  short xMap;
  short yMap;
  short tileValue;
  short flag;
  short cost;

  mapH--;
  mapV--;
  if ((mapH < 0) || (mapH > (WORLD_X - 4)) || (mapV < 0) || (mapV > (WORLD_Y - 4))) {
    return -1;
  }

  h = xMap = holdMapH = mapH;
  v = yMap = mapV;
  flag = 1;
  cost = 0;

  for (rowNum = 0; rowNum <= 3; rowNum++) {
    mapH = holdMapH;
    for (columnNum = 0; columnNum <= 3; columnNum++) {
      tileValue = Map[mapH++][mapV] & LOMASK;
      if (autoBulldoze) {
        if (tileValue != 0) {
          if (ToolTally(tileValue)) {
            cost++;
          } else {
            flag = 0;
          }
        }
      } else if (tileValue != 0) {
        flag = 0;
      }
    }
    mapV++;
  }

  if (flag == 0) {
    return -1;
  }

  cost += (short)ToolCost[tool];
  if ((TotalFunds - cost) < 0) {
    return -2;
  }

  Spend(cost);
  UpdateFunds();

  mapV = v;
  holdMapH = h;
  for (rowNum = 0; rowNum <= 3; rowNum++) {
    mapH = holdMapH;
    for (columnNum = 0; columnNum <= 3; columnNum++) {
      if ((columnNum == 1) && (rowNum == 1)) {
        Map[mapH++][mapV] = base + BNCNBIT + ZONEBIT;
      } else if ((columnNum == 1) && (rowNum == 2) && aniFlag) {
        Map[mapH++][mapV] = base + BNCNBIT + ANIMBIT;
      } else {
        Map[mapH++][mapV] = base + BNCNBIT;
      }
      base++;
    }
    mapV++;
  }
  Check4x4Border(xMap, yMap);
  return 1;
}

static int Check6x6Tool(short mapH, short mapV, short base, short tool)
{
  short rowNum;
  short columnNum;
  short h;
  short v;
  short holdMapH;
  short xMap;
  short yMap;
  short flag;
  short tileValue;
  short cost;

  mapH--;
  mapV--;
  if ((mapH < 0) || (mapH > (WORLD_X - 6)) || (mapV < 0) || (mapV > (WORLD_Y - 6))) {
    return -1;
  }

  h = xMap = holdMapH = mapH;
  v = yMap = mapV;
  flag = 1;
  cost = 0;

  for (rowNum = 0; rowNum <= 5; rowNum++) {
    mapH = holdMapH;
    for (columnNum = 0; columnNum <= 5; columnNum++) {
      tileValue = Map[mapH++][mapV] & LOMASK;
      if (autoBulldoze) {
        if (tileValue != 0) {
          if (ToolTally(tileValue)) {
            cost++;
          } else {
            flag = 0;
          }
        }
      } else if (tileValue != 0) {
        flag = 0;
      }
    }
    mapV++;
  }

  if (flag == 0) {
    return -1;
  }

  cost += (short)ToolCost[tool];
  if ((TotalFunds - cost) < 0) {
    return -2;
  }

  Spend(cost);
  UpdateFunds();

  mapV = v;
  holdMapH = h;
  for (rowNum = 0; rowNum <= 5; rowNum++) {
    mapH = holdMapH;
    for (columnNum = 0; columnNum <= 5; columnNum++) {
      if ((columnNum == 1) && (rowNum == 1)) {
        Map[mapH++][mapV] = base + BNCNBIT + ZONEBIT;
      } else {
        Map[mapH++][mapV] = base + BNCNBIT;
      }
      base++;
    }
    mapV++;
  }
  Check6x6Border(xMap, yMap);
  return 1;
}

static void Put3x3Rubble(short x, short y)
{
  int xx;
  int yy;
  int zz;

  for (xx = x - 1; xx < x + 2; xx++) {
    for (yy = y - 1; yy < y + 2; yy++) {
      if (TestBounds(xx, yy)) {
        zz = Map[xx][yy] & LOMASK;
        if ((zz != RADTILE) && (zz != 0)) {
          Map[xx][yy] = (DoAnimation ? (TINYEXP + Rand(2)) : SOMETINYEXP) | ANIMBIT | BULLBIT;
        }
      }
    }
  }
}

static void Put4x4Rubble(short x, short y)
{
  int xx;
  int yy;
  int zz;

  for (xx = x - 1; xx < x + 3; xx++) {
    for (yy = y - 1; yy < y + 3; yy++) {
      if (TestBounds(xx, yy)) {
        zz = Map[xx][yy] & LOMASK;
        if ((zz != RADTILE) && (zz != 0)) {
          Map[xx][yy] = (DoAnimation ? (TINYEXP + Rand(2)) : SOMETINYEXP) | ANIMBIT | BULLBIT;
        }
      }
    }
  }
}

static void Put6x6Rubble(short x, short y)
{
  int xx;
  int yy;
  int zz;

  for (xx = x - 1; xx < x + 5; xx++) {
    for (yy = y - 1; yy < y + 5; yy++) {
      if (TestBounds(xx, yy)) {
        zz = Map[xx][yy] & LOMASK;
        if ((zz != RADTILE) && (zz != 0)) {
          Map[xx][yy] = (DoAnimation ? (TINYEXP + Rand(2)) : SOMETINYEXP) | ANIMBIT | BULLBIT;
        }
      }
    }
  }
}

static int PutDownPark(short mapH, short mapV)
{
  short value;
  short tile;

  if ((TotalFunds - ToolCost[TOOL_PARK]) < 0) {
    return -2;
  }

  value = (short)Rand(4);
  if (value == 4) {
    tile = FOUNTAIN | BURNBIT | BULLBIT | ANIMBIT;
  } else {
    tile = (value + WOODS2) | BURNBIT | BULLBIT;
  }

  if (Map[mapH][mapV] == 0) {
    Spend((int)ToolCost[TOOL_PARK]);
    UpdateFunds();
    Map[mapH][mapV] = tile;
    return 1;
  }
  return -1;
}

static int PutDownNetwork(short mapH, short mapV)
{
  int tile;

  tile = Map[mapH][mapV] & LOMASK;
  if ((TotalFunds > 0) && ToolTally((short)tile)) {
    Map[mapH][mapV] = 0;
    tile = 0;
    Spend(1);
  }

  if (tile != 0) {
    return -1;
  }
  if ((TotalFunds - ToolCost[TOOL_NETWORK]) < 0) {
    return -2;
  }

  Map[mapH][mapV] = TELEBASE | CONDBIT | BURNBIT | BULLBIT | ANIMBIT;
  Spend((int)ToolCost[TOOL_NETWORK]);
  UpdateFunds();
  return 1;
}

static int QueryTool(short x, short y)
{
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  return 1;
}

static int BulldozerTool(short x, short y)
{
  unsigned short currTile;
  unsigned short temp;
  short zoneSize;
  short deltaH;
  short deltaV;
  int result;

  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }

  currTile = Map[x][y];
  temp = currTile & LOMASK;
  result = 1;

  if (currTile & ZONEBIT) {
    if (TotalFunds > 0) {
      Spend(1);
      switch (CheckSize((short)temp)) {
      case 3:
        Put3x3Rubble(x, y);
        break;
      case 4:
        Put4x4Rubble(x, y);
        break;
      case 6:
        Put6x6Rubble(x, y);
        break;
      default:
        break;
      }
    }
  } else if ((zoneSize = CheckBigZone((short)temp, &deltaH, &deltaV))) {
    if (TotalFunds > 0) {
      Spend(1);
      switch (zoneSize) {
      case 4:
        Put4x4Rubble(x + deltaH, y + deltaV);
        break;
      case 6:
        Put6x6Rubble(x + deltaH, y + deltaV);
        break;
      default:
        break;
      }
    }
  } else {
    if ((temp == RIVER) || (temp == REDGE) || (temp == CHANNEL)) {
      if (TotalFunds >= 6) {
        result = ConnecTile(x, y, &Map[x][y], 1);
        if (temp != (Map[x][y] & LOMASK)) {
          Spend(5);
        }
      } else {
        result = 0;
      }
    } else {
      result = ConnecTile(x, y, &Map[x][y], 1);
    }
  }

  UpdateFunds();
  return result;
}

static int RoadTool(short x, short y)
{
  int result;
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  result = ConnecTile(x, y, &Map[x][y], 2);
  UpdateFunds();
  return result;
}

static int RailTool(short x, short y)
{
  int result;
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  result = ConnecTile(x, y, &Map[x][y], 3);
  UpdateFunds();
  return result;
}

static int WireTool(short x, short y)
{
  int result;
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  result = ConnecTile(x, y, &Map[x][y], 4);
  UpdateFunds();
  return result;
}

static int ParkTool(short x, short y)
{
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  return PutDownPark(x, y);
}

static int ResidentialTool(short x, short y)
{
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  return Check3x3Tool(x, y, RESBASE, TOOL_RESIDENTIAL);
}

static int CommercialTool(short x, short y)
{
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  return Check3x3Tool(x, y, COMBASE, TOOL_COMMERCIAL);
}

static int IndustrialTool(short x, short y)
{
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  return Check3x3Tool(x, y, INDBASE, TOOL_INDUSTRIAL);
}

static int PoliceTool(short x, short y)
{
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  return Check3x3Tool(x, y, POLICESTBASE, TOOL_POLICE);
}

static int FireTool(short x, short y)
{
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  return Check3x3Tool(x, y, FIRESTBASE, TOOL_FIRE);
}

static int StadiumTool(short x, short y)
{
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  return Check4x4Tool(x, y, STADIUMBASE, 0, TOOL_STADIUM);
}

static int CoalTool(short x, short y)
{
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  return Check4x4Tool(x, y, COALBASE, 1, TOOL_COAL);
}

static int NuclearTool(short x, short y)
{
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  return Check4x4Tool(x, y, NUCLEARBASE, 1, TOOL_NUCLEAR);
}

static int SeaportTool(short x, short y)
{
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  return Check4x4Tool(x, y, PORTBASE, 0, TOOL_SEAPORT);
}

static int AirportTool(short x, short y)
{
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  return Check6x6Tool(x, y, AIRPORTBASE, TOOL_AIRPORT);
}

static int NetworkTool(short x, short y)
{
  if ((x < 0) || (x > (WORLD_X - 1)) || (y < 0) || (y > (WORLD_Y - 1))) {
    return -1;
  }
  return PutDownNetwork(x, y);
}

static int DoToolByState(short tool, short x, short y)
{
  switch (tool) {
  case TOOL_RESIDENTIAL:
    return ResidentialTool(x, y);
  case TOOL_COMMERCIAL:
    return CommercialTool(x, y);
  case TOOL_INDUSTRIAL:
    return IndustrialTool(x, y);
  case TOOL_FIRE:
    return FireTool(x, y);
  case TOOL_QUERY:
    return QueryTool(x, y);
  case TOOL_POLICE:
    return PoliceTool(x, y);
  case TOOL_WIRE:
    return WireTool(x, y);
  case TOOL_BULLDOZE:
    return BulldozerTool(x, y);
  case TOOL_RAIL:
    return RailTool(x, y);
  case TOOL_ROAD:
    return RoadTool(x, y);
  case TOOL_CHALK:
  case TOOL_ERASER:
    return QueryTool(x, y);
  case TOOL_STADIUM:
    return StadiumTool(x, y);
  case TOOL_PARK:
    return ParkTool(x, y);
  case TOOL_SEAPORT:
    return SeaportTool(x, y);
  case TOOL_COAL:
    return CoalTool(x, y);
  case TOOL_NUCLEAR:
    return NuclearTool(x, y);
  case TOOL_AIRPORT:
    return AirportTool(x, y);
  case TOOL_NETWORK:
    return NetworkTool(x, y);
  default:
    return 0;
  }
}

static int ParseToolState(const char *raw, short *out)
{
  if ((raw == NULL) || (out == NULL)) {
    return 0;
  }

  if (strcmp(raw, "res") == 0)
    *out = TOOL_RESIDENTIAL;
  else if (strcmp(raw, "com") == 0)
    *out = TOOL_COMMERCIAL;
  else if (strcmp(raw, "ind") == 0)
    *out = TOOL_INDUSTRIAL;
  else if (strcmp(raw, "fire") == 0)
    *out = TOOL_FIRE;
  else if (strcmp(raw, "query") == 0)
    *out = TOOL_QUERY;
  else if (strcmp(raw, "police") == 0)
    *out = TOOL_POLICE;
  else if (strcmp(raw, "wire") == 0)
    *out = TOOL_WIRE;
  else if (strcmp(raw, "bulldoze") == 0)
    *out = TOOL_BULLDOZE;
  else if (strcmp(raw, "rail") == 0)
    *out = TOOL_RAIL;
  else if (strcmp(raw, "road") == 0)
    *out = TOOL_ROAD;
  else if (strcmp(raw, "chalk") == 0)
    *out = TOOL_CHALK;
  else if (strcmp(raw, "eraser") == 0)
    *out = TOOL_ERASER;
  else if (strcmp(raw, "stadium") == 0)
    *out = TOOL_STADIUM;
  else if (strcmp(raw, "park") == 0)
    *out = TOOL_PARK;
  else if (strcmp(raw, "seaport") == 0)
    *out = TOOL_SEAPORT;
  else if (strcmp(raw, "coal") == 0)
    *out = TOOL_COAL;
  else if (strcmp(raw, "nuclear") == 0)
    *out = TOOL_NUCLEAR;
  else if (strcmp(raw, "airport") == 0)
    *out = TOOL_AIRPORT;
  else if (strcmp(raw, "network") == 0)
    *out = TOOL_NETWORK;
  else {
    long parsed;
    char *end;

    errno = 0;
    parsed = strtol(raw, &end, 10);
    if ((raw == end) || (errno != 0) || (*end != '\0') || (parsed < 0) || (parsed >= TOOL_COUNT)) {
      return 0;
    }
    *out = (short)parsed;
  }

  return 1;
}

static int StepRealtimeTicks(long ticks)
{
  long i;

  if (ticks < 0) {
    return 0;
  }
  for (i = 0; i < ticks; i++) {
    gTickNow++;
  }
  return 1;
}

/* --- State IO --- */

static void BindLayerPointers(void)
{
  int x;

  for (x = 0; x < WORLD_X; x++) {
    Map[x] = (short *)gMapStorage[x];
  }
  for (x = 0; x < HWLDX; x++) {
    TrfDensity[x] = gTrfStorage[x];
    PopDensity[x] = gPopDensityStorage[x];
    PollutionMem[x] = gPollutionStorage[x];
    LandValueMem[x] = gLandValueStorage[x];
    CrimeMem[x] = gCrimeStorage[x];
    tem[x] = gTemStorage[x];
    tem2[x] = gTem2Storage[x];
  }
  for (x = 0; x < QWX; x++) {
    TerrainMem[x] = gTerrainStorage[x];
    Qtem[x] = gQtemStorage[x];
  }
}

static void ResetStateDefaults(uint32_t seed)
{
  int x;
  int y;

  for (x = 0; x < WORLD_X; x++) {
    for (y = 0; y < WORLD_Y; y++) {
      gMapStorage[x][y] = 0;
    }
  }

  for (x = 0; x < HWLDX; x++) {
    for (y = 0; y < HWLDY; y++) {
      gTrfStorage[x][y] = 0;
      gPopDensityStorage[x][y] = 0;
      gPollutionStorage[x][y] = 0;
      gLandValueStorage[x][y] = 0;
      gCrimeStorage[x][y] = 0;
      gTemStorage[x][y] = 0;
      gTem2Storage[x][y] = 0;
    }
  }

  for (x = 0; x < QWX; x++) {
    for (y = 0; y < QWY; y++) {
      gTerrainStorage[x][y] = 0;
      gQtemStorage[x][y] = 0;
    }
  }

  for (x = 0; x < SmX; x++) {
    for (y = 0; y < SmY; y++) {
      RateOGMem[x][y] = 0;
      FireStMap[x][y] = 0;
      PoliceMap[x][y] = 0;
      PoliceMapEffect[x][y] = 0;
      ComRate[x][y] = 0;
      FireRate[x][y] = 0;
      STem[x][y] = 0;
    }
  }

  for (x = 0; x < POWERMAPLEN; x++) {
    PowerMap[x] = 0;
  }

  for (x = 0; x < PWRSTKSIZE; x++) {
    PowerStackX[x] = 0;
    PowerStackY[x] = 0;
  }

  CityTime = 50;
  StartingYear = 1900;
  CityTax = 7;
  GameLevel = 0;
  TaxFlag = 0;
  AvCityTax = 0;
  Scycle = 0;
  Fcycle = 0;
  SimSpeed = 3;
  DoInitialEval = 0;
  NewPower = 0;
  MustUpdateOptions = 1;
  SMapX = 0;
  SMapY = 0;
  CChr = 0;
  CChr9 = 0;
  LastCityTime = -1;
  LastCityYear = -1;
  LastCityMonth = -1;
  LastFunds = -1;
  LastMesTime = 0;
  LastPicNum = 0;
  MessagePort = 0;
  MesX = 0;
  MesY = 0;
  MesNum = 0;
  autoGo = 1;
  UserSoundOn = 1;
  DoAnimation = 1;
  DoMessages = 1;
  DoNotices = 1;
  ScenarioID = 0;
  ScoreType = 0;
  ScoreWait = 0;
  LastCityPop = 0;
  LastCategory = 0;
  CityClass = 0;
  CityScore = 500;
  TrafficAverage = 0;
  CrimeAverage = 0;
  PolluteAverage = 0;
  ResPop = 0;
  ComPop = 0;
  IndPop = 0;
  TotalPop = 0;
  ResZPop = 0;
  ComZPop = 0;
  IndZPop = 0;
  TotalZPop = 0;
  StadiumPop = 0;
  PortPop = 0;
  APortPop = 0;
  ResCap = 0;
  ComCap = 0;
  IndCap = 0;
  TotalFunds = 0;
  TaxFund = 0;
  RoadFund = 0;
  PoliceFund = 0;
  FireFund = 0;
  CashFlow = 0;
  RoadSpend = 0;
  PoliceSpend = 0;
  FireSpend = 0;
  RoadTotal = 0;
  RailTotal = 0;
  RoadEffect = 32;
  PoliceEffect = 1000;
  FireEffect = 1000;
  PolicePop = 0;
  FireStPop = 0;
  LVAverage = 0;
  roadPercent = 1.0f;
  policePercent = 1.0f;
  firePercent = 1.0f;
  autoBudget = 1;
  autoBulldoze = 1;
  NoDisasters = 0;
  DisasterEvent = 0;
  DisasterWait = 0;
  FloodCnt = 0;
  FloodX = 0;
  FloodY = 0;
  CrashX = 0;
  CrashY = 0;
  CCx = 0;
  CCy = 0;
  CoalPop = 0;
  NuclearPop = 0;
  PwrdZCnt = 0;
  unPwrdZCnt = 0;
  LVAverage = 0;
  CrimeAverage = 0;
  PolluteAverage = 0;
  PowerStackNum = 0;
  TrafMaxX = 0;
  TrafMaxY = 0;

  for (x = 0; x < NMAPS; x++) {
    NewMapFlags[x] = 0;
  }
  NewMap = 0;
  CCx = 0;
  CCy = 0;
  CCx2 = 0;
  CCy2 = 0;
  PolMaxX = 0;
  PolMaxY = 0;
  CrimeMaxX = 0;
  CrimeMaxY = 0;
  DonDither = 0;

  gCopSprite.control = -1;
  gCopSprite.dest_x = 0;
  gCopSprite.dest_y = 0;
  gTickNow = 0;
  gDidLoseGame = 0;
  gDidWinGame = 0;
  gDidEarthquake = 0;

  SeedRand((int)seed);
}

static int JoinPath(char *out, size_t outSize, const char *dir, const char *file)
{
  int written;

  written = snprintf(out, outSize, "%s/%s", dir, file);
  if ((written < 0) || ((size_t)written >= outSize)) {
    return 0;
  }
  return 1;
}

static int WriteMapBin(const char *path)
{
  FILE *file;
  int x;
  int y;

  file = fopen(path, "wb");
  if (file == NULL) {
    fprintf(stderr, "failed to open map for write: %s (%s)\n", path, strerror(errno));
    return 0;
  }

  for (x = 0; x < WORLD_X; x++) {
    for (y = 0; y < WORLD_Y; y++) {
      uint16_t word;
      unsigned char bytes[2];

      word = (uint16_t)(gMapStorage[x][y] & 0xffffu);
      bytes[0] = (unsigned char)(word & 0xffu);
      bytes[1] = (unsigned char)((word >> 8) & 0xffu);
      if (fwrite(bytes, 1u, 2u, file) != 2u) {
        fclose(file);
        fprintf(stderr, "failed to write map bytes: %s\n", path);
        return 0;
      }
    }
  }

  fclose(file);
  return 1;
}

static int ReadMapBin(const char *path)
{
  FILE *file;
  int x;
  int y;

  file = fopen(path, "rb");
  if (file == NULL) {
    fprintf(stderr, "failed to open map for read: %s (%s)\n", path, strerror(errno));
    return 0;
  }

  for (x = 0; x < WORLD_X; x++) {
    for (y = 0; y < WORLD_Y; y++) {
      unsigned char bytes[2];
      uint16_t word;

      if (fread(bytes, 1u, 2u, file) != 2u) {
        fclose(file);
        fprintf(stderr, "map size mismatch: %s\n", path);
        return 0;
      }
      word = (uint16_t)(((uint16_t)bytes[1] << 8) | (uint16_t)bytes[0]);
      gMapStorage[x][y] = word;
    }
  }

  fclose(file);
  return 1;
}

static int WriteTrfBin(const char *path)
{
  FILE *file;
  int x;

  file = fopen(path, "wb");
  if (file == NULL) {
    fprintf(stderr, "failed to open traffic for write: %s (%s)\n", path, strerror(errno));
    return 0;
  }

  for (x = 0; x < HWLDX; x++) {
    if (fwrite(gTrfStorage[x], 1u, (size_t)HWLDY, file) != (size_t)HWLDY) {
      fclose(file);
      fprintf(stderr, "failed to write traffic bytes: %s\n", path);
      return 0;
    }
  }

  fclose(file);
  return 1;
}

static int ReadTrfBin(const char *path)
{
  FILE *file;
  int x;

  file = fopen(path, "rb");
  if (file == NULL) {
    fprintf(stderr, "failed to open traffic for read: %s (%s)\n", path, strerror(errno));
    return 0;
  }

  for (x = 0; x < HWLDX; x++) {
    if (fread(gTrfStorage[x], 1u, (size_t)HWLDY, file) != (size_t)HWLDY) {
      fclose(file);
      fprintf(stderr, "traffic size mismatch: %s\n", path);
      return 0;
    }
  }

  fclose(file);
  return 1;
}

static int WriteHalfBin(const char *path, Byte storage[HWLDX][HWLDY], const char *name)
{
  FILE *file;
  int x;

  file = fopen(path, "wb");
  if (file == NULL) {
    fprintf(stderr, "failed to open %s for write: %s (%s)\n", name, path, strerror(errno));
    return 0;
  }

  for (x = 0; x < HWLDX; x++) {
    if (fwrite(storage[x], 1u, (size_t)HWLDY, file) != (size_t)HWLDY) {
      fclose(file);
      fprintf(stderr, "failed to write %s bytes: %s\n", name, path);
      return 0;
    }
  }

  fclose(file);
  return 1;
}

static int ReadHalfBin(const char *path, Byte storage[HWLDX][HWLDY], const char *name)
{
  FILE *file;
  int x;

  file = fopen(path, "rb");
  if (file == NULL) {
    fprintf(stderr, "failed to open %s for read: %s (%s)\n", name, path, strerror(errno));
    return 0;
  }

  for (x = 0; x < HWLDX; x++) {
    if (fread(storage[x], 1u, (size_t)HWLDY, file) != (size_t)HWLDY) {
      fclose(file);
      fprintf(stderr, "%s size mismatch: %s\n", name, path);
      return 0;
    }
  }

  fclose(file);
  return 1;
}

static int WriteQuarterBin(const char *path, Byte storage[QWX][QWY], const char *name)
{
  FILE *file;
  int x;

  file = fopen(path, "wb");
  if (file == NULL) {
    fprintf(stderr, "failed to open %s for write: %s (%s)\n", name, path, strerror(errno));
    return 0;
  }

  for (x = 0; x < QWX; x++) {
    if (fwrite(storage[x], 1u, (size_t)QWY, file) != (size_t)QWY) {
      fclose(file);
      fprintf(stderr, "failed to write %s bytes: %s\n", name, path);
      return 0;
    }
  }

  fclose(file);
  return 1;
}

static int ReadQuarterBin(const char *path, Byte storage[QWX][QWY], const char *name)
{
  FILE *file;
  int x;

  file = fopen(path, "rb");
  if (file == NULL) {
    fprintf(stderr, "failed to open %s for read: %s (%s)\n", name, path, strerror(errno));
    return 0;
  }

  for (x = 0; x < QWX; x++) {
    if (fread(storage[x], 1u, (size_t)QWY, file) != (size_t)QWY) {
      fclose(file);
      fprintf(stderr, "%s size mismatch: %s\n", name, path);
      return 0;
    }
  }

  fclose(file);
  return 1;
}

static int WriteSmI16Bin(const char *path, short storage[SmX][SmY], const char *name)
{
  FILE *file;
  int x;
  int y;

  file = fopen(path, "wb");
  if (file == NULL) {
    fprintf(stderr, "failed to open %s for write: %s (%s)\n", name, path, strerror(errno));
    return 0;
  }

  for (x = 0; x < SmX; x++) {
    for (y = 0; y < SmY; y++) {
      int16_t value;
      unsigned char bytes[2];

      value = (int16_t)storage[x][y];
      bytes[0] = (unsigned char)((uint16_t)value & 0xffu);
      bytes[1] = (unsigned char)(((uint16_t)value >> 8) & 0xffu);
      if (fwrite(bytes, 1u, 2u, file) != 2u) {
        fclose(file);
        fprintf(stderr, "failed to write %s bytes: %s\n", name, path);
        return 0;
      }
    }
  }

  fclose(file);
  return 1;
}

static int ReadSmI16Bin(const char *path, short storage[SmX][SmY], const char *name)
{
  FILE *file;
  int x;
  int y;

  file = fopen(path, "rb");
  if (file == NULL) {
    fprintf(stderr, "failed to open %s for read: %s (%s)\n", name, path, strerror(errno));
    return 0;
  }

  for (x = 0; x < SmX; x++) {
    for (y = 0; y < SmY; y++) {
      unsigned char bytes[2];
      int16_t value;

      if (fread(bytes, 1u, 2u, file) != 2u) {
        fclose(file);
        fprintf(stderr, "%s size mismatch: %s\n", name, path);
        return 0;
      }
      value = (int16_t)(((uint16_t)bytes[1] << 8) | (uint16_t)bytes[0]);
      storage[x][y] = (short)value;
    }
  }

  fclose(file);
  return 1;
}

static int WriteRogBin(const char *path)
{
  FILE *file;
  int x;
  int y;

  file = fopen(path, "wb");
  if (file == NULL) {
    fprintf(stderr, "failed to open ROG for write: %s (%s)\n", path, strerror(errno));
    return 0;
  }

  for (x = 0; x < SmX; x++) {
    for (y = 0; y < SmY; y++) {
      int16_t value;
      unsigned char bytes[2];

      value = (int16_t)RateOGMem[x][y];
      bytes[0] = (unsigned char)((uint16_t)value & 0xffu);
      bytes[1] = (unsigned char)(((uint16_t)value >> 8) & 0xffu);
      if (fwrite(bytes, 1u, 2u, file) != 2u) {
        fclose(file);
        fprintf(stderr, "failed to write ROG bytes: %s\n", path);
        return 0;
      }
    }
  }

  fclose(file);
  return 1;
}

static int ReadRogBin(const char *path)
{
  FILE *file;
  int x;
  int y;

  file = fopen(path, "rb");
  if (file == NULL) {
    fprintf(stderr, "failed to open ROG for read: %s (%s)\n", path, strerror(errno));
    return 0;
  }

  for (x = 0; x < SmX; x++) {
    for (y = 0; y < SmY; y++) {
      unsigned char bytes[2];
      int16_t value;

      if (fread(bytes, 1u, 2u, file) != 2u) {
        fclose(file);
        fprintf(stderr, "ROG size mismatch: %s\n", path);
        return 0;
      }
      value = (int16_t)(((uint16_t)bytes[1] << 8) | (uint16_t)bytes[0]);
      RateOGMem[x][y] = value;
    }
  }

  fclose(file);
  return 1;
}

static int WritePowerBin(const char *path)
{
  FILE *file;
  int i;

  file = fopen(path, "wb");
  if (file == NULL) {
    fprintf(stderr, "failed to open power map for write: %s (%s)\n", path, strerror(errno));
    return 0;
  }

  for (i = 0; i < PWRMAPSIZE; i++) {
    uint16_t word;
    unsigned char bytes[2];

    word = (uint16_t)(PowerMap[i] & 0xffffu);
    bytes[0] = (unsigned char)(word & 0xffu);
    bytes[1] = (unsigned char)((word >> 8) & 0xffu);
    if (fwrite(bytes, 1u, 2u, file) != 2u) {
      fclose(file);
      fprintf(stderr, "failed to write power map bytes: %s\n", path);
      return 0;
    }
  }

  fclose(file);
  return 1;
}

static int ReadPowerBin(const char *path)
{
  FILE *file;
  int i;

  file = fopen(path, "rb");
  if (file == NULL) {
    fprintf(stderr, "failed to open power map for read: %s (%s)\n", path, strerror(errno));
    return 0;
  }

  for (i = 0; i < PWRMAPSIZE; i++) {
    unsigned char bytes[2];
    uint16_t word;

    if (fread(bytes, 1u, 2u, file) != 2u) {
      fclose(file);
      fprintf(stderr, "power map size mismatch: %s\n", path);
      return 0;
    }
    word = (uint16_t)(((uint16_t)bytes[1] << 8) | (uint16_t)bytes[0]);
    PowerMap[i] = (short)word;
  }

  for (i = PWRMAPSIZE; i < POWERMAPLEN; i++) {
    PowerMap[i] = 0;
  }

  fclose(file);
  return 1;
}

static int WritePowerStackBin(const char *path, const char *stack)
{
  FILE *file;

  file = fopen(path, "wb");
  if (file == NULL) {
    fprintf(stderr, "failed to open power stack for write: %s (%s)\n", path, strerror(errno));
    return 0;
  }

  if (fwrite(stack, 1u, (size_t)PWRSTKSIZE, file) != (size_t)PWRSTKSIZE) {
    fclose(file);
    fprintf(stderr, "failed to write power stack bytes: %s\n", path);
    return 0;
  }

  fclose(file);
  return 1;
}

static int ReadPowerStackBin(const char *path, char *stack)
{
  FILE *file;

  file = fopen(path, "rb");
  if (file == NULL) {
    fprintf(stderr, "failed to open power stack for read: %s (%s)\n", path, strerror(errno));
    return 0;
  }

  if (fread(stack, 1u, (size_t)PWRSTKSIZE, file) != (size_t)PWRSTKSIZE) {
    fclose(file);
    fprintf(stderr, "power stack size mismatch: %s\n", path);
    return 0;
  }

  fclose(file);
  return 1;
}

static int WriteSnapshotJson(const char *path)
{
  FILE *file;

  file = fopen(path, "wb");
  if (file == NULL) {
    fprintf(stderr, "failed to open snapshot for write: %s (%s)\n", path, strerror(errno));
    return 0;
  }

  fprintf(file, "{\n");
  fprintf(file, "  \"snapshotVersion\": %d,\n", SNAPSHOT_VERSION);
  fprintf(file, "  \"snapshotFormat\": \"json+binary\",\n");
  fprintf(file, "  \"snapshotFormatTodo\": \"TODO(c-oracle): migrate to a single binary envelope once schema stabilizes\",\n");
  fprintf(file, "  \"rngNext\": %u,\n", gRandNext);
  fprintf(file, "  \"TickNow\": %lld,\n", (long long)gTickNow);
  fprintf(file, "  \"CityTime\": %lld,\n", (long long)CityTime);
  fprintf(file, "  \"StartingYear\": %d,\n", StartingYear);
  fprintf(file, "  \"CityTax\": %d,\n", CityTax);
  fprintf(file, "  \"GameLevel\": %d,\n", GameLevel);
  fprintf(file, "  \"TaxFlag\": %d,\n", TaxFlag);
  fprintf(file, "  \"AvCityTax\": %d,\n", AvCityTax);
  fprintf(file, "  \"Scycle\": %d,\n", Scycle);
  fprintf(file, "  \"Fcycle\": %d,\n", Fcycle);
  fprintf(file, "  \"SimSpeed\": %d,\n", SimSpeed);
  fprintf(file, "  \"DoInitialEval\": %d,\n", DoInitialEval);
  fprintf(file, "  \"NewPower\": %d,\n", NewPower);
  fprintf(file, "  \"MustUpdateOptions\": %d,\n", MustUpdateOptions);
  fprintf(file, "  \"LastCityTime\": %lld,\n", (long long)LastCityTime);
  fprintf(file, "  \"LastCityYear\": %lld,\n", (long long)LastCityYear);
  fprintf(file, "  \"LastCityMonth\": %lld,\n", (long long)LastCityMonth);
  fprintf(file, "  \"LastFunds\": %lld,\n", (long long)LastFunds);
  fprintf(file, "  \"TotalFunds\": %lld,\n", (long long)TotalFunds);
  fprintf(file, "  \"TaxFund\": %lld,\n", (long long)TaxFund);
  fprintf(file, "  \"RoadFund\": %lld,\n", (long long)RoadFund);
  fprintf(file, "  \"PoliceFund\": %lld,\n", (long long)PoliceFund);
  fprintf(file, "  \"FireFund\": %lld,\n", (long long)FireFund);
  fprintf(file, "  \"CashFlow\": %lld,\n", (long long)CashFlow);
  fprintf(file, "  \"RoadSpend\": %lld,\n", (long long)RoadSpend);
  fprintf(file, "  \"PoliceSpend\": %lld,\n", (long long)PoliceSpend);
  fprintf(file, "  \"FireSpend\": %lld,\n", (long long)FireSpend);
  fprintf(file, "  \"roadPercent\": %.17g,\n", (double)roadPercent);
  fprintf(file, "  \"policePercent\": %.17g,\n", (double)policePercent);
  fprintf(file, "  \"firePercent\": %.17g,\n", (double)firePercent);
  fprintf(file, "  \"autoBudget\": %d,\n", autoBudget);
  fprintf(file, "  \"autoBulldoze\": %d,\n", autoBulldoze);
  fprintf(file, "  \"autoGo\": %d,\n", autoGo);
  fprintf(file, "  \"UserSoundOn\": %d,\n", UserSoundOn);
  fprintf(file, "  \"DoAnimation\": %d,\n", DoAnimation);
  fprintf(file, "  \"DoMessages\": %d,\n", DoMessages);
  fprintf(file, "  \"DoNotices\": %d,\n", DoNotices);
  fprintf(file, "  \"RoadTotal\": %d,\n", RoadTotal);
  fprintf(file, "  \"RailTotal\": %d,\n", RailTotal);
  fprintf(file, "  \"RoadEffect\": %d,\n", RoadEffect);
  fprintf(file, "  \"PoliceEffect\": %d,\n", PoliceEffect);
  fprintf(file, "  \"FireEffect\": %d,\n", FireEffect);
  fprintf(file, "  \"PolicePop\": %d,\n", PolicePop);
  fprintf(file, "  \"FireStPop\": %d,\n", FireStPop);
  fprintf(file, "  \"LVAverage\": %d,\n", LVAverage);
  fprintf(file, "  \"MessagePort\": %d,\n", MessagePort);
  fprintf(file, "  \"MesX\": %d,\n", MesX);
  fprintf(file, "  \"MesY\": %d,\n", MesY);
  fprintf(file, "  \"MesNum\": %d,\n", MesNum);
  fprintf(file, "  \"LastMesTime\": %lld,\n", (long long)LastMesTime);
  fprintf(file, "  \"LastPicNum\": %d,\n", LastPicNum);
  fprintf(file, "  \"ScenarioID\": %d,\n", ScenarioID);
  fprintf(file, "  \"ScoreType\": %d,\n", ScoreType);
  fprintf(file, "  \"ScoreWait\": %d,\n", ScoreWait);
  fprintf(file, "  \"LastCityPop\": %lld,\n", (long long)LastCityPop);
  fprintf(file, "  \"LastCategory\": %d,\n", LastCategory);
  fprintf(file, "  \"CityClass\": %d,\n", CityClass);
  fprintf(file, "  \"CityScore\": %d,\n", CityScore);
  fprintf(file, "  \"TrafficAverage\": %d,\n", TrafficAverage);
  fprintf(file, "  \"CrimeAverage\": %d,\n", CrimeAverage);
  fprintf(file, "  \"PolluteAverage\": %d,\n", PolluteAverage);
  fprintf(file, "  \"ResPop\": %d,\n", ResPop);
  fprintf(file, "  \"ComPop\": %d,\n", ComPop);
  fprintf(file, "  \"IndPop\": %d,\n", IndPop);
  fprintf(file, "  \"TotalPop\": %d,\n", TotalPop);
  fprintf(file, "  \"ResZPop\": %d,\n", ResZPop);
  fprintf(file, "  \"ComZPop\": %d,\n", ComZPop);
  fprintf(file, "  \"IndZPop\": %d,\n", IndZPop);
  fprintf(file, "  \"TotalZPop\": %d,\n", TotalZPop);
  fprintf(file, "  \"StadiumPop\": %d,\n", StadiumPop);
  fprintf(file, "  \"PortPop\": %d,\n", PortPop);
  fprintf(file, "  \"APortPop\": %d,\n", APortPop);
  fprintf(file, "  \"ResCap\": %d,\n", ResCap);
  fprintf(file, "  \"ComCap\": %d,\n", ComCap);
  fprintf(file, "  \"IndCap\": %d,\n", IndCap);
  fprintf(file, "  \"NoDisasters\": %d,\n", NoDisasters);
  fprintf(file, "  \"DisasterEvent\": %d,\n", DisasterEvent);
  fprintf(file, "  \"DisasterWait\": %d,\n", DisasterWait);
  fprintf(file, "  \"FloodCnt\": %d,\n", FloodCnt);
  fprintf(file, "  \"FloodX\": %d,\n", FloodX);
  fprintf(file, "  \"FloodY\": %d,\n", FloodY);
  fprintf(file, "  \"CrashX\": %d,\n", CrashX);
  fprintf(file, "  \"CrashY\": %d,\n", CrashY);
  fprintf(file, "  \"CCx\": %d,\n", CCx);
  fprintf(file, "  \"CCy\": %d,\n", CCy);
  fprintf(file, "  \"DidLoseGame\": %d,\n", gDidLoseGame);
  fprintf(file, "  \"DidWinGame\": %d,\n", gDidWinGame);
  fprintf(file, "  \"DidEarthquake\": %d,\n", gDidEarthquake);
  fprintf(file, "  \"CChr9\": %d,\n", CChr9);
  fprintf(file, "  \"CoalPop\": %d,\n", CoalPop);
  fprintf(file, "  \"NuclearPop\": %d,\n", NuclearPop);
  fprintf(file, "  \"PwrdZCnt\": %d,\n", PwrdZCnt);
  fprintf(file, "  \"unPwrdZCnt\": %d,\n", unPwrdZCnt);
  fprintf(file, "  \"LVAverage\": %d,\n", LVAverage);
  fprintf(file, "  \"CrimeAverage\": %d,\n", CrimeAverage);
  fprintf(file, "  \"PolluteAverage\": %d,\n", PolluteAverage);
  fprintf(file, "  \"CCx\": %d,\n", CCx);
  fprintf(file, "  \"CCy\": %d,\n", CCy);
  fprintf(file, "  \"CCx2\": %d,\n", CCx2);
  fprintf(file, "  \"CCy2\": %d,\n", CCy2);
  fprintf(file, "  \"PolMaxX\": %d,\n", PolMaxX);
  fprintf(file, "  \"PolMaxY\": %d,\n", PolMaxY);
  fprintf(file, "  \"CrimeMaxX\": %d,\n", CrimeMaxX);
  fprintf(file, "  \"CrimeMaxY\": %d,\n", CrimeMaxY);
  fprintf(file, "  \"DonDither\": %lld,\n", (long long)DonDither);
  fprintf(file, "  \"PowerStackNum\": %d,\n", PowerStackNum);
  fprintf(file, "  \"TrafMaxX\": %d,\n", TrafMaxX);
  fprintf(file, "  \"TrafMaxY\": %d,\n", TrafMaxY);
  fprintf(file, "  \"copControl\": %d,\n", gCopSprite.control);
  fprintf(file, "  \"copDestX\": %d,\n", gCopSprite.dest_x);
  fprintf(file, "  \"copDestY\": %d,\n", gCopSprite.dest_y);
  fprintf(file, "  \"NewMapFlags_ALMAP\": %d,\n", NewMapFlags[ALMAP]);
  fprintf(file, "  \"NewMapFlags_REMAP\": %d,\n", NewMapFlags[REMAP]);
  fprintf(file, "  \"NewMapFlags_COMAP\": %d,\n", NewMapFlags[COMAP]);
  fprintf(file, "  \"NewMapFlags_INMAP\": %d,\n", NewMapFlags[INMAP]);
  fprintf(file, "  \"NewMapFlags_PRMAP\": %d,\n", NewMapFlags[PRMAP]);
  fprintf(file, "  \"NewMapFlags_RDMAP\": %d,\n", NewMapFlags[RDMAP]);
  fprintf(file, "  \"NewMapFlags_PDMAP\": %d,\n", NewMapFlags[PDMAP]);
  fprintf(file, "  \"NewMapFlags_RGMAP\": %d,\n", NewMapFlags[RGMAP]);
  fprintf(file, "  \"NewMapFlags_TDMAP\": %d,\n", NewMapFlags[TDMAP]);
  fprintf(file, "  \"NewMapFlags_PLMAP\": %d,\n", NewMapFlags[PLMAP]);
  fprintf(file, "  \"NewMapFlags_CRMAP\": %d,\n", NewMapFlags[CRMAP]);
  fprintf(file, "  \"NewMapFlags_LVMAP\": %d,\n", NewMapFlags[LVMAP]);
  fprintf(file, "  \"NewMapFlags_FIMAP\": %d,\n", NewMapFlags[FIMAP]);
  fprintf(file, "  \"NewMapFlags_POMAP\": %d,\n", NewMapFlags[POMAP]);
  fprintf(file, "  \"NewMapFlags_DYMAP\": %d\n", NewMapFlags[DYMAP]);
  fprintf(file, "}\n");

  fclose(file);
  return 1;
}

static int ParseJsonI64(const char *json, const char *key, long long *out)
{
  char pattern[96];
  const char *found;
  const char *value;
  char *end;
  long long parsed;

  snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  found = strstr(json, pattern);
  if (found == NULL)
    return 0;

  value = strchr(found, ':');
  if (value == NULL)
    return 0;
  value++;
  while ((*value != '\0') && isspace((unsigned char)*value))
    value++;

  errno = 0;
  parsed = strtoll(value, &end, 10);
  if ((end == value) || (errno != 0))
    return 0;

  *out = parsed;
  return 1;
}

static int ParseJsonDouble(const char *json, const char *key, double *out)
{
  char pattern[96];
  const char *found;
  const char *value;
  char *end;
  double parsed;

  snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  found = strstr(json, pattern);
  if (found == NULL)
    return 0;

  value = strchr(found, ':');
  if (value == NULL)
    return 0;
  value++;
  while ((*value != '\0') && isspace((unsigned char)*value))
    value++;

  errno = 0;
  parsed = strtod(value, &end);
  if ((end == value) || (errno != 0))
    return 0;

  *out = parsed;
  return 1;
}

static int ReadWholeFile(const char *path, char **outBuf)
{
  FILE *file;
  long size;
  size_t readLen;
  char *buf;

  file = fopen(path, "rb");
  if (file == NULL) {
    fprintf(stderr, "failed to open snapshot for read: %s (%s)\n", path, strerror(errno));
    return 0;
  }

  if (fseek(file, 0, SEEK_END) != 0) {
    fclose(file);
    return 0;
  }
  size = ftell(file);
  if (size < 0) {
    fclose(file);
    return 0;
  }
  if (fseek(file, 0, SEEK_SET) != 0) {
    fclose(file);
    return 0;
  }

  buf = (char *)malloc((size_t)size + 1u);
  if (buf == NULL) {
    fclose(file);
    return 0;
  }

  readLen = fread(buf, 1u, (size_t)size, file);
  fclose(file);
  if (readLen != (size_t)size) {
    free(buf);
    return 0;
  }

  buf[size] = '\0';
  *outBuf = buf;
  return 1;
}

static int ReadSnapshotJson(const char *path)
{
  char *json;
  long long value;
  double fvalue;

  if (!ReadWholeFile(path, &json)) {
    return 0;
  }

/* clang-format off */
#define READ_I64(KEY, TARGET, CAST)              \
  do {                                           \
    if (!ParseJsonI64(json, KEY, &value)) {     \
      free(json);                                \
      return 0;                                  \
    }                                            \
    TARGET = (CAST)value;                        \
  } while (0)
#define READ_F64(KEY, TARGET)                    \
  do {                                           \
    if (!ParseJsonDouble(json, KEY, &fvalue)) { \
      free(json);                                \
      return 0;                                  \
    }                                            \
    TARGET = (float)fvalue;                      \
  } while (0)
/* clang-format on */

  READ_I64("rngNext", gRandNext, uint32_t);
  READ_I64("TickNow", gTickNow, QUAD);
  READ_I64("CityTime", CityTime, QUAD);
  READ_I64("StartingYear", StartingYear, short);
  READ_I64("CityTax", CityTax, short);
  READ_I64("GameLevel", GameLevel, short);
  READ_I64("TaxFlag", TaxFlag, short);
  READ_I64("AvCityTax", AvCityTax, short);
  READ_I64("Scycle", Scycle, short);
  READ_I64("Fcycle", Fcycle, short);
  READ_I64("SimSpeed", SimSpeed, short);
  READ_I64("DoInitialEval", DoInitialEval, short);
  READ_I64("NewPower", NewPower, short);
  READ_I64("MustUpdateOptions", MustUpdateOptions, short);
  READ_I64("LastCityTime", LastCityTime, QUAD);
  READ_I64("LastCityYear", LastCityYear, QUAD);
  READ_I64("LastCityMonth", LastCityMonth, QUAD);
  READ_I64("LastFunds", LastFunds, QUAD);
  READ_I64("TotalFunds", TotalFunds, QUAD);
  READ_I64("TaxFund", TaxFund, QUAD);
  READ_I64("RoadFund", RoadFund, QUAD);
  READ_I64("PoliceFund", PoliceFund, QUAD);
  READ_I64("FireFund", FireFund, QUAD);
  READ_I64("CashFlow", CashFlow, QUAD);
  READ_I64("RoadSpend", RoadSpend, QUAD);
  READ_I64("PoliceSpend", PoliceSpend, QUAD);
  READ_I64("FireSpend", FireSpend, QUAD);
  READ_F64("roadPercent", roadPercent);
  READ_F64("policePercent", policePercent);
  READ_F64("firePercent", firePercent);
  READ_I64("autoBudget", autoBudget, short);
  READ_I64("autoBulldoze", autoBulldoze, short);
  READ_I64("autoGo", autoGo, short);
  READ_I64("UserSoundOn", UserSoundOn, short);
  READ_I64("DoAnimation", DoAnimation, short);
  READ_I64("DoMessages", DoMessages, short);
  READ_I64("DoNotices", DoNotices, short);
  READ_I64("RoadTotal", RoadTotal, short);
  READ_I64("RailTotal", RailTotal, short);
  READ_I64("RoadEffect", RoadEffect, short);
  READ_I64("PoliceEffect", PoliceEffect, short);
  READ_I64("FireEffect", FireEffect, short);
  READ_I64("PolicePop", PolicePop, short);
  READ_I64("FireStPop", FireStPop, short);
  READ_I64("LVAverage", LVAverage, short);
  READ_I64("MessagePort", MessagePort, short);
  READ_I64("MesX", MesX, short);
  READ_I64("MesY", MesY, short);
  READ_I64("MesNum", MesNum, short);
  READ_I64("LastMesTime", LastMesTime, QUAD);
  READ_I64("LastPicNum", LastPicNum, short);
  READ_I64("ScenarioID", ScenarioID, short);
  READ_I64("ScoreType", ScoreType, short);
  READ_I64("ScoreWait", ScoreWait, short);
  READ_I64("LastCityPop", LastCityPop, QUAD);
  READ_I64("LastCategory", LastCategory, short);
  READ_I64("CityClass", CityClass, short);
  READ_I64("CityScore", CityScore, short);
  READ_I64("TrafficAverage", TrafficAverage, short);
  READ_I64("CrimeAverage", CrimeAverage, short);
  READ_I64("PolluteAverage", PolluteAverage, short);
  READ_I64("ResPop", ResPop, short);
  READ_I64("ComPop", ComPop, short);
  READ_I64("IndPop", IndPop, short);
  READ_I64("TotalPop", TotalPop, short);
  READ_I64("ResZPop", ResZPop, short);
  READ_I64("ComZPop", ComZPop, short);
  READ_I64("IndZPop", IndZPop, short);
  READ_I64("TotalZPop", TotalZPop, short);
  READ_I64("StadiumPop", StadiumPop, short);
  READ_I64("PortPop", PortPop, short);
  READ_I64("APortPop", APortPop, short);
  READ_I64("ResCap", ResCap, short);
  READ_I64("ComCap", ComCap, short);
  READ_I64("IndCap", IndCap, short);
  READ_I64("NoDisasters", NoDisasters, short);
  READ_I64("DisasterEvent", DisasterEvent, short);
  READ_I64("DisasterWait", DisasterWait, short);
  READ_I64("FloodCnt", FloodCnt, short);
  READ_I64("FloodX", FloodX, short);
  READ_I64("FloodY", FloodY, short);
  READ_I64("CrashX", CrashX, short);
  READ_I64("CrashY", CrashY, short);
  READ_I64("CCx", CCx, short);
  READ_I64("CCy", CCy, short);
  READ_I64("DidLoseGame", gDidLoseGame, short);
  READ_I64("DidWinGame", gDidWinGame, short);
  READ_I64("DidEarthquake", gDidEarthquake, short);
  READ_I64("CChr9", CChr9, short);
  READ_I64("CoalPop", CoalPop, short);
  READ_I64("NuclearPop", NuclearPop, short);
  READ_I64("PwrdZCnt", PwrdZCnt, short);
  READ_I64("unPwrdZCnt", unPwrdZCnt, short);
  READ_I64("PowerStackNum", PowerStackNum, int);
  READ_I64("TrafMaxX", TrafMaxX, short);
  READ_I64("TrafMaxY", TrafMaxY, short);
  READ_I64("copControl", gCopSprite.control, int);
  READ_I64("copDestX", gCopSprite.dest_x, int);
  READ_I64("copDestY", gCopSprite.dest_y, int);
  READ_I64("NewMapFlags_ALMAP", NewMapFlags[ALMAP], short);
  READ_I64("NewMapFlags_REMAP", NewMapFlags[REMAP], short);
  READ_I64("NewMapFlags_COMAP", NewMapFlags[COMAP], short);
  READ_I64("NewMapFlags_INMAP", NewMapFlags[INMAP], short);
  READ_I64("NewMapFlags_PRMAP", NewMapFlags[PRMAP], short);
  READ_I64("NewMapFlags_RDMAP", NewMapFlags[RDMAP], short);
  READ_I64("NewMapFlags_TDMAP", NewMapFlags[TDMAP], short);
  READ_I64("NewMapFlags_DYMAP", NewMapFlags[DYMAP], short);

  if (!ParseJsonI64(json, "CityTax", &value)) {
    free(json);
    return 0;
  }
  CityTax = (short)value;

  if (!ParseJsonI64(json, "AvCityTax", &value)) {
    free(json);
    return 0;
  }
  AvCityTax = (short)value;

  if (!ParseJsonI64(json, "Scycle", &value)) {
    free(json);
    return 0;
  }
  Scycle = (short)value;

  if (!ParseJsonI64(json, "Fcycle", &value)) {
    free(json);
    return 0;
  }
  Fcycle = (short)value;

  if (!ParseJsonI64(json, "SimSpeed", &value)) {
    free(json);
    return 0;
  }
  SimSpeed = (short)value;

  if (!ParseJsonI64(json, "DoInitialEval", &value)) {
    free(json);
    return 0;
  }
  DoInitialEval = (short)value;

  if (!ParseJsonI64(json, "NewPower", &value)) {
    free(json);
    return 0;
  }
  NewPower = (short)value;

  if (!ParseJsonI64(json, "CChr9", &value)) {
    free(json);
    return 0;
  }
  CChr9 = (short)value;

  if (!ParseJsonI64(json, "CoalPop", &value)) {
    free(json);
    return 0;
  }
  CoalPop = (short)value;

  if (!ParseJsonI64(json, "NuclearPop", &value)) {
    free(json);
    return 0;
  }
  NuclearPop = (short)value;

  if (!ParseJsonI64(json, "PwrdZCnt", &value)) {
    free(json);
    return 0;
  }
  PwrdZCnt = (short)value;

  if (!ParseJsonI64(json, "unPwrdZCnt", &value)) {
    free(json);
    return 0;
  }
  unPwrdZCnt = (short)value;

  if (!ParseJsonI64(json, "LVAverage", &value)) {
    free(json);
    return 0;
  }
  LVAverage = (short)value;

  if (!ParseJsonI64(json, "CrimeAverage", &value)) {
    free(json);
    return 0;
  }
  CrimeAverage = (short)value;

  if (!ParseJsonI64(json, "PolluteAverage", &value)) {
    free(json);
    return 0;
  }
  PolluteAverage = (short)value;

  if (!ParseJsonI64(json, "CCx", &value)) {
    free(json);
    return 0;
  }
  CCx = (short)value;

  if (!ParseJsonI64(json, "CCy", &value)) {
    free(json);
    return 0;
  }
  CCy = (short)value;

  if (!ParseJsonI64(json, "CCx2", &value)) {
    free(json);
    return 0;
  }
  CCx2 = (short)value;

  if (!ParseJsonI64(json, "CCy2", &value)) {
    free(json);
    return 0;
  }
  CCy2 = (short)value;

  if (!ParseJsonI64(json, "PolMaxX", &value)) {
    free(json);
    return 0;
  }
  PolMaxX = (short)value;

  if (!ParseJsonI64(json, "PolMaxY", &value)) {
    free(json);
    return 0;
  }
  PolMaxY = (short)value;

  if (!ParseJsonI64(json, "CrimeMaxX", &value)) {
    free(json);
    return 0;
  }
  CrimeMaxX = (short)value;

  if (!ParseJsonI64(json, "CrimeMaxY", &value)) {
    free(json);
    return 0;
  }
  CrimeMaxY = (short)value;

  if (!ParseJsonI64(json, "DonDither", &value)) {
    free(json);
    return 0;
  }
  DonDither = (QUAD)value;

  if (!ParseJsonI64(json, "PowerStackNum", &value)) {
    free(json);
    return 0;
  }
  PowerStackNum = (int)value;

  if (!ParseJsonI64(json, "TrafMaxX", &value)) {
    free(json);
    return 0;
  }
  TrafMaxX = (short)value;

  if (!ParseJsonI64(json, "TrafMaxY", &value)) {
    free(json);
    return 0;
  }
  TrafMaxY = (short)value;

  if (!ParseJsonI64(json, "copControl", &value)) {
    free(json);
    return 0;
  }
  gCopSprite.control = (int)value;

  if (!ParseJsonI64(json, "copDestX", &value)) {
    free(json);
    return 0;
  }
  gCopSprite.dest_x = (int)value;

  if (!ParseJsonI64(json, "copDestY", &value)) {
    free(json);
    return 0;
  }
  gCopSprite.dest_y = (int)value;

  if (!ParseJsonI64(json, "NewMapFlags_ALMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[ALMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_REMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[REMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_COMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[COMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_INMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[INMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_PRMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[PRMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_RDMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[RDMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_PDMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[PDMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_RGMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[RGMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_TDMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[TDMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_PLMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[PLMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_CRMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[CRMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_LVMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[LVMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_FIMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[FIMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_POMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[POMAP] = (short)value;

  if (!ParseJsonI64(json, "NewMapFlags_DYMAP", &value)) {
    free(json);
    return 0;
  }
  NewMapFlags[DYMAP] = (short)value;
#undef READ_I64
#undef READ_F64

  free(json);
  return 1;
}

static int SaveStateDir(const char *stateDir)
{
  char path[PATH_MAX];

  if (!JoinPath(path, sizeof(path), stateDir, SNAPSHOT_FILE))
    return 0;
  if (!WriteSnapshotJson(path))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, MAP_FILE))
    return 0;
  if (!WriteMapBin(path))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, TRF_FILE))
    return 0;
  if (!WriteTrfBin(path))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POP_DENSITY_FILE))
    return 0;
  if (!WriteHalfBin(path, gPopDensityStorage, "pop-density"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POLLUTION_FILE))
    return 0;
  if (!WriteHalfBin(path, gPollutionStorage, "pollution"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, LAND_VALUE_FILE))
    return 0;
  if (!WriteHalfBin(path, gLandValueStorage, "land-value"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, CRIME_FILE))
    return 0;
  if (!WriteHalfBin(path, gCrimeStorage, "crime"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, TERRAIN_FILE))
    return 0;
  if (!WriteQuarterBin(path, gTerrainStorage, "terrain"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, ROG_FILE))
    return 0;
  if (!WriteRogBin(path))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, FIRE_ST_FILE))
    return 0;
  if (!WriteSmI16Bin(path, FireStMap, "fire station map"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POLICE_FILE))
    return 0;
  if (!WriteSmI16Bin(path, PoliceMap, "police map"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POLICE_EFFECT_FILE))
    return 0;
  if (!WriteSmI16Bin(path, PoliceMapEffect, "police effect map"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, FIRE_RATE_FILE))
    return 0;
  if (!WriteSmI16Bin(path, FireRate, "fire-rate"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, COM_RATE_FILE))
    return 0;
  if (!WriteSmI16Bin(path, ComRate, "com-rate"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POWER_FILE))
    return 0;
  if (!WritePowerBin(path))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POWER_STACK_X_FILE))
    return 0;
  if (!WritePowerStackBin(path, PowerStackX))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POWER_STACK_Y_FILE))
    return 0;
  if (!WritePowerStackBin(path, PowerStackY))
    return 0;

  return 1;
}

static int LoadStateDir(const char *stateDir)
{
  char path[PATH_MAX];

  if (!JoinPath(path, sizeof(path), stateDir, SNAPSHOT_FILE))
    return 0;
  if (!ReadSnapshotJson(path))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, MAP_FILE))
    return 0;
  if (!ReadMapBin(path))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, TRF_FILE))
    return 0;
  if (!ReadTrfBin(path))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POP_DENSITY_FILE))
    return 0;
  if (!ReadHalfBin(path, gPopDensityStorage, "pop-density"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POLLUTION_FILE))
    return 0;
  if (!ReadHalfBin(path, gPollutionStorage, "pollution"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, LAND_VALUE_FILE))
    return 0;
  if (!ReadHalfBin(path, gLandValueStorage, "land-value"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, CRIME_FILE))
    return 0;
  if (!ReadHalfBin(path, gCrimeStorage, "crime"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, TERRAIN_FILE))
    return 0;
  if (!ReadQuarterBin(path, gTerrainStorage, "terrain"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, ROG_FILE))
    return 0;
  if (!ReadRogBin(path))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, FIRE_ST_FILE))
    return 0;
  if (!ReadSmI16Bin(path, FireStMap, "fire station map"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POLICE_FILE))
    return 0;
  if (!ReadSmI16Bin(path, PoliceMap, "police map"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POLICE_EFFECT_FILE))
    return 0;
  if (!ReadSmI16Bin(path, PoliceMapEffect, "police effect map"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, FIRE_RATE_FILE))
    return 0;
  if (!ReadSmI16Bin(path, FireRate, "fire-rate"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, COM_RATE_FILE))
    return 0;
  if (!ReadSmI16Bin(path, ComRate, "com-rate"))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POWER_FILE))
    return 0;
  if (!ReadPowerBin(path))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POWER_STACK_X_FILE))
    return 0;
  if (!ReadPowerStackBin(path, PowerStackX))
    return 0;

  if (!JoinPath(path, sizeof(path), stateDir, POWER_STACK_Y_FILE))
    return 0;
  if (!ReadPowerStackBin(path, PowerStackY))
    return 0;

  return 1;
}

static const char *FindArgValue(int argc, char **argv, const char *name)
{
  int i;
  size_t nameLen;

  nameLen = strlen(name);
  for (i = 2; i < argc; i++) {
    if (strcmp(argv[i], name) == 0) {
      if ((i + 1) >= argc) {
        return NULL;
      }
      return argv[i + 1];
    }
    if ((strncmp(argv[i], name, nameLen) == 0) && (argv[i][nameLen] == '=')) {
      return argv[i] + nameLen + 1;
    }
  }
  return NULL;
}

static int ParseLongArg(const char *raw, const char *name, long *out)
{
  char *end;
  long parsed;

  errno = 0;
  parsed = strtol(raw, &end, 10);
  if ((raw == end) || (errno != 0) || (*end != '\0')) {
    fprintf(stderr, "invalid %s: %s\n", name, raw);
    return 0;
  }
  *out = parsed;
  return 1;
}

static int ParseUIntArg(const char *raw, const char *name, uint32_t *out)
{
  char *end;
  unsigned long parsed;

  errno = 0;
  parsed = strtoul(raw, &end, 10);
  if ((raw == end) || (errno != 0) || (*end != '\0')) {
    fprintf(stderr, "invalid %s: %s\n", name, raw);
    return 0;
  }
  *out = (uint32_t)parsed;
  return 1;
}

static void PrintUsage(void)
{
  fprintf(stderr, "usage: micropolis-core-oracle <command> --state-dir <dir> [options]\n");
  fprintf(stderr, "commands:\n");
  fprintf(stderr, "  init-new-city [--seed <u32>] [--city-time <i64>] [--city-tax <i32>] [--sim-speed <i32>]\n");
  fprintf(stderr, "  load-cty --cty-path <path>\n");
  fprintf(stderr, "  step-phase --phase <0..15>\n");
  fprintf(stderr, "  step-tick [--start-phase <0..15>]\n");
  fprintf(stderr, "  step-realtime --ticks <non-negative i64>\n");
  fprintf(stderr, "  apply-tool --tool <name|id> --x <i32> --y <i32>\n");
  fprintf(stderr, "  make-traf --x <i32> --y <i32> --source <-1..2>\n");
  fprintf(stderr, "  do-power-scan\n");
  fprintf(stderr, "  send-messages\n");
  fprintf(stderr, "  collect-tax\n");
  fprintf(stderr, "  do-budget-now [--from-menu <0|1>]\n");
  fprintf(stderr, "  update-date\n");
  fprintf(stderr, "  do-message\n");
  fprintf(stderr, "  do-disasters\n");
  fprintf(stderr, "  snapshot\n");
}

int main(int argc, char **argv)
{
  const char *command;
  const char *stateDir;

  BindLayerPointers();

  if (argc < 2) {
    PrintUsage();
    return 2;
  }

  command = argv[1];
  stateDir = FindArgValue(argc, argv, "--state-dir");
  if (stateDir == NULL) {
    fprintf(stderr, "missing required --state-dir\n");
    return 2;
  }

  if (strcmp(command, "init-new-city") == 0) {
    const char *seedRaw;
    const char *cityTimeRaw;
    const char *cityTaxRaw;
    const char *simSpeedRaw;
    uint32_t seed;

    seed = 1u;
    seedRaw = FindArgValue(argc, argv, "--seed");
    cityTimeRaw = FindArgValue(argc, argv, "--city-time");
    cityTaxRaw = FindArgValue(argc, argv, "--city-tax");
    simSpeedRaw = FindArgValue(argc, argv, "--sim-speed");

    if ((seedRaw != NULL) && !ParseUIntArg(seedRaw, "--seed", &seed)) {
      return 2;
    }

    ResetStateDefaults(seed);

    if (cityTimeRaw != NULL) {
      long value;
      if (!ParseLongArg(cityTimeRaw, "--city-time", &value)) {
        return 2;
      }
      CityTime = (QUAD)value;
    }

    if (cityTaxRaw != NULL) {
      long value;
      if (!ParseLongArg(cityTaxRaw, "--city-tax", &value)) {
        return 2;
      }
      CityTax = (short)value;
    }

    if (simSpeedRaw != NULL) {
      long value;
      if (!ParseLongArg(simSpeedRaw, "--sim-speed", &value)) {
        return 2;
      }
      SimSpeed = (short)value;
    }

    if (!SaveStateDir(stateDir)) {
      return 1;
    }
    return 0;
  }

  if (!LoadStateDir(stateDir)) {
    return 1;
  }

  if (strcmp(command, "load-cty") == 0) {
    const char *ctyPathRaw;

    ctyPathRaw = FindArgValue(argc, argv, "--cty-path");
    if (ctyPathRaw == NULL) {
      fprintf(stderr, "load-cty requires --cty-path\n");
      return 2;
    }

    if (!LoadCtyFile(ctyPathRaw)) {
      return 1;
    }
    if (!SaveStateDir(stateDir)) {
      return 1;
    }
    return 0;
  }

  if (strcmp(command, "step-phase") == 0) {
    const char *phaseRaw;
    long phase;

    phaseRaw = FindArgValue(argc, argv, "--phase");
    if (phaseRaw == NULL) {
      fprintf(stderr, "missing required --phase\n");
      return 2;
    }
    if (!ParseLongArg(phaseRaw, "--phase", &phase)) {
      return 2;
    }

    Simulate((int)(phase & 15));

    if (!SaveStateDir(stateDir)) {
      return 1;
    }
    return 0;
  }

  if (strcmp(command, "step-tick") == 0) {
    const char *startRaw;
    long startPhase;
    int i;

    startPhase = 0;
    startRaw = FindArgValue(argc, argv, "--start-phase");
    if ((startRaw != NULL) && !ParseLongArg(startRaw, "--start-phase", &startPhase)) {
      return 2;
    }

    for (i = 0; i < 16; i++) {
      Simulate((int)((startPhase + i) & 15));
    }

    if (!SaveStateDir(stateDir)) {
      return 1;
    }
    return 0;
  }

  if (strcmp(command, "step-realtime") == 0) {
    const char *ticksRaw;
    long ticks;

    ticksRaw = FindArgValue(argc, argv, "--ticks");
    if (ticksRaw == NULL) {
      fprintf(stderr, "step-realtime requires --ticks\n");
      return 2;
    }
    if (!ParseLongArg(ticksRaw, "--ticks", &ticks)) {
      return 2;
    }
    if (!StepRealtimeTicks(ticks)) {
      fprintf(stderr, "step-realtime ticks must be non-negative\n");
      return 2;
    }

    if (!SaveStateDir(stateDir)) {
      return 1;
    }
    return 0;
  }

  if (strcmp(command, "apply-tool") == 0) {
    const char *toolRaw;
    const char *xRaw;
    const char *yRaw;
    long x;
    long y;
    short toolState;
    int result;

    toolRaw = FindArgValue(argc, argv, "--tool");
    xRaw = FindArgValue(argc, argv, "--x");
    yRaw = FindArgValue(argc, argv, "--y");
    if ((toolRaw == NULL) || (xRaw == NULL) || (yRaw == NULL)) {
      fprintf(stderr, "apply-tool requires --tool --x --y\n");
      return 2;
    }

    if (!ParseToolState(toolRaw, &toolState)) {
      fprintf(stderr, "invalid --tool value: %s\n", toolRaw);
      return 2;
    }
    if (!ParseLongArg(xRaw, "--x", &x) || !ParseLongArg(yRaw, "--y", &y)) {
      return 2;
    }

    result = DoToolByState(toolState, (short)x, (short)y);
    if (!SaveStateDir(stateDir)) {
      return 1;
    }

    printf("{\"code\":%d}\n", result);
    return 0;
  }

  if (strcmp(command, "make-traf") == 0) {
    const char *xRaw;
    const char *yRaw;
    const char *sourceRaw;
    long x;
    long y;
    long source;
    int result;

    xRaw = FindArgValue(argc, argv, "--x");
    yRaw = FindArgValue(argc, argv, "--y");
    sourceRaw = FindArgValue(argc, argv, "--source");
    if ((xRaw == NULL) || (yRaw == NULL) || (sourceRaw == NULL)) {
      fprintf(stderr, "make-traf requires --x --y --source\n");
      return 2;
    }

    if (!ParseLongArg(xRaw, "--x", &x) || !ParseLongArg(yRaw, "--y", &y) ||
        !ParseLongArg(sourceRaw, "--source", &source)) {
      return 2;
    }

    SMapX = (short)x;
    SMapY = (short)y;
    result = MakeTraf((int)source);

    if (!SaveStateDir(stateDir)) {
      return 1;
    }

    printf("{\"result\":%d}\n", result);
    return 0;
  }

  if (strcmp(command, "do-power-scan") == 0) {
    DoPowerScan();
    if (!SaveStateDir(stateDir)) {
      return 1;
    }
    return 0;
  }

  if (strcmp(command, "send-messages") == 0) {
    SendMessages();
    if (!SaveStateDir(stateDir)) {
      return 1;
    }
    return 0;
  }

  if (strcmp(command, "collect-tax") == 0) {
    CollectTax();
    if (!SaveStateDir(stateDir)) {
      return 1;
    }
    return 0;
  }

  if (strcmp(command, "do-budget-now") == 0) {
    const char *fromMenuRaw;
    long fromMenu;

    fromMenu = 0;
    fromMenuRaw = FindArgValue(argc, argv, "--from-menu");
    if ((fromMenuRaw != NULL) && !ParseLongArg(fromMenuRaw, "--from-menu", &fromMenu)) {
      return 2;
    }

    DoBudgetNow((int)fromMenu);
    if (!SaveStateDir(stateDir)) {
      return 1;
    }
    return 0;
  }

  if (strcmp(command, "update-date") == 0) {
    OracleUpdateDate();
    if (!SaveStateDir(stateDir)) {
      return 1;
    }
    return 0;
  }

  if (strcmp(command, "do-message") == 0) {
    doMessage();
    if (!SaveStateDir(stateDir)) {
      return 1;
    }
    return 0;
  }

  if (strcmp(command, "do-disasters") == 0) {
    DoDisasters();
    if (!SaveStateDir(stateDir)) {
      return 1;
    }
    return 0;
  }

  if (strcmp(command, "snapshot") == 0) {
    printf("{\n");
    printf("  \"snapshotVersion\": %d,\n", SNAPSHOT_VERSION);
    printf("  \"mapWords\": %d,\n", MAP_WORD_COUNT);
    printf("  \"trfBytes\": %d,\n", TRF_BYTE_COUNT);
    printf("  \"halfBytes\": %d,\n", HALF_BYTE_COUNT);
    printf("  \"quarterBytes\": %d,\n", QUARTER_BYTE_COUNT);
    printf("  \"rogWords\": %d,\n", ROG_WORD_COUNT);
    printf("  \"smallWords\": %d,\n", SMALL_WORD_COUNT);
    printf("  \"powerWords\": %d,\n", POWER_WORD_COUNT);
    printf("  \"powerStackBytes\": %d,\n", POWER_STACK_BYTE_COUNT);
    printf("  \"rngNext\": %u,\n", gRandNext);
    printf("  \"CityTime\": %lld,\n", (long long)CityTime);
    printf("  \"CityTax\": %d,\n", CityTax);
    printf("  \"AvCityTax\": %d,\n", AvCityTax);
    printf("  \"Scycle\": %d,\n", Scycle);
    printf("  \"Fcycle\": %d,\n", Fcycle);
    printf("  \"SimSpeed\": %d,\n", SimSpeed);
    printf("  \"CChr9\": %d,\n", CChr9);
    printf("  \"CoalPop\": %d,\n", CoalPop);
    printf("  \"NuclearPop\": %d,\n", NuclearPop);
    printf("  \"PwrdZCnt\": %d,\n", PwrdZCnt);
    printf("  \"unPwrdZCnt\": %d,\n", unPwrdZCnt);
    printf("  \"LVAverage\": %d,\n", LVAverage);
    printf("  \"CrimeAverage\": %d,\n", CrimeAverage);
    printf("  \"PolluteAverage\": %d,\n", PolluteAverage);
    printf("  \"CCx\": %d,\n", CCx);
    printf("  \"CCy\": %d,\n", CCy);
    printf("  \"CCx2\": %d,\n", CCx2);
    printf("  \"CCy2\": %d,\n", CCy2);
    printf("  \"PolMaxX\": %d,\n", PolMaxX);
    printf("  \"PolMaxY\": %d,\n", PolMaxY);
    printf("  \"CrimeMaxX\": %d,\n", CrimeMaxX);
    printf("  \"CrimeMaxY\": %d,\n", CrimeMaxY);
    printf("  \"PowerStackNum\": %d,\n", PowerStackNum);
    printf("  \"TrafMaxX\": %d,\n", TrafMaxX);
    printf("  \"TrafMaxY\": %d,\n", TrafMaxY);
    printf("  \"copControl\": %d,\n", gCopSprite.control);
    printf("  \"copDestX\": %d,\n", gCopSprite.dest_x);
    printf("  \"copDestY\": %d\n", gCopSprite.dest_y);
    printf("}\n");
    return 0;
  }

  fprintf(stderr, "unsupported command: %s\n", command);
  PrintUsage();
  return 2;
}
