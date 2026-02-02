// Classic map dimensions (tiles).
export const WORLD_X = 120;
export const WORLD_Y = 100;

// Half-resolution grids (2x2 tiles).
export const HWLDX = WORLD_X >> 1;
export const HWLDY = WORLD_Y >> 1;
// Quarter-resolution grids (4x4 tiles).
export const QWX = WORLD_X >> 2;
export const QWY = WORLD_Y >> 2;
// Eighth-resolution grids (8x8 tiles, Y rounds up).
export const SmX = WORLD_X >> 3;
export const SmY = (WORLD_Y + 7) >> 3;

// Power map bitset layout (16 tiles per word).
export const POWERMAPROW = (WORLD_X + 15) >> 4;
export const PWRMAPSIZE = POWERMAPROW * WORLD_Y;
// Allocated size in the original; only first PWRMAPSIZE words are used.
export const POWERMAPLEN = 1700;

// Tile ID mask (low 10 bits) and flag mask (high 6 bits).
export const CHAR_MASK = 0x03ff;
export const LOMASK = CHAR_MASK;
export const ALLBITS = 0xfc00;

// Tile status bit flags (stored in high 6 bits).
export const PWRBIT = 0x8000;
export const CONDBIT = 0x4000;
export const BURNBIT = 0x2000;
export const BULLBIT = 0x1000;
export const ANIMBIT = 0x0800;
export const ZONEBIT = 0x0400;

// Tile ID constants (low 10 bits).
export const DIRT = 0;
export const RIVER = 2;
export const REDGE = 3;
export const CHANNEL = 4;
export const FIRSTRIVEDGE = 5;
export const LASTRIVEDGE = 20;
export const TREEBASE = 21;
export const LASTTREE = 36;
export const WOODS = 37;
export const WOODS2 = 40;
export const WOODS3 = 41;
export const WOODS4 = 42;
export const WOODS5 = 43;
export const RUBBLE = 44;
export const LASTRUBBLE = 47;
export const FLOOD = 48;
export const LASTFLOOD = 51;
export const RADTILE = 52;
export const FIRE = 56;
export const FIREBASE = 56;
export const LASTFIRE = 63;

export const ROADBASE = 64;
export const HBRIDGE = 64;
export const VBRIDGE = 65;
export const ROADS = 66;
export const INTERSECTION = 76;
export const HROADPOWER = 77;
export const VROADPOWER = 78;
export const BRWH = 79;
export const LTRFBASE = 80;
export const BRWV = 95;
export const HTRFBASE = 144;
export const LASTROAD = 206;

export const POWERBASE = 208;
export const HPOWER = 208;
export const VPOWER = 209;
export const LHPOWER = 210;
export const LVPOWER = 211;
export const RAILHPOWERV = 221;
export const RAILVPOWERH = 222;
export const LASTPOWER = 222;

export const RAILBASE = 224;
export const HRAIL = 224;
export const VRAIL = 225;
export const LHRAIL = 226;
export const LVRAIL = 227;
export const HRAILROAD = 237;
export const VRAILROAD = 238;
export const LASTRAIL = 238;
export const ROADVPOWERH = 239;

export const RESBASE = 240;
export const FREEZ = 244;
export const HOUSE = 249;
export const LHTHR = 249;
export const HHTHR = 260;
export const RZB = 265;
export const HOSPITAL = 409;
export const CHURCH = 418;
export const COMBASE = 423;
export const COMCLR = 427;
export const CZB = 436;
export const INDBASE = 612;
export const INDCLR = 616;
export const IZB = 625;
export const PORTBASE = 693;
export const PORT = 698;
export const LASTPORT = 708;
export const AIRPORTBASE = 709;
export const RADAR = 711;
export const AIRPORT = 716;
export const COALBASE = 745;
export const POWERPLANT = 750;
export const LASTPOWERPLANT = 760;
export const FIRESTBASE = 761;
export const FIRESTATION = 765;
export const POLICESTBASE = 770;
export const POLICESTATION = 774;
export const STADIUMBASE = 779;
export const STADIUM = 784;
export const FULLSTADIUM = 800;
export const NUCLEARBASE = 811;
export const NUCLEAR = 816;
export const LASTZONE = 826;

export const HBRDG0 = 828;
export const HBRDG1 = 829;
export const HBRDG2 = 830;
export const HBRDG3 = 831;

export const RADAR0 = 832;
export const RADAR1 = 833;
export const RADAR2 = 834;
export const RADAR3 = 835;
export const RADAR4 = 836;
export const RADAR5 = 837;
export const RADAR6 = 838;
export const RADAR7 = 839;

export const FOUNTAIN = 840;
export const TELEBASE = 844;
export const TELELAST = 851;
export const SMOKEBASE = 852;
export const TINYEXP = 860;
export const SOMETINYEXP = 864;
export const LASTTINYEXP = 867;

export const COALSMOKE1 = 916;
export const COALSMOKE2 = 920;
export const COALSMOKE3 = 924;
export const COALSMOKE4 = 928;
export const FOOTBALLGAME1 = 932;
export const FOOTBALLGAME2 = 940;

export const VBRDG0 = 948;
export const VBRDG1 = 949;
export const VBRDG2 = 950;
export const VBRDG3 = 951;

export const TILE_COUNT = 960;

export const Tile = {
  DIRT,
  RIVER,
  REDGE,
  CHANNEL,
  FIRSTRIVEDGE,
  LASTRIVEDGE,
  TREEBASE,
  LASTTREE,
  WOODS,
  WOODS2,
  WOODS3,
  WOODS4,
  WOODS5,
  RUBBLE,
  LASTRUBBLE,
  FLOOD,
  LASTFLOOD,
  RADTILE,
  FIRE,
  FIREBASE,
  LASTFIRE,
  ROADBASE,
  HBRIDGE,
  VBRIDGE,
  ROADS,
  INTERSECTION,
  HROADPOWER,
  VROADPOWER,
  BRWH,
  LTRFBASE,
  BRWV,
  HTRFBASE,
  LASTROAD,
  POWERBASE,
  HPOWER,
  VPOWER,
  LHPOWER,
  LVPOWER,
  RAILHPOWERV,
  RAILVPOWERH,
  LASTPOWER,
  RAILBASE,
  HRAIL,
  VRAIL,
  LHRAIL,
  LVRAIL,
  HRAILROAD,
  VRAILROAD,
  LASTRAIL,
  ROADVPOWERH,
  RESBASE,
  FREEZ,
  HOUSE,
  LHTHR,
  HHTHR,
  RZB,
  HOSPITAL,
  CHURCH,
  COMBASE,
  COMCLR,
  CZB,
  INDBASE,
  INDCLR,
  IZB,
  PORTBASE,
  PORT,
  LASTPORT,
  AIRPORTBASE,
  RADAR,
  AIRPORT,
  COALBASE,
  POWERPLANT,
  LASTPOWERPLANT,
  FIRESTBASE,
  FIRESTATION,
  POLICESTBASE,
  POLICESTATION,
  STADIUMBASE,
  STADIUM,
  FULLSTADIUM,
  NUCLEARBASE,
  NUCLEAR,
  LASTZONE,
  HBRDG0,
  HBRDG1,
  HBRDG2,
  HBRDG3,
  RADAR0,
  RADAR1,
  RADAR2,
  RADAR3,
  RADAR4,
  RADAR5,
  RADAR6,
  RADAR7,
  FOUNTAIN,
  TELEBASE,
  TELELAST,
  SMOKEBASE,
  TINYEXP,
  SOMETINYEXP,
  LASTTINYEXP,
  COALSMOKE1,
  COALSMOKE2,
  COALSMOKE3,
  COALSMOKE4,
  FOOTBALLGAME1,
  FOOTBALLGAME2,
  VBRDG0,
  VBRDG1,
  VBRDG2,
  VBRDG3,
  TILE_COUNT,
} as const;

export type TileId = (typeof Tile)[keyof typeof Tile];
