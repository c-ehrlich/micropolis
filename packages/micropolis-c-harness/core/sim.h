#ifndef MICROPOLIS_CORE_ORACLE_SIM_H
#define MICROPOLIS_CORE_ORACLE_SIM_H

/*
 * Headless simulation shim for compiling reference Micropolis C logic.
 *
 * This header intentionally provides only the pieces required by:
 * - ref/micropolis/src/sim/s_traf.c
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

#define LOMASK 1023

#define ROADBASE 64
#define POWERBASE 208
#define RAILHPOWERV 221
#define LASTRAIL 238

#define LHTHR 249
#define COMBASE 423
#define PORT 698
#define NUCLEAR 816

#define TELEBASE 844
#define TELELAST 851

#define COP 2

#define ALMAP 0
#define REMAP 1
#define COMAP 2
#define INMAP 3
#define PRMAP 4
#define RDMAP 5
#define TDMAP 8
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
extern Byte *TrfDensity[HWLDX];
extern short RateOGMem[SmX][SmY];
extern short SMapX;
extern short SMapY;

extern short SimSpeed;
extern short CityTax;
extern short AvCityTax;
extern short Scycle;
extern short Fcycle;
extern short DoInitialEval;
extern short NewPower;
extern short NewMapFlags[NMAPS];
extern QUAD CityTime;

int Rand(int range);
int Rand16(void);
int MoveMapSim(short MDir);
SimSprite *GetSprite(int type);

void CityEvaluation(void);
void SetValves(void);
void ClearCensus(void);
void MapScan(int x1, int x2);
void TakeCensus(void);
void Take2Census(void);
void CollectTax(void);
void SendMessages(void);
void DoPowerScan(void);
void PTLScan(void);
void CrimeScan(void);
void PopDenScan(void);
void FireAnalysis(void);
void DoDisasters(void);

void DecTrafficMem(void);
void DecROGMem(void);
void Simulate(int mod16);
int MakeTraf(int Zt);

#endif
