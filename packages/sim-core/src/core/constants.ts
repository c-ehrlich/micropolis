// Classic map dimensions (tiles).
const WORLD_X = 120;
const WORLD_Y = 100;

// Half-resolution grids (2x2 tiles).
const HWLDX = WORLD_X >> 1;
const HWLDY = WORLD_Y >> 1;
// Quarter-resolution grids (4x4 tiles).
const QWX = WORLD_X >> 2;
const QWY = WORLD_Y >> 2;
// Eighth-resolution grids (8x8 tiles, Y rounds up).
const SmX = WORLD_X >> 3;
const SmY = (WORLD_Y + 7) >> 3;

export const World = {
  WORLD_X,
  WORLD_Y,
  HWLDX,
  HWLDY,
  QWX,
  QWY,
  SmX,
  SmY,
} as const;

// Power map bitset layout (16 tiles per word).
const POWERMAPROW = (WORLD_X + 15) >> 4;
const PWRMAPSIZE = POWERMAPROW * WORLD_Y;
// Allocated size in the original; only first PWRMAPSIZE words are used.
const POWERMAPLEN = 1700;
const PWRSTKSIZE = (WORLD_X * WORLD_Y) >> 2;

export const PowerMap = {
  POWERMAPROW,
  PWRMAPSIZE,
  POWERMAPLEN,
  PWRSTKSIZE,
} as const;

// Tile ID mask (low 10 bits) and flag mask (high 6 bits).
const CHAR_MASK = 0x03ff;
const LOMASK = CHAR_MASK;
const ALLBITS = 0xfc00;

export const TileMask = {
  CHAR_MASK,
  LOMASK,
  ALLBITS,
} as const;

// Tile status bit flags (stored in high 6 bits).
const PWRBIT = 0x8000;
const CONDBIT = 0x4000;
const BURNBIT = 0x2000;
const BULLBIT = 0x1000;
const ANIMBIT = 0x0800;
const ZONEBIT = 0x0400;
const BLBNBIT = BULLBIT + BURNBIT;
const BLBNCNBIT = BULLBIT + BURNBIT + CONDBIT;
const BNCNBIT = BURNBIT + CONDBIT;

export const TileFlag = {
  PWRBIT,
  CONDBIT,
  BURNBIT,
  BULLBIT,
  ANIMBIT,
  ZONEBIT,
  BLBNBIT,
  BLBNCNBIT,
  BNCNBIT,
} as const;

// Tile ID constants (low 10 bits).
const DIRT = 0;
const RIVER = 2;
const REDGE = 3;
const CHANNEL = 4;
const FIRSTRIVEDGE = 5;
const LASTRIVEDGE = 20;
const TREEBASE = 21;
const LASTTREE = 36;
const WOODS = 37;
const WOODS2 = 40;
const WOODS3 = 41;
const WOODS4 = 42;
const WOODS5 = 43;
const RUBBLE = 44;
const LASTRUBBLE = 47;
const FLOOD = 48;
const LASTFLOOD = 51;
const RADTILE = 52;
const FIRE = 56;
const FIREBASE = 56;
const LASTFIRE = 63;

const ROADBASE = 64;
const HBRIDGE = 64;
const VBRIDGE = 65;
const ROADS = 66;
const INTERSECTION = 76;
const HROADPOWER = 77;
const VROADPOWER = 78;
const BRWH = 79;
const LTRFBASE = 80;
const BRWV = 95;
const HTRFBASE = 144;
const LASTROAD = 206;

const POWERBASE = 208;
const HPOWER = 208;
const VPOWER = 209;
const LHPOWER = 210;
const LVPOWER = 211;
const RAILHPOWERV = 221;
const RAILVPOWERH = 222;
const LASTPOWER = 222;

const RAILBASE = 224;
const HRAIL = 224;
const VRAIL = 225;
const LHRAIL = 226;
const LVRAIL = 227;
const HRAILROAD = 237;
const VRAILROAD = 238;
const LASTRAIL = 238;
const ROADVPOWERH = 239;

const RESBASE = 240;
const FREEZ = 244;
const HOUSE = 249;
const LHTHR = 249;
const HHTHR = 260;
const RZB = 265;
const HOSPITAL = 409;
const CHURCH = 418;
const COMBASE = 423;
const COMCLR = 427;
const CZB = 436;
const INDBASE = 612;
const INDCLR = 616;
const LASTIND = 620;
const IND1 = 621;
const IZB = 625;
const IND2 = 641;
const IND3 = 644;
const IND4 = 649;
const IND5 = 650;
const IND6 = 676;
const IND7 = 677;
const IND8 = 686;
const IND9 = 689;
const PORTBASE = 693;
const PORT = 698;
const LASTPORT = 708;
const AIRPORTBASE = 709;
const RADAR = 711;
const AIRPORT = 716;
const COALBASE = 745;
const POWERPLANT = 750;
const LASTPOWERPLANT = 760;
const FIRESTBASE = 761;
const FIRESTATION = 765;
const POLICESTBASE = 770;
const POLICESTATION = 774;
const STADIUMBASE = 779;
const STADIUM = 784;
const FULLSTADIUM = 800;
const NUCLEARBASE = 811;
const NUCLEAR = 816;
const LASTZONE = 826;

const HBRDG0 = 828;
const HBRDG1 = 829;
const HBRDG2 = 830;
const HBRDG3 = 831;

const RADAR0 = 832;
const RADAR1 = 833;
const RADAR2 = 834;
const RADAR3 = 835;
const RADAR4 = 836;
const RADAR5 = 837;
const RADAR6 = 838;
const RADAR7 = 839;

const FOUNTAIN = 840;
const TELEBASE = 844;
const TELELAST = 851;
const SMOKEBASE = 852;
const TINYEXP = 860;
const SOMETINYEXP = 864;
const LASTTINYEXP = 867;

const COALSMOKE1 = 916;
const COALSMOKE2 = 920;
const COALSMOKE3 = 924;
const COALSMOKE4 = 928;
const FOOTBALLGAME1 = 932;
const FOOTBALLGAME2 = 940;

const VBRDG0 = 948;
const VBRDG1 = 949;
const VBRDG2 = 950;
const VBRDG3 = 951;

const TILE_COUNT = 960;
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
  LASTIND,
  IND1,
  IZB,
  IND2,
  IND3,
  IND4,
  IND5,
  IND6,
  IND7,
  IND8,
  IND9,
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
