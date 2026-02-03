export const MAP_FLAGS = {
  ALMAP: 0,
  REMAP: 1,
  COMAP: 2,
  INMAP: 3,
  PRMAP: 4,
  RDMAP: 5,
  PDMAP: 6,
  RGMAP: 7,
  TDMAP: 8,
  PLMAP: 9,
  CRMAP: 10,
  LVMAP: 11,
  FIMAP: 12,
  POMAP: 13,
  DYMAP: 14,
} as const;

export const MAP_FLAG_COUNT = 15;

export type MapFlagId = keyof typeof MAP_FLAGS;
