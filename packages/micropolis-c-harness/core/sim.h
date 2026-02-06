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
#define BNCNBIT (BURNBIT | CONDBIT)

#define DIRT 0
#define RIVER 2
#define REDGE 3
#define CHANNEL 4
#define FIRSTRIVEDGE 5
#define LASTRIVEDGE 20
#define TREEBASE 21
#define LASTTREE 36
#define WOODS 37
#define WOODS2 40
#define WOODS3 41
#define WOODS4 42
#define WOODS5 43
#define RUBBLE 44
#define LASTRUBBLE 47
#define FLOOD 48
#define RADTILE 52
#define FIRE 56
#define FIREBASE 56

#define ROADBASE 64
#define HBRIDGE 64
#define VBRIDGE 65
#define ROADS 66
#define INTERSECTION 76
#define HROADPOWER 77
#define VROADPOWER 78
#define BRWH 79
#define LTRFBASE 80
#define BRWV 95
#define HTRFBASE 144
#define LASTROAD 206

#define POWERBASE 208
#define HPOWER 208
#define VPOWER 209
#define LHPOWER 210
#define LVPOWER 211
#define RAILHPOWERV 221
#define RAILVPOWERH 222
#define RAILBASE 224
#define HRAIL 224
#define VRAIL 225
#define LHRAIL 226
#define LVRAIL 227
#define HRAILROAD 237
#define VRAILROAD 238
#define LASTRAIL 238

#define RESBASE 240
#define FREEZ 244
#define LHTHR 249
#define HHTHR 260
#define RZB 265
#define HOSPITAL 409
#define CHURCH 418
#define COMBASE 423
#define COMCLR 427
#define CZB 436
#define INDBASE 612
#define INDCLR 616
#define LASTIND 620
#define IND1 621
#define IZB 625
#define IND2 641
#define IND3 644
#define IND4 649
#define IND5 650
#define IND6 676
#define IND7 677
#define IND8 686
#define IND9 689
#define PORTBASE 693
#define PORT 698
#define LASTPORT 708
#define AIRPORTBASE 709
#define AIRPORT 716
#define COALBASE 745
#define POWERPLANT 750
#define LASTPOWERPLANT 760
#define FIRESTBASE 761
#define FIRESTATION 765
#define POLICESTBASE 770
#define POLICESTATION 774
#define STADIUMBASE 779
#define STADIUM 784
#define FULLSTADIUM 800
#define NUCLEARBASE 811
#define NUCLEAR 816
#define LASTZONE 826

#define HBRDG0 828
#define HBRDG1 829
#define HBRDG2 830
#define HBRDG3 831

#define RADAR0 832
#define RADAR1 833
#define RADAR2 834
#define RADAR3 835
#define RADAR4 836
#define RADAR5 837
#define RADAR6 838
#define RADAR7 839

#define FOUNTAIN 840
#define TELEBASE 844
#define TELELAST 851
#define SMOKEBASE 852
#define TINYEXP 860
#define SOMETINYEXP 864
#define LASTTINYEXP 867

#define COALSMOKE1 916
#define COALSMOKE2 920
#define COALSMOKE3 924
#define COALSMOKE4 928
#define FOOTBALLGAME1 932
#define FOOTBALLGAME2 940

#define VBRDG0 948
#define VBRDG1 949
#define VBRDG2 950
#define VBRDG3 951

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
int ConnecTile(short x, short y, short *TileAdrPtr, short Command);

#endif
