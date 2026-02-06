/*
 * Standalone Micropolis terrain harness.
 *
 * This file embeds a minimal subset of Micropolis C needed to run terrain
 * generation and dump the resulting map for parity testing against sim-core.
 *
 * Primary reference (1:1 port of logic in this harness):
 * - `ref/micropolis/src/sim/s_gen.c` (GenerateMap + helpers)
 * - `ref/micropolis/src/sim/s_sim.c` (Rand, Rand16, RandomlySeedRand, SeedRand)
 * - `ref/micropolis/src/sim/rand.c` (sim_rand, sim_srand)
 * - `ref/micropolis/src/sim/headers/macros.h` (TestBounds)
 * - `ref/micropolis/src/sim/headers/sim.h` (WORLD_X/WORLD_Y, tiles, status bits)
 */

#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>

/* World size: `WORLD_X/WORLD_Y` in `ref/micropolis/src/sim/headers/sim.h`. */
#define WORLD_X 120
#define WORLD_Y 100

/* Status bits: from `ref/micropolis/src/sim/headers/sim.h`. */
#define BURNBIT 8192
#define BULLBIT 4096
#define LOMASK 1023
#define BLBNBIT (BULLBIT + BURNBIT)

/* Tiles: subset from `ref/micropolis/src/sim/headers/sim.h`. */
#define DIRT 0
#define RIVER 2
#define REDGE 3
#define CHANNEL 4
#define FIRSTRIVEDGE 5
#define LASTRIVEDGE 20
#define TREEBASE 21
#define WOODS 37
#define UNUSED_TRASH2 39

/* `s_gen.c`-local constants */
#define WATER_LOW RIVER      /* 2 */
#define WATER_HIGH LASTRIVEDGE /* 20 */
#define WOODS_LOW TREEBASE   /* 21 */
#define WOODS_HIGH UNUSED_TRASH2 /* 39 */

/* `TestBounds` macro from `ref/micropolis/src/sim/headers/macros.h`. */
#define TestBounds(x, y) (((x) >= 0) && ((x) < WORLD_X) && ((y) >= 0) && ((y) < WORLD_Y))

/* Minimal RNG: matches `ref/micropolis/src/sim/rand.c`. */
#define SIM_RAND_MAX 0xffff
static uint32_t sim_rand_next = 1;

static int sim_rand(void)
{
  sim_rand_next = sim_rand_next * 1103515245u + 12345u;
  return (int)(((sim_rand_next % (((SIM_RAND_MAX + 1u) << 8u))) >> 8u) & 0xffffu);
}

static void sim_srand(uint32_t seed) { sim_rand_next = seed; }

/* `Rand`, `Rand16`, `SeedRand`, `RandomlySeedRand`: from `ref/micropolis/src/sim/s_sim.c`. */
#define RANDOM_RANGE 0xffff

static int Rand16(void) { return sim_rand(); }

static int Rand(int range)
{
  int maxMultiple, rnum;

  range++;
  maxMultiple = RANDOM_RANGE / range;
  maxMultiple *= range;
  while ((rnum = Rand16()) >= maxMultiple)
    continue;
  return (rnum % range);
}

static void SeedRand(int seed) { sim_srand((uint32_t)seed); }

static void RandomlySeedRand(void)
{
  struct timeval time;
  gettimeofday(&time, NULL);
  SeedRand((int)(time.tv_usec ^ time.tv_sec ^ sim_rand()));
}

/* Terrain globals: from `ref/micropolis/src/sim/s_gen.c`. */
static int TreeLevel = -1;
static int LakeLevel = -1;
static int CurveLevel = -1;
static int CreateIsland = -1;

static int XStart, YStart, MapX, MapY;
static int Dir, LastDir;

/* Map storage: equivalent to `Map[x][y]` column-major layout. */
static uint16_t Map[WORLD_X][WORLD_Y];

/* Forward decls (order matches original C where practical). */
static int ERand(int limit);
static void GenerateMap(int r);
static void ClearMap(void);
static void MakeNakedIsland(void);
static void MakeIsland(void);
static void MakeLakes(void);
static void GetRandStart(void);
static void MoveMap(int dir);
static void TreeSplash(int xloc, int yloc);
static void DoTrees(void);
static void SmoothRiver(void);
static int IsTree(int cell);
static void SmoothTrees(void);
static void DoRivers(void);
static void DoBRiv(void);
static void DoSRiv(void);
static void PutOnMap(int Mchar, int Xoff, int Yoff);
static void BRivPlop(void);
static void SRivPlop(void);
static void SmoothWater(void);

/* Op-mode dispatch values. */
typedef enum TerrainOp {
  TERRAIN_OP_NONE = 0,
  TERRAIN_OP_NOOP = 1,
} TerrainOp;

/* --- Begin: 1:1 terrain logic from `ref/micropolis/src/sim/s_gen.c` --- */

static int ERand(int limit)
{
  int x, z;

  z = Rand(limit);
  x = Rand(limit);
  if (z < x)
    return z;
  return x;
}

static void GenerateMap(int r)
{
  SeedRand(r);

  if (CreateIsland < 0) {
    if (Rand(100) < 10) { /* chance that island is generated */
      MakeIsland();
      return;
    }
  }
  if (CreateIsland == 1) {
    MakeNakedIsland();
  } else {
    ClearMap();
  }
  GetRandStart();
  if (CurveLevel != 0) {
    DoRivers();
  }
  if (LakeLevel != 0) {
    MakeLakes();
  }
  SmoothRiver();
  if (TreeLevel != 0) {
    DoTrees();
  }
  RandomlySeedRand();
}

static void ClearMap(void)
{
  int x, y;

  for (x = 0; x < WORLD_X; x++)
    for (y = 0; y < WORLD_Y; y++)
      Map[x][y] = DIRT;
}

#define RADIUS 18

static void MakeNakedIsland(void)
{
  int x, y;

  for (x = 0; x < WORLD_X; x++)
    for (y = 0; y < WORLD_Y; y++)
      Map[x][y] = RIVER;
  for (x = 5; x < WORLD_X - 5; x++)
    for (y = 5; y < WORLD_Y - 5; y++)
      Map[x][y] = DIRT;
  for (x = 0; x < WORLD_X - 5; x += 2) {
    MapX = x;
    MapY = ERand(RADIUS);
    BRivPlop();
    MapY = (WORLD_Y - 10) - ERand(RADIUS);
    BRivPlop();
    MapY = 0;
    SRivPlop();
    MapY = (WORLD_Y - 6);
    SRivPlop();
  }
  for (y = 0; y < WORLD_Y - 5; y += 2) {
    MapY = y;
    MapX = ERand(RADIUS);
    BRivPlop();
    MapX = (WORLD_X - 10) - ERand(RADIUS);
    BRivPlop();
    MapX = 0;
    SRivPlop();
    MapX = (WORLD_X - 6);
    SRivPlop();
  }
}

static void MakeIsland(void)
{
  MakeNakedIsland();
  SmoothRiver();
  DoTrees();
}

static void MakeLakes(void)
{
  int Lim1, Lim2, t, z;
  int x, y;

  if (LakeLevel < 0) {
    Lim1 = Rand(10);
  } else {
    Lim1 = LakeLevel / 2;
  }
  for (t = 0; t < Lim1; t++) {
    x = Rand(WORLD_X - 21) + 10;
    y = Rand(WORLD_Y - 20) + 10;
    Lim2 = Rand(12) + 2;
    for (z = 0; z < Lim2; z++) {
      MapX = x - 6 + Rand(12);
      MapY = y - 6 + Rand(12);
      if (Rand(4))
        SRivPlop();
      else
        BRivPlop();
    }
  }
}

static void GetRandStart(void)
{
  XStart = 40 + Rand(WORLD_X - 80);
  YStart = 33 + Rand(WORLD_Y - 67);
  MapX = XStart;
  MapY = YStart;
}

static void MoveMap(int dir)
{
  static int DirTab[2][8] = { {0, 1, 1, 1, 0, -1, -1, -1}, {-1, -1, 0, 1, 1, 1, 0, -1} };
  dir = dir & 7;
  MapX += DirTab[0][dir];
  MapY += DirTab[1][dir];
}

static void TreeSplash(int xloc, int yloc)
{
  int dis, dir;
  int z;

  if (TreeLevel < 0) {
    dis = Rand(150) + 50;
  } else {
    dis = Rand(100 + (TreeLevel * 2)) + 50;
  }
  MapX = xloc;
  MapY = yloc;
  for (z = 0; z < dis; z++) {
    dir = Rand(7);
    MoveMap(dir);
    if (!(TestBounds(MapX, MapY)))
      return;
    if ((Map[MapX][MapY] & LOMASK) == DIRT)
      Map[MapX][MapY] = WOODS + BLBNBIT;
  }
}

static void DoTrees(void)
{
  int Amount, x, xloc, yloc;

  if (TreeLevel < 0) {
    Amount = Rand(100) + 50;
  } else {
    Amount = TreeLevel + 3;
  }
  for (x = 0; x < Amount; x++) {
    xloc = Rand(WORLD_X - 1);
    yloc = Rand(WORLD_Y - 1);
    TreeSplash(xloc, yloc);
  }
  SmoothTrees();
  SmoothTrees();
}

static void SmoothRiver(void)
{
  static int DX[4] = {-1, 0, 1, 0};
  static int DY[4] = {0, 1, 0, -1};
  static int REdTab[16] = {13 + BULLBIT, 13 + BULLBIT, 17 + BULLBIT, 15 + BULLBIT,
                           5 + BULLBIT,  2,           19 + BULLBIT, 17 + BULLBIT,
                           9 + BULLBIT,  11 + BULLBIT, 2,           13 + BULLBIT,
                           7 + BULLBIT,  9 + BULLBIT,  5 + BULLBIT, 2};
  int bitindex, z, Xtem, Ytem;
  int temp, x, y;

  for (x = 0; x < WORLD_X; x++) {
    for (y = 0; y < WORLD_Y; y++) {
      if (Map[x][y] == REDGE) {
        bitindex = 0;
        for (z = 0; z < 4; z++) {
          bitindex = bitindex << 1;
          Xtem = x + DX[z];
          Ytem = y + DY[z];
          if (TestBounds(Xtem, Ytem) && ((Map[Xtem][Ytem] & LOMASK) != DIRT) &&
              (((Map[Xtem][Ytem] & LOMASK) < WOODS_LOW) || ((Map[Xtem][Ytem] & LOMASK) > WOODS_HIGH)))
            bitindex++;
        }
        temp = REdTab[bitindex & 15];
        if ((temp != RIVER) && (Rand(1)))
          temp++;
        Map[x][y] = (uint16_t)temp;
      }
    }
  }
}

static int IsTree(int cell)
{
  if (((cell & LOMASK) >= WOODS_LOW) && ((cell & LOMASK) <= WOODS_HIGH))
    return 1;
  return 0;
}

static void SmoothTrees(void)
{
  static int DX[4] = {-1, 0, 1, 0};
  static int DY[4] = {0, 1, 0, -1};
  static int TEdTab[16] = {0, 0, 0, 34, 0, 0, 36, 35, 0, 32, 0, 33, 30, 31, 29, 37};
  int bitindex, z, Xtem, Ytem;
  int temp, x, y;

  for (x = 0; x < WORLD_X; x++) {
    for (y = 0; y < WORLD_Y; y++) {
      if (IsTree(Map[x][y])) {
        bitindex = 0;
        for (z = 0; z < 4; z++) {
          bitindex = bitindex << 1;
          Xtem = x + DX[z];
          Ytem = y + DY[z];
          if (TestBounds(Xtem, Ytem) && IsTree(Map[Xtem][Ytem])) {
            bitindex++;
          }
        }
        temp = TEdTab[bitindex & 15];
        if (temp) {
          if (temp != WOODS)
            if ((x + y) & 1)
              temp = temp - 8;
          Map[x][y] = (uint16_t)(temp + BLBNBIT);
        } else
          Map[x][y] = (uint16_t)temp;
      }
    }
  }
}

static void DoRivers(void)
{
  LastDir = Rand(3);
  Dir = LastDir;
  DoBRiv();
  MapX = XStart;
  MapY = YStart;
  LastDir = LastDir ^ 4;
  Dir = LastDir;
  DoBRiv();
  MapX = XStart;
  MapY = YStart;
  LastDir = Rand(3);
  DoSRiv();
}

static void DoBRiv(void)
{
  int r1, r2;

  if (CurveLevel < 0) {
    r1 = 100;
    r2 = 200;
  } else {
    r1 = CurveLevel + 10;
    r2 = CurveLevel + 100;
  }

  while (TestBounds(MapX + 4, MapY + 4)) {
    BRivPlop();
    if (Rand(r1) < 10) {
      Dir = LastDir;
    } else {
      if (Rand(r2) > 90)
        Dir++;
      if (Rand(r2) > 90)
        Dir--;
    }
    MoveMap(Dir);
  }
}

static void DoSRiv(void)
{
  int r1, r2;

  if (CurveLevel < 0) {
    r1 = 100;
    r2 = 200;
  } else {
    r1 = CurveLevel + 10;
    r2 = CurveLevel + 100;
  }

  while (TestBounds(MapX + 3, MapY + 3)) {
    SRivPlop();
    if (Rand(r1) < 10) {
      Dir = LastDir;
    } else {
      if (Rand(r2) > 90)
        Dir++;
      if (Rand(r2) > 90)
        Dir--;
    }
    MoveMap(Dir);
  }
}

static void PutOnMap(int Mchar, int Xoff, int Yoff)
{
  int Xloc, Yloc;
  int temp;

  if (Mchar == 0)
    return;
  Xloc = MapX + Xoff;
  Yloc = MapY + Yoff;
  if (TestBounds(Xloc, Yloc) == 0)
    return;
  if ((temp = Map[Xloc][Yloc])) {
    temp = temp & LOMASK;
    if (temp == RIVER)
      if (Mchar != CHANNEL)
        return;
    if (temp == CHANNEL)
      return;
  }
  Map[Xloc][Yloc] = (uint16_t)Mchar;
}

static void BRivPlop(void)
{
  static int BRMatrix[9][9] = {{0, 0, 0, 3, 3, 3, 0, 0, 0}, {0, 0, 3, 2, 2, 2, 3, 0, 0},
                               {0, 3, 2, 2, 2, 2, 2, 3, 0}, {3, 2, 2, 2, 2, 2, 2, 2, 3},
                               {3, 2, 2, 2, 4, 2, 2, 2, 3}, {3, 2, 2, 2, 2, 2, 2, 2, 3},
                               {0, 3, 2, 2, 2, 2, 2, 3, 0}, {0, 0, 3, 2, 2, 2, 3, 0, 0},
                               {0, 0, 0, 3, 3, 3, 0, 0, 0}};
  int x, y;

  for (x = 0; x < 9; x++)
    for (y = 0; y < 9; y++)
      PutOnMap(BRMatrix[y][x], x, y);
}

static void SRivPlop(void)
{
  static int SRMatrix[6][6] = {{0, 0, 3, 3, 0, 0}, {0, 3, 2, 2, 3, 0}, {3, 2, 2, 2, 2, 3},
                               {3, 2, 2, 2, 2, 3}, {0, 3, 2, 2, 3, 0}, {0, 0, 3, 3, 0, 0}};
  int x, y;

  for (x = 0; x < 6; x++)
    for (y = 0; y < 6; y++)
      PutOnMap(SRMatrix[y][x], x, y);
}

static void SmoothWater(void)
{
  int x, y;

  for (x = 0; x < WORLD_X; x++) {
    for (y = 0; y < WORLD_Y; y++) {
      /* If water: */
      if (((Map[x][y] & LOMASK) >= WATER_LOW) && ((Map[x][y] & LOMASK) <= WATER_HIGH)) {
        if (x > 0) {
          /* If nearest object is not water: */
          if (((Map[x - 1][y] & LOMASK) < WATER_LOW) || ((Map[x - 1][y] & LOMASK) > WATER_HIGH)) {
            goto edge;
          }
        }
        if (x < (WORLD_X - 1)) {
          /* If nearest object is not water: */
          if (((Map[x + 1][y] & LOMASK) < WATER_LOW) || ((Map[x + 1][y] & LOMASK) > WATER_HIGH)) {
            goto edge;
          }
        }
        if (y > 0) {
          /* If nearest object is not water: */
          if (((Map[x][y - 1] & LOMASK) < WATER_LOW) || ((Map[x][y - 1] & LOMASK) > WATER_HIGH)) {
            goto edge;
          }
        }
        if (y < (WORLD_Y - 1)) {
          /* If nearest object is not water: */
          if (((Map[x][y + 1] & LOMASK) < WATER_LOW) || ((Map[x][y + 1] & LOMASK) > WATER_HIGH)) {
          edge:
            Map[x][y] = REDGE; /* set river edge */
            continue;
          }
        }
      }
    }
  }
  for (x = 0; x < WORLD_X; x++) {
    for (y = 0; y < WORLD_Y; y++) {
      /* If water which is not a channel: */
      if (((Map[x][y] & LOMASK) != CHANNEL) && ((Map[x][y] & LOMASK) >= WATER_LOW) &&
          ((Map[x][y] & LOMASK) <= WATER_HIGH)) {
        if (x > 0) {
          /* If nearest object is not water; */
          if (((Map[x - 1][y] & LOMASK) < WATER_LOW) || ((Map[x - 1][y] & LOMASK) > WATER_HIGH)) {
            continue;
          }
        }
        if (x < (WORLD_X - 1)) {
          /* If nearest object is not water: */
          if (((Map[x + 1][y] & LOMASK) < WATER_LOW) || ((Map[x + 1][y] & LOMASK) > WATER_HIGH)) {
            continue;
          }
        }
        if (y > 0) {
          /* If nearest object is not water: */
          if (((Map[x][y - 1] & LOMASK) < WATER_LOW) || ((Map[x][y - 1] & LOMASK) > WATER_HIGH)) {
            continue;
          }
        }
        if (y < (WORLD_Y - 1)) {
          /* If nearest object is not water: */
          if (((Map[x][y + 1] & LOMASK) < WATER_LOW) || ((Map[x][y + 1] & LOMASK) > WATER_HIGH)) {
            continue;
          }
        }
        Map[x][y] = RIVER; /* make it a river */
      }
    }
  }
  for (x = 0; x < WORLD_X; x++) {
    for (y = 0; y < WORLD_Y; y++) {
      /* If woods: */
      if (((Map[x][y] & LOMASK) >= WOODS_LOW) && ((Map[x][y] & LOMASK) <= WOODS_HIGH)) {
        if (x > 0) {
          /* If nearest object is water: */
          if ((Map[x - 1][y] == RIVER) || (Map[x - 1][y] == CHANNEL)) {
            Map[x][y] = REDGE; /* make it water's edge */
            continue;
          }
        }
        if (x < (WORLD_X - 1)) {
          /* If nearest object is water: */
          if ((Map[x + 1][y] == RIVER) || (Map[x + 1][y] == CHANNEL)) {
            Map[x][y] = REDGE; /* make it water's edge */
            continue;
          }
        }
        if (y > 0) {
          /* If nearest object is water: */
          if ((Map[x][y - 1] == RIVER) || (Map[x][y - 1] == CHANNEL)) {
            Map[x][y] = REDGE; /* make it water's edge */
            continue;
          }
        }
        if (y < (WORLD_Y - 1)) {
          /* If nearest object is water; */
          if ((Map[x][y + 1] == RIVER) || (Map[x][y + 1] == CHANNEL)) {
            Map[x][y] = REDGE; /* make it water's edge */
            continue;
          }
        }
      }
    }
  }
}

/* --- End: 1:1 terrain logic from `ref/micropolis/src/sim/s_gen.c` --- */

static void usage(FILE *out)
{
  fprintf(out,
          "micropolis-terrain-harness\\n"
          "default mode (GenerateMap):\\n"
          "  --seed <u32>\\n"
          "  --treeLevel <i32>\\n"
          "  --lakeLevel <i32>\\n"
          "  --curveLevel <i32>\\n"
          "  --createIsland <i32>\\n"
          "  [--runSmoothWater] (default: off)\\n"
          "op mode:\\n"
          "  --op <name>\\n"
          "  --input-map <path>\\n"
          "  op names: noop\\n"
          "  [--format u16le|json] (default: u16le)\\n"
          "  [--dump-path <path>] (default: stdout)\\n");
}

static int parse_i32(const char *s, int *out)
{
  char *end = NULL;
  long v = strtol(s, &end, 10);
  if (s[0] == '\0' || end == NULL || *end != '\0')
    return 0;
  if (v < (-2147483647L - 1L) || v > 2147483647L)
    return 0;
  *out = (int)v;
  return 1;
}

static int parse_u32(const char *s, uint32_t *out)
{
  char *end = NULL;
  unsigned long v = strtoul(s, &end, 10);
  if (s[0] == '\0' || end == NULL || *end != '\0')
    return 0;
  if (v > 0xfffffffful)
    return 0;
  *out = (uint32_t)v;
  return 1;
}

static const char *arg_value(const char *arg, const char *prefix)
{
  size_t n = strlen(prefix);
  if (strncmp(arg, prefix, n) != 0)
    return NULL;
  return arg + n;
}

static int write_u16le(FILE *f)
{
  int x, y;
  for (x = 0; x < WORLD_X; x++) {
    for (y = 0; y < WORLD_Y; y++) {
      uint16_t v = Map[x][y];
      uint8_t b[2] = {(uint8_t)(v & 0xffu), (uint8_t)((v >> 8u) & 0xffu)};
      if (fwrite(b, 1, 2, f) != 2)
        return 0;
    }
  }
  return 1;
}

/**
 * Loads a map dump in x-major `u16le` order into `Map[x][y]`.
 *
 * This mirrors the harness output ordering and Micropolis terrain storage
 * (`Map[x][y]`) from `ref/micropolis/src/sim/s_gen.c`.
 */
static int read_u16le(FILE *f)
{
  int x, y;
  for (x = 0; x < WORLD_X; x++) {
    for (y = 0; y < WORLD_Y; y++) {
      uint8_t b[2];
      if (fread(b, 1, 2, f) != 2)
        return 0;
      Map[x][y] = (uint16_t)(((uint16_t)b[1] << 8u) | (uint16_t)b[0]);
    }
  }
  return 1;
}

static int load_map_from_path(const char *input_map_path)
{
  FILE *in = fopen(input_map_path, "rb");
  if (in == NULL) {
    fprintf(stderr, "failed to open input map '%s': %s\n", input_map_path, strerror(errno));
    return 0;
  }

  if (!read_u16le(in)) {
    if (ferror(in)) {
      fprintf(stderr, "failed to read input map '%s': %s\n", input_map_path, strerror(errno));
    } else {
      fprintf(stderr,
              "input map '%s' is too short: expected exactly %d bytes\n",
              input_map_path,
              WORLD_X * WORLD_Y * 2);
    }
    fclose(in);
    return 0;
  }

  if (fgetc(in) != EOF) {
    fprintf(stderr,
            "input map '%s' has extra bytes: expected exactly %d bytes\n",
            input_map_path,
            WORLD_X * WORLD_Y * 2);
    fclose(in);
    return 0;
  }

  fclose(in);
  return 1;
}

static int parse_op(const char *name, TerrainOp *out)
{
  if (strcmp(name, "noop") == 0) {
    *out = TERRAIN_OP_NOOP;
    return 1;
  }
  return 0;
}

static int run_op(TerrainOp op)
{
  switch (op) {
  case TERRAIN_OP_NOOP:
    /* Intentionally does nothing: map is loaded and emitted unchanged. */
    return 1;
  case TERRAIN_OP_NONE:
  default:
    return 0;
  }
}

static int write_json(FILE *f)
{
  int x, y;
  fprintf(f, "{\"width\":%d,\"height\":%d,\"order\":\"x-major\",\"tiles\":[", WORLD_X, WORLD_Y);
  for (x = 0; x < WORLD_X; x++) {
    if (x != 0)
      fputc(',', f);
    fputc('[', f);
    for (y = 0; y < WORLD_Y; y++) {
      if (y != 0)
        fputc(',', f);
      fprintf(f, "%u", (unsigned)Map[x][y]);
    }
    fputc(']', f);
  }
  fprintf(f, "]}\n");
  return 1;
}

int main(int argc, char **argv)
{
  uint32_t seed_u32 = 0;
  int have_seed = 0;
  int have_tree = 0, have_lake = 0, have_curve = 0, have_island = 0;
  int have_op = 0;
  int run_smooth_water = 0;
  const char *format = "u16le";
  const char *dump_path = NULL;
  const char *op_name = NULL;
  const char *input_map_path = NULL;

  int i = 1;
  while (i < argc) {
    const char *a = argv[i];
    if (strcmp(a, "--help") == 0 || strcmp(a, "-h") == 0) {
      usage(stdout);
      return 0;
    }

    const char *v = NULL;
    if ((v = arg_value(a, "--seed=")) != NULL) {
      have_seed = parse_u32(v, &seed_u32);
    } else if (strcmp(a, "--seed") == 0 && i + 1 < argc) {
      have_seed = parse_u32(argv[++i], &seed_u32);
    } else if ((v = arg_value(a, "--treeLevel=")) != NULL) {
      have_tree = parse_i32(v, &TreeLevel);
    } else if (strcmp(a, "--treeLevel") == 0 && i + 1 < argc) {
      have_tree = parse_i32(argv[++i], &TreeLevel);
    } else if ((v = arg_value(a, "--lakeLevel=")) != NULL) {
      have_lake = parse_i32(v, &LakeLevel);
    } else if (strcmp(a, "--lakeLevel") == 0 && i + 1 < argc) {
      have_lake = parse_i32(argv[++i], &LakeLevel);
    } else if ((v = arg_value(a, "--curveLevel=")) != NULL) {
      have_curve = parse_i32(v, &CurveLevel);
    } else if (strcmp(a, "--curveLevel") == 0 && i + 1 < argc) {
      have_curve = parse_i32(argv[++i], &CurveLevel);
    } else if ((v = arg_value(a, "--createIsland=")) != NULL) {
      have_island = parse_i32(v, &CreateIsland);
    } else if (strcmp(a, "--createIsland") == 0 && i + 1 < argc) {
      have_island = parse_i32(argv[++i], &CreateIsland);
    } else if ((v = arg_value(a, "--format=")) != NULL) {
      format = v;
    } else if (strcmp(a, "--format") == 0 && i + 1 < argc) {
      format = argv[++i];
    } else if ((v = arg_value(a, "--dump-path=")) != NULL) {
      dump_path = v;
    } else if (strcmp(a, "--dump-path") == 0 && i + 1 < argc) {
      dump_path = argv[++i];
    } else if ((v = arg_value(a, "--op=")) != NULL) {
      op_name = v;
      have_op = 1;
    } else if (strcmp(a, "--op") == 0 && i + 1 < argc) {
      op_name = argv[++i];
      have_op = 1;
    } else if ((v = arg_value(a, "--input-map=")) != NULL) {
      input_map_path = v;
    } else if (strcmp(a, "--input-map") == 0 && i + 1 < argc) {
      input_map_path = argv[++i];
    } else if (strcmp(a, "--runSmoothWater") == 0) {
      run_smooth_water = 1;
    } else {
      fprintf(stderr, "unknown arg: %s\n", a);
      usage(stderr);
      return 2;
    }

    if ((!have_seed && (strncmp(a, "--seed", 6) == 0)) || (!have_tree && strncmp(a, "--treeLevel", 11) == 0) ||
        (!have_lake && strncmp(a, "--lakeLevel", 11) == 0) || (!have_curve && strncmp(a, "--curveLevel", 12) == 0) ||
        (!have_island && strncmp(a, "--createIsland", 14) == 0)) {
      fprintf(stderr, "invalid value for arg: %s\n", a);
      return 2;
    }

    i++;
  }

  if (have_op) {
    TerrainOp op = TERRAIN_OP_NONE;
    if (op_name == NULL || op_name[0] == '\0') {
      fprintf(stderr, "missing value for --op\n");
      usage(stderr);
      return 2;
    }
    if (!parse_op(op_name, &op)) {
      fprintf(stderr, "unknown op: %s\n", op_name);
      usage(stderr);
      return 2;
    }
    if (input_map_path == NULL || input_map_path[0] == '\0') {
      fprintf(stderr, "missing required --input-map for --op mode\n");
      usage(stderr);
      return 2;
    }
    if (run_smooth_water) {
      fprintf(stderr, "--runSmoothWater is only valid in default GenerateMap mode\n");
      return 2;
    }
    if (!load_map_from_path(input_map_path)) {
      return 1;
    }
    if (!run_op(op)) {
      fprintf(stderr, "failed to run op: %s\n", op_name);
      return 1;
    }
  } else {
    if (!have_seed || !have_tree || !have_lake || !have_curve || !have_island) {
      fprintf(stderr, "missing required args\n");
      usage(stderr);
      return 2;
    }

    GenerateMap((int)seed_u32);
    if (run_smooth_water) {
      /* `SmoothWater()` exists in `ref/micropolis/src/sim/s_gen.c` but is not called by `GenerateMap`. */
      SmoothWater();
    }
  }

  FILE *out = stdout;
  if (dump_path != NULL) {
    out = fopen(dump_path, "wb");
    if (out == NULL) {
      fprintf(stderr, "failed to open dump path '%s': %s\n", dump_path, strerror(errno));
      return 1;
    }
  }

  int ok = 0;
  if (strcmp(format, "u16le") == 0) {
    ok = write_u16le(out);
  } else if (strcmp(format, "json") == 0) {
    ok = write_json(out);
  } else {
    fprintf(stderr, "unknown format: %s\n", format);
    ok = 0;
  }

  if (dump_path != NULL) {
    fclose(out);
  }

  return ok ? 0 : 1;
}
