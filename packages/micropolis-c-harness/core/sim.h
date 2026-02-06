#ifndef MICROPOLIS_CORE_ORACLE_SIM_H
#define MICROPOLIS_CORE_ORACLE_SIM_H

/*
 * Headless simulation shim for compiling reference Micropolis C logic.
 *
 * This header intentionally provides only the pieces required by:
 * - ref/micropolis/src/sim/s_traf.c
 * - ref/micropolis/src/sim/s_power.c
 *
 * Constants and macros mirror ref/micropolis/src/sim/headers/sim.h.
 */

#include <stdint.h>
#include <stddef.h>

#define TRUE 1
#define FALSE 0

#define WORLD_X 120
#define WORLD_Y 100
#define HWLDX (WORLD_X >> 1)
#define HWLDY (WORLD_Y >> 1)
#define SmX (WORLD_X >> 3)
#define SmY ((WORLD_Y + 7) >> 3)
#define QWX (WORLD_X >> 2)
#define QWY ((WORLD_Y + 3) >> 2)

#define POWERMAPROW ((WORLD_X + 15) / 16)
#define POWERMAPLEN 1700
#define POWERWORD(x, y) (((x) >> 4) + ((y) << 3))
#define SETPOWERBIT(x, y) PowerMap[POWERWORD((x), (y))] |= 1 << ((x)&15)
#define PWRMAPSIZE (POWERMAPROW * WORLD_Y)
#define PWRSTKSIZE ((WORLD_X * WORLD_Y) / 4)

#define PWRBIT 32768
#define CONDBIT 16384
#define BURNBIT 8192
#define BULLBIT 4096
#define ANIMBIT 2048
#define ZONEBIT 1024
#define LOMASK 1023

#define DIRT 0
#define RIVER 2
#define CHANNEL 4
#define FIRSTRIVEDGE 5
#define WOODS5 43
#define RUBBLE 44
#define FLOOD 48
#define RADTILE 52
#define FIRE 56
#define FIREBASE 56

#define ROADBASE 64
#define LTRFBASE 80
#define HTRFBASE 144
#define POWERBASE 208
#define RAILHPOWERV 221
#define RAILBASE 224
#define LASTRAIL 238
#define RESBASE 240
#define FREEZ 244

#define LHTHR 249
#define HHTHR 260
#define RZB 265
#define COMBASE 423
#define COMCLR 427
#define CZB 436
#define INDBASE 612
#define INDCLR 616
#define LASTIND 620
#define PORTBASE 693
#define IZB 625
#define LASTZONE 826
#define PORT 698
#define AIRPORT 716
#define POWERPLANT 750
#define LASTPOWERPLANT 760
#define NUCLEAR 816

#define TELEBASE 844
#define TELELAST 851
#define SOMETINYEXP 864
#define LASTTINYEXP 867

#define COP 2

#define ALMAP 0
#define REMAP 1
#define COMAP 2
#define INMAP 3
#define PRMAP 4
#define RDMAP 5
#define PDMAP 6
#define RGMAP 7
#define TDMAP 8
#define PLMAP 9
#define CRMAP 10
#define LVMAP 11
#define FIMAP 12
#define POMAP 13
#define DYMAP 14
#define NMAPS 15

#define CENSUSRATE 4
#define TAXFREQ 48

#define TestBounds(x, y) (((x) >= 0) && ((x) < WORLD_X) && ((y) >= 0) && ((y) < WORLD_Y))

typedef unsigned char Byte;
typedef int64_t QUAD;

typedef struct SimSprite {
  int control;
  int dest_x;
  int dest_y;
} SimSprite;

extern short *Map[WORLD_X];
extern Byte *PopDensity[HWLDX];
extern Byte *TrfDensity[HWLDX];
extern Byte *PollutionMem[HWLDX];
extern Byte *LandValueMem[HWLDX];
extern Byte *CrimeMem[HWLDX];
extern Byte *tem[HWLDX];
extern Byte *tem2[HWLDX];
extern Byte *TerrainMem[QWX];
extern Byte *Qtem[QWX];
extern short RateOGMem[SmX][SmY];
extern short FireStMap[SmX][SmY];
extern short PoliceMap[SmX][SmY];
extern short PoliceMapEffect[SmX][SmY];
extern short ComRate[SmX][SmY];
extern short FireRate[SmX][SmY];
extern short STem[SmX][SmY];
extern short SMapX;
extern short SMapY;
extern short CChr;
extern short CChr9;
extern short PowerMap[POWERMAPLEN];

extern QUAD TotalFunds;
extern short SimSpeed;
extern short GameLevel;
extern short TaxFlag;
extern short CityTax;
extern short AvCityTax;
extern short Scycle;
extern short Fcycle;
extern short DoInitialEval;
extern short NewPower;
extern short NewMap;
extern short MustUpdateOptions;
extern short NewMapFlags[NMAPS];
extern QUAD CityTime;
extern short StartingYear;
extern QUAD DonDither;
extern QUAD LastCityTime;
extern QUAD LastCityYear;
extern QUAD LastCityMonth;
extern QUAD LastFunds;
extern QUAD LastMesTime;
extern short LastPicNum;
extern short MessagePort;
extern short MesX;
extern short MesY;
extern short MesNum;
extern short autoGo;
extern short UserSoundOn;
extern short DoAnimation;
extern short DoMessages;
extern short DoNotices;
extern short ScenarioID;
extern short ScoreType;
extern short ScoreWait;
extern QUAD LastCityPop;
extern short LastCategory;
extern short CityClass;
extern short CityScore;
extern short TrafficAverage;
extern short CrimeAverage;
extern short PolluteAverage;
extern short ResPop;
extern short ComPop;
extern short IndPop;
extern short TotalPop;
extern short ResZPop;
extern short ComZPop;
extern short IndZPop;
extern short TotalZPop;
extern short StadiumPop;
extern short PortPop;
extern short APortPop;
extern short ResCap;
extern short ComCap;
extern short IndCap;
extern QUAD TaxFund;
extern QUAD RoadFund;
extern QUAD PoliceFund;
extern QUAD FireFund;
extern QUAD CashFlow;
extern QUAD RoadSpend;
extern QUAD PoliceSpend;
extern QUAD FireSpend;
extern short RoadTotal;
extern short RailTotal;
extern short RoadEffect;
extern short PoliceEffect;
extern short FireEffect;
extern short PolicePop;
extern short FireStPop;
extern short LVAverage;
extern float roadPercent;
extern float policePercent;
extern float firePercent;
extern short autoBudget;
extern short autoBulldoze;
extern short NoDisasters;
extern short DisasterEvent;
extern short DisasterWait;
extern short FloodCnt;
extern short FloodX;
extern short FloodY;
extern short CrashX;
extern short CrashY;
extern short CCx;
extern short CCy;
extern short CCx2;
extern short CCy2;
extern short CoalPop;
extern short NuclearPop;
extern short PwrdZCnt;
extern short unPwrdZCnt;
extern short PolMaxX;
extern short PolMaxY;
extern short CrimeMaxX;
extern short CrimeMaxY;
extern int PowerStackNum;
extern char PowerStackX[PWRSTKSIZE];
extern char PowerStackY[PWRSTKSIZE];

int Rand(int range);
int Rand16(void);
int MoveMapSim(short MDir);
SimSprite *GetSprite(int type);
int PushPowerStack(void);
int PullPowerStack(void);
int DoFreePop(int ch9);
int RZPop(int ch9);
int CZPop(int ch9);
int IZPop(int ch9);
QUAD TickCount(void);

void CityEvaluation(void);
void SetValves(void);
void ClearCensus(void);
void MapScan(int x1, int x2);
void TakeCensus(void);
void Take2Census(void);
void CollectTax(void);
void SendMessages(void);
int DoPowerScan(void);
int PTLScan(void);
int CrimeScan(void);
int PopDenScan(void);
int FireAnalysis(void);
void DoDisasters(void);
void SendMes(int id);
void SendMesAt(short id, short x, short y);
void ClearMes(void);
void DoLoseGame(void);
void DoWinGame(void);
void DoBudget(void);
void DoBudgetNow(int fromMenu);
void DoUpdateHeads(void);
void UpdateFunds(void);
void Spend(int dollars);
void SetFunds(int dollars);
void ShowBudgetWindowAndStartWaiting(void);
void drawBudgetWindow(void);
void drawCurrPercents(void);
void makeDollarDecimalStr(char *numStr, char *dollarStr);
void MakeTornado(void);
void MakeMonster(void);
void DropFireBombs(void);
void DoEarthQuake(void);
void DoMeltdown(short x, short y);
void FireZone(short x, short y, short tile);

void DecTrafficMem(void);
void DecROGMem(void);
void Simulate(int mod16);
int MakeTraf(int Zt);

#endif
