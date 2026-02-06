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

#define SNAPSHOT_VERSION 1
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

/* --- Reference-sim globals required by s_traf.c and Simulate logic. --- */

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
short CityTax;
short AvCityTax;
short Scycle;
short Fcycle;
short DoInitialEval;
short NewPower;
QUAD CityTime;
short CoalPop;
short NuclearPop;
short PwrdZCnt;
short unPwrdZCnt;
short LVAverage;
short CrimeAverage;
short PolluteAverage;

/* s_traf.c defines these globals. */
extern short TrafMaxX;
extern short TrafMaxY;

static SimSprite gCopSprite;

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

/* --- No-op UI/system hooks for Simulate phase dispatch. --- */

void CityEvaluation(void) {}
void SetValves(void) {}
void TakeCensus(void) {}
void Take2Census(void) {}
void CollectTax(void) {}
void SendMessages(void) {}
void DoDisasters(void) {}
void SendMes(int id) { (void)id; }

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
  CityTax = 7;
  AvCityTax = 0;
  Scycle = 0;
  Fcycle = 0;
  SimSpeed = 3;
  DoInitialEval = 0;
  NewPower = 0;
  SMapX = 0;
  SMapY = 0;
  CChr = 0;
  CChr9 = 0;
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
  fprintf(file, "  \"CityTime\": %lld,\n", (long long)CityTime);
  fprintf(file, "  \"CityTax\": %d,\n", CityTax);
  fprintf(file, "  \"AvCityTax\": %d,\n", AvCityTax);
  fprintf(file, "  \"Scycle\": %d,\n", Scycle);
  fprintf(file, "  \"Fcycle\": %d,\n", Fcycle);
  fprintf(file, "  \"SimSpeed\": %d,\n", SimSpeed);
  fprintf(file, "  \"DoInitialEval\": %d,\n", DoInitialEval);
  fprintf(file, "  \"NewPower\": %d,\n", NewPower);
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

  if (!ReadWholeFile(path, &json)) {
    return 0;
  }

  if (!ParseJsonI64(json, "rngNext", &value)) {
    free(json);
    return 0;
  }
  gRandNext = (uint32_t)value;

  if (!ParseJsonI64(json, "CityTime", &value)) {
    free(json);
    return 0;
  }
  CityTime = (QUAD)value;

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
  fprintf(stderr, "  step-phase --phase <0..15>\n");
  fprintf(stderr, "  step-tick [--start-phase <0..15>]\n");
  fprintf(stderr, "  make-traf --x <i32> --y <i32> --source <-1..2>\n");
  fprintf(stderr, "  do-power-scan\n");
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
