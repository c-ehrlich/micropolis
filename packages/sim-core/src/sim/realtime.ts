import type { ToolContext } from '../actions/tool-actions.ts';
import { applyToolAction } from '../actions/tool-actions.ts';
import { assertDefined } from '../core/assert.ts';
import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import type { MapStore } from '../core/map-store.ts';
import type { MicropolisRng } from '../core/rng.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import { clearMes, sendMesAt } from '../systems/messages.ts';

const { WORLD_X, WORLD_Y, HWLDX, HWLDY, SmX, SmY } = World;
const { ALLBITS, LOMASK } = TileMask;
const { ANIMBIT, BULLBIT, BURNBIT, ZONEBIT } = TileFlag;
const {
  AIRPORT,
  BRWH,
  BRWV,
  CHANNEL,
  DIRT,
  FIRE,
  FIRSTRIVEDGE,
  HRAILROAD,
  LASTRAIL,
  LASTROAD,
  LASTRUBBLE,
  LASTTINYEXP,
  PORTBASE,
  POWERBASE,
  RAILBASE,
  RAILHPOWERV,
  RAILVPOWERH,
  RIVER,
  ROADBASE,
  RZB,
  TREEBASE,
  TINYEXP,
  VRAILROAD,
} = Tile;

/**
 * Sprite kind identifiers used by Micropolis realtime object logic.
 * Mirrors `TRA`..`BUS` constants in `ref/micropolis/src/sim/headers/sim.h`
 * and type routing in `ref/micropolis/src/sim/w_sprite.c`.
 */
export const SPRITE_TYPE = {
  TRA: 1,
  COP: 2,
  AIR: 3,
  SHI: 4,
  GOD: 5,
  TOR: 6,
  EXP: 7,
  BUS: 8,
} as const;

export type SpriteType = (typeof SPRITE_TYPE)[keyof typeof SPRITE_TYPE];

/**
 * Total sprite slot count, including slot `0` (unused sentinel).
 * Mirrors `OBJN` in `ref/micropolis/src/sim/headers/sim.h`.
 */
export const SPRITE_SLOT_COUNT = 9;

export const POWER_BLINK_TICKS = 30;

/**
 * Layout-related fields initialized per sprite type in `InitSprite`.
 * Mirrors width/offset/hotspot assignments in `ref/micropolis/src/sim/w_sprite.c`.
 */
export interface SimSpriteLayout {
  width: number;
  height: number;
  x_offset: number;
  y_offset: number;
  x_hot: number;
  y_hot: number;
}

/**
 * Per-type sprite layout table copied from `InitSprite` in
 * `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: this models only shape/offset/hotspot fields; runtime fields
 * like `frame`, `dir`, and `count` are still assigned in sprite-type logic.
 */
export const SPRITE_LAYOUT_BY_TYPE: Readonly<Record<SpriteType, SimSpriteLayout>> = {
  [SPRITE_TYPE.TRA]: { width: 32, height: 32, x_offset: 32, y_offset: -16, x_hot: 40, y_hot: -8 },
  [SPRITE_TYPE.COP]: { width: 32, height: 32, x_offset: 32, y_offset: -16, x_hot: 40, y_hot: -8 },
  [SPRITE_TYPE.AIR]: { width: 48, height: 48, x_offset: 24, y_offset: 0, x_hot: 48, y_hot: 16 },
  [SPRITE_TYPE.SHI]: { width: 48, height: 48, x_offset: 32, y_offset: -16, x_hot: 48, y_hot: 0 },
  [SPRITE_TYPE.GOD]: { width: 48, height: 48, x_offset: 24, y_offset: 0, x_hot: 40, y_hot: 16 },
  [SPRITE_TYPE.TOR]: { width: 48, height: 48, x_offset: 24, y_offset: 0, x_hot: 40, y_hot: 36 },
  [SPRITE_TYPE.EXP]: { width: 48, height: 48, x_offset: 24, y_offset: 0, x_hot: 40, y_hot: 16 },
  [SPRITE_TYPE.BUS]: { width: 32, height: 32, x_offset: 30, y_offset: -18, x_hot: 40, y_hot: -8 },
};

/**
 * Active sprite state for realtime systems.
 * Mirrors `SimSprite` fields from `ref/micropolis/src/sim/headers/view.h`
 * and command/property access in `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: C list-link field `next` is intentionally omitted because
 * TypeScript uses array ownership in `RealtimeContext.sprites`.
 */
export interface SimSprite {
  name: string;
  type: SpriteType;
  frame: number;
  x: number;
  y: number;
  width: number;
  height: number;
  x_offset: number;
  y_offset: number;
  x_hot: number;
  y_hot: number;
  orig_x: number;
  orig_y: number;
  dest_x: number;
  dest_y: number;
  count: number;
  sound_count: number;
  dir: number;
  new_dir: number;
  step: number;
  flag: number;
  control: number;
  turn: number;
  accel: number;
  speed: number;
}

export interface RealtimeCallbacks {
  onMessage?: (id: number, x: number, y: number) => void;
  onSound?: (channel: string, id: string) => void;
  onClearMessages?: () => void;
}

/**
 * Optional realtime-to-message port bridge for sprite/event message dispatch.
 * Mirrors `Do*Sprite` -> `SendMesAt` coupling from `ref/micropolis/src/sim/w_sprite.c`
 * into `ref/micropolis/src/sim/s_msg.c`.
 *
 * Parity note: when configured, realtime events enqueue through `sendMesAt`
 * (`MessagePort`/`MesX`/`MesY`) and are later delivered by `doMessage()`;
 * without this bridge, sim-core keeps legacy direct callback dispatch.
 */
export interface RealtimeMessageCoupling {
  state: SimState;
  context: SimContext;
}

export interface RealtimeContext extends RealtimeCallbacks {
  store: MapStore;
  rng: MicropolisRng;
  simSpeed: number;
  doAnimation: boolean;
  noDisasters: boolean;
  scenarioId: number;
  totalPop: number;
  polMaxX: number;
  polMaxY: number;
  cycle: number;
  absDist: number;
  powerBlink: boolean;
  powerBlinkTick: number;
  crashX: number;
  crashY: number;
  sprites: SimSprite[];
  globalSprites: Array<SimSprite | null>;
  toolContext: ToolContext;
  messageCoupling?: RealtimeMessageCoupling;
}

export interface RealtimeContextOptions extends RealtimeCallbacks {
  store: MapStore;
  rng: MicropolisRng;
  simSpeed?: number;
  doAnimation?: boolean;
  noDisasters?: boolean;
  scenarioId?: number;
  totalPop?: number;
  polMaxX?: number;
  polMaxY?: number;
  toolContext: ToolContext;
  messageCoupling?: RealtimeMessageCoupling;
}

export function createRealtimeContext(options: RealtimeContextOptions): RealtimeContext {
  if (!options.toolContext) {
    throw new Error('Realtime context requires a toolContext');
  }
  return {
    store: options.store,
    rng: options.rng,
    simSpeed: options.simSpeed ?? 3,
    doAnimation: options.doAnimation ?? true,
    noDisasters: options.noDisasters ?? false,
    scenarioId: options.scenarioId ?? 0,
    totalPop: options.totalPop ?? 0,
    polMaxX: options.polMaxX ?? Math.floor(WORLD_X / 2),
    polMaxY: options.polMaxY ?? Math.floor(WORLD_Y / 2),
    cycle: 0,
    absDist: 0,
    powerBlink: true,
    powerBlinkTick: 0,
    crashX: 0,
    crashY: 0,
    sprites: [],
    globalSprites: Array.from({ length: SPRITE_SLOT_COUNT }, () => null),
    toolContext: options.toolContext,
    messageCoupling: options.messageCoupling,
    onMessage: options.onMessage,
    onSound: options.onSound,
    onClearMessages: options.onClearMessages,
  };
}

/**
 * Tile animation remap table used by Micropolis animated terrain.
 * Mirrors `aniTile[]` from `ref/micropolis/src/sim/animtab.h`, consumed by
 * `animateTiles` in `ref/micropolis/src/sim/g_ani.c`.
 * Parity note: this follows the active one-step `aniTile` path; the optional
 * `tileSynch`/`aniSynch` branch in `g_ani.c` is compiled out behind `#if 0`.
 */
export const ANI_TILE = Uint16Array.from([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
  51, 52, 53, 54, 55, 57, 58, 59, 60, 61, 62, 63, 56, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74,
  75, 76, 77, 78, 79, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142,
  143, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
  102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120,
  121, 122, 123, 124, 125, 126, 127, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203,
  204, 205, 206, 207, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158,
  159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177,
  178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 208, 209, 210, 211, 212,
  213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231,
  232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250,
  251, 252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269,
  270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288,
  289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 305, 306, 307,
  308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 325, 326,
  327, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340, 341, 342, 343, 344, 345,
  346, 347, 348, 349, 350, 351, 352, 353, 354, 355, 356, 357, 358, 359, 360, 361, 362, 363, 364,
  365, 366, 367, 368, 369, 370, 371, 372, 373, 374, 375, 376, 377, 378, 379, 380, 381, 382, 383,
  384, 385, 386, 387, 388, 389, 390, 391, 392, 393, 394, 395, 396, 397, 398, 399, 400, 401, 402,
  403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 419, 420, 421,
  422, 423, 424, 425, 426, 427, 428, 429, 430, 431, 432, 433, 434, 435, 436, 437, 438, 439, 440,
  441, 442, 443, 444, 445, 446, 447, 448, 449, 450, 451, 452, 453, 454, 455, 456, 457, 458, 459,
  460, 461, 462, 463, 464, 465, 466, 467, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477, 478,
  479, 480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, 494, 495, 496, 497,
  498, 499, 500, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512, 513, 514, 515, 516,
  517, 518, 519, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 531, 532, 533, 534, 535,
  536, 537, 538, 539, 540, 541, 542, 543, 544, 545, 546, 547, 548, 549, 550, 551, 552, 553, 554,
  555, 556, 557, 558, 559, 560, 561, 562, 563, 564, 565, 566, 567, 568, 569, 570, 571, 572, 573,
  574, 575, 576, 577, 578, 579, 580, 581, 582, 583, 584, 585, 586, 587, 588, 589, 590, 591, 592,
  593, 594, 595, 596, 597, 598, 599, 600, 601, 602, 603, 604, 605, 606, 607, 608, 609, 610, 611,
  612, 613, 614, 615, 616, 617, 618, 619, 852, 621, 622, 623, 624, 625, 626, 627, 628, 629, 630,
  631, 632, 633, 634, 635, 636, 637, 638, 639, 640, 884, 642, 643, 888, 645, 646, 647, 648, 892,
  896, 651, 652, 653, 654, 655, 656, 657, 658, 659, 660, 661, 662, 663, 664, 665, 666, 667, 668,
  669, 670, 671, 672, 673, 674, 675, 900, 904, 678, 679, 680, 681, 682, 683, 684, 685, 908, 687,
  688, 912, 690, 691, 692, 693, 694, 695, 696, 697, 698, 699, 700, 701, 702, 703, 704, 705, 706,
  707, 708, 709, 710, 832, 712, 713, 714, 715, 716, 717, 718, 719, 720, 721, 722, 723, 724, 725,
  726, 727, 728, 729, 730, 731, 732, 733, 734, 735, 736, 737, 738, 739, 740, 741, 742, 743, 744,
  745, 746, 916, 920, 749, 750, 924, 928, 753, 754, 755, 756, 757, 758, 759, 760, 761, 762, 763,
  764, 765, 766, 767, 768, 769, 770, 771, 772, 773, 774, 775, 776, 777, 778, 779, 780, 781, 782,
  783, 784, 785, 786, 787, 788, 789, 790, 791, 792, 793, 794, 795, 796, 797, 798, 799, 800, 801,
  802, 803, 804, 805, 806, 807, 808, 809, 810, 811, 812, 813, 814, 815, 816, 817, 818, 819, 952,
  821, 822, 823, 824, 825, 826, 827, 828, 829, 830, 831, 833, 834, 835, 836, 837, 838, 839, 832,
  841, 842, 843, 840, 845, 846, 847, 848, 849, 850, 851, 844, 853, 854, 855, 856, 857, 858, 859,
  852, 861, 862, 863, 864, 865, 866, 867, 867, 868, 869, 870, 871, 872, 873, 874, 875, 876, 877,
  878, 879, 880, 881, 882, 883, 885, 886, 887, 884, 889, 890, 891, 888, 893, 894, 895, 892, 897,
  898, 899, 896, 901, 902, 903, 900, 905, 906, 907, 904, 909, 910, 911, 908, 913, 914, 915, 912,
  917, 918, 919, 916, 921, 922, 923, 920, 925, 926, 927, 924, 929, 930, 931, 928, 933, 934, 935,
  936, 937, 938, 939, 932, 941, 942, 943, 944, 945, 946, 947, 940, 948, 949, 950, 951, 953, 954,
  955, 952, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
]);

const TRA_GROOVE_X = -39;
const TRA_GROOVE_Y = 6;
const BUS_GROOVE_X = -39;
const BUS_GROOVE_Y = 6;

const indexFor = (x: number, y: number) => x * WORLD_Y + y;

const testBounds = (x: number, y: number) => x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y;

const tileAt = (map: Uint16Array, x: number, y: number) => map[indexFor(x, y)];

const setTile = (
  context: RealtimeContext,
  map: Uint16Array,
  x: number,
  y: number,
  value: number,
) => {
  context.store.write('map', indexFor(x, y), value);
  map[indexFor(x, y)] = value;
};

const trfIndex = (x: number, y: number) => x * HWLDY + y;
const rateIndex = (x: number, y: number) => x * SmY + y;

const rand16 = (context: RealtimeContext) => context.rng.next16();
const rand = (context: RealtimeContext, range: number) => context.rng.rand(range);

function getChar(map: Uint16Array, x: number, y: number): number {
  const tx = x >> 4;
  const ty = y >> 4;
  if (!testBounds(tx, ty)) {
    return -1;
  }
  const tile = tileAt(map, tx, ty);
  assertDefined(tile);
  return tile & LOMASK;
}

function turnTo(p: number, d: number): number {
  if (p === d) {
    return p;
  }
  if (p < d) {
    if (d - p < 4) {
      p += 1;
    } else {
      p -= 1;
    }
  } else if (p - d < 4) {
    p -= 1;
  } else {
    p += 1;
  }
  if (p > 8) {
    p = 1;
  }
  if (p < 1) {
    p = 8;
  }
  return p;
}

function tryOther(tile: number, oldDir: number, newDir: number): number {
  let z = oldDir + 4;
  if (z > 8) {
    z -= 8;
  }
  if (newDir !== z) {
    return 0;
  }
  if (tile === POWERBASE || tile === POWERBASE + 1 || tile === RAILBASE || tile === RAILBASE + 1) {
    return 1;
  }
  return 0;
}

function spriteNotInBounds(sprite: SimSprite): boolean {
  const x = sprite.x + sprite.x_hot;
  const y = sprite.y + sprite.y_hot;
  return x < 0 || y < 0 || x >= WORLD_X << 4 || y >= WORLD_Y << 4;
}

const GD_TAB = [0, 3, 2, 1, 3, 4, 5, 7, 6, 5, 7, 8, 1];

function getDir(
  context: RealtimeContext,
  orgX: number,
  orgY: number,
  desX: number,
  desY: number,
): number {
  let dispX = desX - orgX;
  let dispY = desY - orgY;
  let z: number;

  if (dispX < 0) {
    z = dispY < 0 ? 11 : 8;
  } else {
    z = dispY < 0 ? 2 : 5;
  }

  if (dispX < 0) {
    dispX = -dispX;
  }
  if (dispY < 0) {
    dispY = -dispY;
  }

  const absDist = dispX + dispY;

  if (dispX << 1 < dispY) {
    z += 1;
  } else if (dispY << 1 < dispY) {
    z -= 1;
  }

  if (z < 0 || z > 12) {
    z = 0;
  }

  context.absDist = absDist;
  return GD_TAB[z] ?? 0;
}

function getDis(x1: number, y1: number, x2: number, y2: number): number {
  const dispX = x1 > x2 ? x1 - x2 : x2 - x1;
  const dispY = y1 > y2 ? y1 - y2 : y2 - y1;
  return dispX + dispY;
}

function checkSpriteCollision(s1: SimSprite, s2: SimSprite): boolean {
  return (
    s1.frame !== 0 &&
    s2.frame !== 0 &&
    getDis(s1.x + s1.x_hot, s1.y + s1.y_hot, s2.x + s2.x_hot, s2.y + s2.y_hot) < 30
  );
}

function tally(tile: number): boolean {
  return (
    (tile >= FIRSTRIVEDGE && tile <= LASTRUBBLE) ||
    (tile >= POWERBASE + 2 && tile <= POWERBASE + 12) ||
    (tile >= TINYEXP && tile <= LASTTINYEXP + 2)
  );
}

function checkWet(tile: number): boolean {
  return (
    tile === POWERBASE ||
    tile === POWERBASE + 1 ||
    tile === RAILBASE ||
    tile === RAILBASE + 1 ||
    tile === BRWH ||
    tile === BRWV
  );
}

function sendMessage(context: RealtimeContext, id: number, x: number, y: number) {
  if (context.messageCoupling !== undefined) {
    sendMesAt(context.messageCoupling.state, context.messageCoupling.context, id, x, y);
    return;
  }
  context.onMessage?.(id, x, y);
}

function makeSound(context: RealtimeContext, channel: string, id: string) {
  context.onSound?.(channel, id);
}

function clearMessages(context: RealtimeContext) {
  if (context.messageCoupling !== undefined) {
    // w_sprite.c disaster entrypoints call ClearMes() before SendMesAt(...) so
    // repeated picture/event ids (e.g. tornado/monster) are not suppressed.
    clearMes(context.messageCoupling.state);
  }
  context.onClearMessages?.();
}

function assignSpriteLayoutFields(sprite: SimSprite) {
  const layout = SPRITE_LAYOUT_BY_TYPE[sprite.type];
  sprite.width = layout.width;
  sprite.height = layout.height;
  sprite.x_offset = layout.x_offset;
  sprite.y_offset = layout.y_offset;
  sprite.x_hot = layout.x_hot;
  sprite.y_hot = layout.y_hot;
}

function initSprite(context: RealtimeContext, sprite: SimSprite, x: number, y: number) {
  sprite.x = x;
  sprite.y = y;
  sprite.frame = 0;
  sprite.orig_x = 0;
  sprite.orig_y = 0;
  sprite.dest_x = 0;
  sprite.dest_y = 0;
  sprite.count = 0;
  sprite.sound_count = 0;
  sprite.dir = 0;
  sprite.new_dir = 0;
  sprite.step = 0;
  sprite.flag = 0;
  sprite.control = -1;
  sprite.turn = 0;
  sprite.accel = 0;
  sprite.speed = 100;

  if (context.globalSprites[sprite.type] === null) {
    context.globalSprites[sprite.type] = sprite;
  }
  assignSpriteLayoutFields(sprite);

  switch (sprite.type) {
    case SPRITE_TYPE.TRA:
      sprite.frame = 1;
      sprite.dir = 4;
      break;
    case SPRITE_TYPE.SHI:
      if (x < 4 << 4) {
        sprite.frame = 3;
      } else if (x >= (WORLD_X - 4) << 4) {
        sprite.frame = 7;
      } else if (y < 4 << 4) {
        sprite.frame = 5;
      } else if (y >= (WORLD_Y - 4) << 4) {
        sprite.frame = 1;
      } else {
        sprite.frame = 3;
      }
      sprite.new_dir = sprite.frame;
      sprite.dir = 10;
      sprite.count = 1;
      break;
    case SPRITE_TYPE.GOD:
      if (x > (WORLD_X << 4) / 2) {
        sprite.frame = y > (WORLD_Y << 4) / 2 ? 10 : 7;
      } else {
        sprite.frame = y > (WORLD_Y << 4) / 2 ? 1 : 4;
      }
      sprite.count = 1000;
      sprite.dest_x = context.polMaxX << 4;
      sprite.dest_y = context.polMaxY << 4;
      sprite.orig_x = sprite.x;
      sprite.orig_y = sprite.y;
      break;
    case SPRITE_TYPE.COP:
      sprite.frame = 5;
      sprite.count = 1500;
      sprite.dest_x = rand(context, (WORLD_X << 4) - 1);
      sprite.dest_y = rand(context, (WORLD_Y << 4) - 1);
      sprite.orig_x = x - 30;
      sprite.orig_y = y;
      break;
    case SPRITE_TYPE.AIR:
      if (x > (WORLD_X - 20) << 4) {
        sprite.x -= 148;
        sprite.dest_x = sprite.x - 200;
        sprite.frame = 7;
      } else {
        sprite.dest_x = sprite.x + 200;
        sprite.frame = 11;
      }
      sprite.dest_y = sprite.y;
      break;
    case SPRITE_TYPE.TOR:
      sprite.frame = 1;
      sprite.count = 200;
      break;
    case SPRITE_TYPE.EXP:
      sprite.frame = 1;
      break;
    case SPRITE_TYPE.BUS:
      sprite.frame = 1;
      sprite.dir = 1;
      break;
    default:
      break;
  }
}

function newSprite(
  context: RealtimeContext,
  name: string,
  type: SpriteType,
  x: number,
  y: number,
): SimSprite {
  const sprite: SimSprite = {
    name,
    type,
    frame: 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    x_offset: 0,
    y_offset: 0,
    x_hot: 0,
    y_hot: 0,
    orig_x: 0,
    orig_y: 0,
    dest_x: 0,
    dest_y: 0,
    count: 0,
    sound_count: 0,
    dir: 0,
    new_dir: 0,
    step: 0,
    flag: 0,
    control: -1,
    turn: 0,
    accel: 0,
    speed: 100,
  };

  initSprite(context, sprite, x, y);
  context.sprites.push(sprite);
  return sprite;
}

export function destroyAllSprites(context: RealtimeContext) {
  for (const sprite of context.sprites) {
    sprite.frame = 0;
  }
}

export function destroySprite(context: RealtimeContext, sprite: SimSprite) {
  if (context.globalSprites[sprite.type] === sprite) {
    context.globalSprites[sprite.type] = null;
  }
  const idx = context.sprites.indexOf(sprite);
  if (idx >= 0) {
    context.sprites.splice(idx, 1);
  }
  sprite.name = '';
}

export function getSprite(context: RealtimeContext, type: SpriteType): SimSprite | null {
  const sprite = context.globalSprites[type];
  if (!sprite || sprite.frame === 0) {
    return null;
  }
  return sprite;
}

export function makeSprite(
  context: RealtimeContext,
  type: SpriteType,
  x: number,
  y: number,
): SimSprite {
  const existing = context.globalSprites[type];
  if (existing) {
    initSprite(context, existing, x, y);
    return existing;
  }
  return newSprite(context, '', type, x, y);
}

export function makeNewSprite(
  context: RealtimeContext,
  type: SpriteType,
  x: number,
  y: number,
): SimSprite {
  return newSprite(context, '', type, x, y);
}

export function updatePowerBlink(context: RealtimeContext) {
  context.powerBlinkTick = (context.powerBlinkTick + 1) % (POWER_BLINK_TICKS * 2);
  context.powerBlink = context.powerBlinkTick < POWER_BLINK_TICKS;
}

/**
 * Animate all `ANIMBIT` tiles in the map by one frame.
 * Mirrors `animateTiles` in `ref/micropolis/src/sim/g_ani.c`.
 * Parity note: high flag bits (`ALLBITS`) are preserved while only the low
 * tile-id bits (`LOMASK`) are remapped through `ANI_TILE`.
 */
export function animateTiles(context: RealtimeContext, map?: Uint16Array) {
  const mapLayer = map ?? (context.store.getLayer('map') as Uint16Array);
  for (let i = 0; i < mapLayer.length; i += 1) {
    const tile = mapLayer[i];
    assertDefined(tile);
    if ((tile & ANIMBIT) === 0) {
      continue;
    }
    const flags = tile & ALLBITS;
    const tileId = tile & LOMASK;
    const nextId = ANI_TILE[tileId] ?? tileId;
    context.store.write('map', i, nextId | flags);
    mapLayer[i] = nextId | flags;
  }
}

/**
 * Run one realtime object/animation pass for the active world.
 * Mirrors `MoveObjects` in `ref/micropolis/src/sim/w_sprite.c` and the
 * `DoAnimation && SimSpeed` animation gate in `ref/micropolis/src/sim/w_editor.c`.
 * Parity note: C uses `TilesAnimated` to avoid duplicate animation across multiple
 * views; this port runs a single authoritative pass per tick.
 */
export function runRealtimeTick(context: RealtimeContext) {
  updatePowerBlink(context);
  if (context.simSpeed <= 0) {
    return;
  }
  const map = context.store.getLayer('map') as Uint16Array;
  const trfDensity = context.store.getLayer('trfDensity') as Uint8Array;
  const rateOGMem = context.store.getLayer('rateOGMem') as Int16Array;
  moveObjects(context, map, trfDensity, rateOGMem);
  if (context.doAnimation) {
    animateTiles(context, map);
  }
}

export function runRealtimeTicks(context: RealtimeContext, ticks: number) {
  if (ticks < 0) {
    throw new Error('runRealtimeTicks ticks must be non-negative');
  }
  for (let i = 0; i < ticks; i += 1) {
    runRealtimeTick(context);
  }
}

function bulldozeTile(context: RealtimeContext, x: number, y: number) {
  if (!testBounds(x, y)) {
    return;
  }
  if (!context.toolContext) {
    throw new Error('Realtime bulldozer requires a toolContext');
  }
  applyToolAction(context.toolContext, {
    tool: 'bulldoze',
    x,
    y,
    simStep: 0,
    order: 0,
    tickId: 0,
    seq: 0,
  });
}

function startFire(context: RealtimeContext, map: Uint16Array, x: number, y: number) {
  const tx = x >> 4;
  const ty = y >> 4;
  if (!testBounds(tx, ty)) {
    return;
  }
  const index = indexFor(tx, ty);
  const z = map[index] ?? 0;
  const t = z & LOMASK;
  if (!(z & BURNBIT) && t !== 0) {
    return;
  }
  if (z & ZONEBIT) {
    return;
  }
  const fireTile = FIRE + (rand16(context) & 3) + ANIMBIT;
  setTile(context, map, tx, ty, fireTile);
}

function ofireZone(
  context: RealtimeContext,
  map: Uint16Array,
  rateOGMem: Int16Array,
  xloc: number,
  yloc: number,
  ch: number,
) {
  const rx = xloc >> 3;
  const ry = yloc >> 3;
  if (rx >= 0 && rx < SmX && ry >= 0 && ry < SmY) {
    const idx = rateIndex(rx, ry);
    rateOGMem[idx] = (rateOGMem[idx] ?? 0) - 20;
    context.store.write('rateOGMem', idx, rateOGMem[idx]);
  }

  let xymax = 4;
  ch &= LOMASK;
  if (ch < PORTBASE) {
    xymax = 2;
  } else if (ch === AIRPORT) {
    xymax = 5;
  }

  for (let x = -1; x < xymax; x += 1) {
    for (let y = -1; y < xymax; y += 1) {
      const xt = xloc + x;
      const yt = yloc + y;
      if (!testBounds(xt, yt)) {
        continue;
      }
      const index = indexFor(xt, yt);
      const value = map[index];
      assertDefined(value);
      if ((value & LOMASK) >= ROADBASE) {
        setTile(context, map, xt, yt, value | BULLBIT);
      }
    }
  }
}

function destroyTile(
  context: RealtimeContext,
  map: Uint16Array,
  rateOGMem: Int16Array,
  ox: number,
  oy: number,
) {
  const x = ox >> 4;
  const y = oy >> 4;
  if (!testBounds(x, y)) {
    return;
  }
  const index = indexFor(x, y);
  const z = map[index] ?? 0;
  const t = z & LOMASK;
  if (t < TREEBASE) {
    return;
  }
  if (!(z & BURNBIT)) {
    if (t >= ROADBASE && t <= LASTROAD) {
      setTile(context, map, x, y, RIVER);
    }
    return;
  }
  if (z & ZONEBIT) {
    ofireZone(context, map, rateOGMem, x, y, z);
    if (t > RZB) {
      makeExplosionAt(context, ox, oy);
    }
  }
  if (checkWet(t)) {
    setTile(context, map, x, y, RIVER);
  } else {
    const rubbleBase = context.doAnimation ? TINYEXP : LASTTINYEXP - 3;
    setTile(context, map, x, y, rubbleBase | BULLBIT | ANIMBIT);
  }
}

export function moveObjects(
  context: RealtimeContext,
  map: Uint16Array,
  trfDensity: Uint8Array,
  rateOGMem: Int16Array,
) {
  if (context.simSpeed <= 0) {
    return;
  }
  context.cycle += 1;

  const snapshot = context.sprites.slice();
  for (const sprite of snapshot) {
    if (sprite.frame !== 0) {
      switch (sprite.type) {
        case SPRITE_TYPE.TRA:
          doTrainSprite(context, map, sprite);
          break;
        case SPRITE_TYPE.COP:
          doCopterSprite(context, trfDensity, sprite);
          break;
        case SPRITE_TYPE.AIR:
          doAirplaneSprite(context, sprite);
          break;
        case SPRITE_TYPE.SHI:
          doShipSprite(context, map, rateOGMem, sprite);
          break;
        case SPRITE_TYPE.GOD:
          doMonsterSprite(context, map, rateOGMem, sprite);
          break;
        case SPRITE_TYPE.TOR:
          doTornadoSprite(context, map, rateOGMem, sprite);
          break;
        case SPRITE_TYPE.EXP:
          doExplosionSprite(context, map, sprite);
          break;
        case SPRITE_TYPE.BUS:
          doBusSprite(context, map, trfDensity, sprite);
          break;
        default:
          break;
      }
    } else if (sprite.name.length === 0) {
      destroySprite(context, sprite);
    }
  }
}

function doTrainSprite(context: RealtimeContext, map: Uint16Array, sprite: SimSprite) {
  const cx = [0, 16, 0, -16];
  const cy = [-16, 0, 16, 0];
  const dx = [0, 4, 0, -4, 0];
  const dy = [-4, 0, 4, 0, 0];
  const trainPic2 = [1, 2, 1, 2, 5];

  if (sprite.frame === 3 || sprite.frame === 4) {
    sprite.frame = trainPic2[sprite.dir] ?? sprite.frame;
  }
  sprite.x += dx[sprite.dir] ?? 0;
  sprite.y += dy[sprite.dir] ?? 0;

  if ((context.cycle & 3) !== 0) {
    return;
  }

  const startDir = rand16(context) & 3;
  for (let z = startDir; z < startDir + 4; z += 1) {
    const dir2 = z & 3;
    if (sprite.dir !== 4) {
      if (dir2 === ((sprite.dir + 2) & 3)) {
        continue;
      }
    }
    const c = getChar(map, sprite.x + (cx[dir2] ?? 0) + 48, sprite.y + (cy[dir2] ?? 0));
    if ((c >= RAILBASE && c <= LASTRAIL) || c === RAILVPOWERH || c === RAILHPOWERV) {
      if (sprite.dir !== dir2 && sprite.dir !== 4) {
        if (sprite.dir + dir2 === 3) {
          sprite.frame = 3;
        } else {
          sprite.frame = 4;
        }
      } else {
        sprite.frame = trainPic2[dir2] ?? sprite.frame;
      }
      if (c === RAILBASE || c === RAILBASE + 1) {
        sprite.frame = 5;
      }
      sprite.dir = dir2;
      return;
    }
  }

  if (sprite.dir === 4) {
    sprite.frame = 0;
    return;
  }
  sprite.dir = 4;
}

function doCopterSprite(context: RealtimeContext, trfDensity: Uint8Array, sprite: SimSprite) {
  const cdx = [0, 0, 3, 5, 3, 0, -3, -5, -3];
  const cdy = [0, -5, -3, 0, 3, 5, 3, 0, -3];

  if (sprite.sound_count > 0) {
    sprite.sound_count -= 1;
  }

  if (sprite.control < 0) {
    if (sprite.count > 0) {
      sprite.count -= 1;
    }

    if (!sprite.count) {
      const god = getSprite(context, SPRITE_TYPE.GOD);
      if (god) {
        sprite.dest_x = god.x;
        sprite.dest_y = god.y;
      } else {
        const tor = getSprite(context, SPRITE_TYPE.TOR);
        if (tor) {
          sprite.dest_x = tor.x;
          sprite.dest_y = tor.y;
        } else {
          sprite.dest_x = sprite.orig_x;
          sprite.dest_y = sprite.orig_y;
        }
      }
    }

    if (!sprite.count) {
      getDir(context, sprite.x, sprite.y, sprite.orig_x, sprite.orig_y);
      if (context.absDist < 30) {
        sprite.frame = 0;
        return;
      }
    }
  } else {
    getDir(context, sprite.x, sprite.y, sprite.dest_x, sprite.dest_y);
    if (context.absDist < 16) {
      sprite.dest_x = sprite.orig_x;
      sprite.dest_y = sprite.orig_y;
      sprite.control = -1;
    }
  }

  if (!sprite.sound_count) {
    const x = (sprite.x + 48) >> 5;
    const y = sprite.y >> 5;
    if (x >= 0 && x < HWLDX && y >= 0 && y < HWLDY) {
      const density = trfDensity[trfIndex(x, y)];
      assertDefined(density);
      if (density > 170 && (rand16(context) & 7) === 0) {
        sendMessage(context, -41, (x << 1) + 1, (y << 1) + 1);
        makeSound(context, 'city', 'HeavyTraffic');
        sprite.sound_count = 200;
      }
    }
  }

  let z = sprite.frame;
  if ((context.cycle & 3) === 0) {
    const dir = getDir(context, sprite.x, sprite.y, sprite.dest_x, sprite.dest_y);
    z = turnTo(z, dir);
    sprite.frame = z;
  }

  sprite.x += cdx[z] ?? 0;
  sprite.y += cdy[z] ?? 0;
}

function doAirplaneSprite(context: RealtimeContext, sprite: SimSprite) {
  const cdx = [0, 0, 6, 8, 6, 0, -6, -8, -6, 8, 8, 8];
  const cdy = [0, -8, -6, 0, 6, 8, 6, 0, -6, 0, 0, 0];

  let z = sprite.frame;

  if (context.cycle % 5 === 0) {
    if (z > 8) {
      z -= 1;
      if (z < 9) {
        z = 3;
      }
      sprite.frame = z;
    } else {
      const dir = getDir(context, sprite.x, sprite.y, sprite.dest_x, sprite.dest_y);
      z = turnTo(z, dir);
      sprite.frame = z;
    }
  }

  if (context.absDist < 50) {
    sprite.dest_x = rand(context, WORLD_X * 16 + 100) - 50;
    sprite.dest_y = rand(context, WORLD_Y * 16 + 100) - 50;
  }

  if (!context.noDisasters) {
    let explode = false;
    for (const s of context.sprites) {
      if (
        s.frame !== 0 &&
        (s.type === SPRITE_TYPE.COP || (sprite !== s && s.type === SPRITE_TYPE.AIR)) &&
        checkSpriteCollision(sprite, s)
      ) {
        explodeSprite(context, s);
        explode = true;
      }
    }
    if (explode) {
      explodeSprite(context, sprite);
    }
  }

  sprite.x += cdx[z] ?? 0;
  sprite.y += cdy[z] ?? 0;
  if (spriteNotInBounds(sprite)) {
    sprite.frame = 0;
  }
}

function doShipSprite(
  context: RealtimeContext,
  map: Uint16Array,
  rateOGMem: Int16Array,
  sprite: SimSprite,
) {
  const bdx = [0, 0, 1, 1, 1, 0, -1, -1, -1];
  const bdy = [0, -1, -1, 0, 1, 1, 1, 0, -1];
  const bpx = [0, 0, 2, 2, 2, 0, -2, -2, -2];
  const bpy = [0, -2, -2, 0, 2, 2, 2, 0, -2];
  const btClrTab = [RIVER, CHANNEL, POWERBASE, POWERBASE + 1, RAILBASE, RAILBASE + 1, BRWH, BRWV];
  let t: number = RIVER;

  if (sprite.sound_count > 0) {
    sprite.sound_count -= 1;
  }
  if (!sprite.sound_count) {
    if ((rand16(context) & 3) === 1) {
      if (context.scenarioId === 2 && rand(context, 10) < 5) {
        makeSound(context, 'city', 'HonkHonk-Low -speed 80');
      } else {
        makeSound(context, 'city', 'HonkHonk-Low');
      }
    }
    sprite.sound_count = 200;
  }

  if (sprite.count > 0) {
    sprite.count -= 1;
  }
  if (!sprite.count) {
    sprite.count = 9;
    if (sprite.frame !== sprite.new_dir) {
      sprite.frame = turnTo(sprite.frame, sprite.new_dir);
      return;
    }
    const tem = rand16(context) & 7;
    let pem = tem;
    for (; pem < tem + 8; pem += 1) {
      const z = (pem & 7) + 1;
      if (z === sprite.dir) {
        continue;
      }
      const x = ((sprite.x + 47) >> 4) + (bdx[z] ?? 0);
      const y = (sprite.y >> 4) + (bdy[z] ?? 0);
      if (testBounds(x, y)) {
        const _t = tileAt(map, x, y);
        assertDefined(_t);
        t = _t & LOMASK;
        if (t === CHANNEL || t === BRWH || t === BRWV || tryOther(t, sprite.dir, z)) {
          sprite.new_dir = z;
          sprite.frame = turnTo(sprite.frame, sprite.new_dir);
          sprite.dir = z + 4;
          if (sprite.dir > 8) {
            sprite.dir -= 8;
          }
          break;
        }
      }
    }
    if (pem === tem + 8) {
      sprite.dir = 10;
      sprite.new_dir = (rand16(context) & 7) + 1;
    }
  } else {
    const z = sprite.frame;
    if (z === sprite.new_dir) {
      sprite.x += bpx[z] ?? 0;
      sprite.y += bpy[z] ?? 0;
    }
  }

  if (spriteNotInBounds(sprite)) {
    sprite.frame = 0;
    return;
  }

  for (let z = 0; z < 8; z += 1) {
    if (t === btClrTab[z]) {
      break;
    }
    if (z === 7) {
      explodeSprite(context, sprite);
      destroyTile(context, map, rateOGMem, sprite.x + 48, sprite.y);
    }
  }
}

function doMonsterSprite(
  context: RealtimeContext,
  map: Uint16Array,
  rateOGMem: Int16Array,
  sprite: SimSprite,
) {
  const gx = [2, 2, -2, -2, 0];
  const gy = [-2, 2, 2, -2, 0];
  const nd1 = [0, 1, 2, 3];
  const nd2 = [1, 2, 3, 0];
  const nn1 = [2, 5, 8, 11];
  const nn2 = [11, 2, 5, 8];

  if (sprite.sound_count > 0) {
    sprite.sound_count -= 1;
  }

  let d = 0;
  let z = 0;

  if (sprite.control < 0) {
    if (sprite.control === -2) {
      d = Math.floor((sprite.frame - 1) / 3);
      z = (sprite.frame - 1) % 3;
      if (z === 2) {
        sprite.step = 0;
      }
      if (z === 0) {
        sprite.step = 1;
      }
      if (sprite.step) {
        z += 1;
      } else {
        z -= 1;
      }
      const dir = getDir(context, sprite.x, sprite.y, sprite.dest_x, sprite.dest_y);
      if (context.absDist < 18) {
        sprite.control = -1;
        sprite.count = 1000;
        sprite.flag = 1;
        sprite.dest_x = sprite.orig_x;
        sprite.dest_y = sprite.orig_y;
      } else {
        let c = Math.floor((dir - 1) / 2);
        if ((c !== d && rand(context, 5) === 0) || rand(context, 20) === 0) {
          const diff = (c - d) & 3;
          if (diff === 1 || diff === 3) {
            d = c;
          } else {
            if (rand16(context) & 1) {
              d += 1;
            } else {
              d -= 1;
            }
            d &= 3;
          }
        } else if (rand(context, 20) === 0) {
          if (rand16(context) & 1) {
            d += 1;
          } else {
            d -= 1;
          }
          d &= 3;
        }
      }
    } else {
      d = Math.floor((sprite.frame - 1) / 3);
      if (d < 4) {
        z = (sprite.frame - 1) % 3;
        if (z === 2) {
          sprite.step = 0;
        }
        if (z === 0) {
          sprite.step = 1;
        }
        if (sprite.step) {
          z += 1;
        } else {
          z -= 1;
        }
        getDir(context, sprite.x, sprite.y, sprite.dest_x, sprite.dest_y);
        if (context.absDist < 60) {
          if (sprite.flag === 0) {
            sprite.flag = 1;
            sprite.dest_x = sprite.orig_x;
            sprite.dest_y = sprite.orig_y;
          } else {
            sprite.frame = 0;
            return;
          }
        }
        const dir = getDir(context, sprite.x, sprite.y, sprite.dest_x, sprite.dest_y);
        let c = Math.floor((dir - 1) / 2);
        if (c !== d && rand(context, 10) === 0) {
          if (rand16(context) & 1) {
            z = nd1[d] ?? 0;
          } else {
            z = nd2[d] ?? 0;
          }
          d = 4;
          if (!sprite.sound_count) {
            makeSound(context, 'city', 'Monster -speed [MonsterSpeed]');
            sprite.sound_count = 50 + rand(context, 100);
          }
        }
      } else {
        d = 4;
        const c = sprite.frame;
        z = (c - 13) & 3;
        if (!(rand16(context) & 3)) {
          if (rand16(context) & 1) {
            z = nn1[z] ?? 0;
          } else {
            z = nn2[z] ?? 0;
          }
          d = Math.floor((z - 1) / 3);
          z = (z - 1) % 3;
        }
      }
    }
  } else {
    d = sprite.control;
    z = (sprite.frame - 1) % 3;
    if (z === 2) {
      sprite.step = 0;
    }
    if (z === 0) {
      sprite.step = 1;
    }
    if (sprite.step) {
      z += 1;
    } else {
      z -= 1;
    }
  }

  z = d * 3 + z + 1;
  if (z > 16) {
    z = 16;
  }
  sprite.frame = z;

  sprite.x += gx[d] ?? 0;
  sprite.y += gy[d] ?? 0;

  if (sprite.count > 0) {
    sprite.count -= 1;
  }
  const c = getChar(map, sprite.x + sprite.x_hot, sprite.y + sprite.y_hot);
  if (c === -1 || (c === RIVER && sprite.count !== 0 && sprite.control === -1)) {
    sprite.frame = 0;
  }

  for (const s of context.sprites) {
    if (
      s.frame !== 0 &&
      (s.type === SPRITE_TYPE.AIR ||
        s.type === SPRITE_TYPE.COP ||
        s.type === SPRITE_TYPE.SHI ||
        s.type === SPRITE_TYPE.TRA) &&
      checkSpriteCollision(sprite, s)
    ) {
      explodeSprite(context, s);
    }
  }

  destroyTile(context, map, rateOGMem, sprite.x + 48, sprite.y + 16);
}

function doTornadoSprite(
  context: RealtimeContext,
  map: Uint16Array,
  rateOGMem: Int16Array,
  sprite: SimSprite,
) {
  const cdx = [2, 3, 2, 0, -2, -3];
  const cdy = [-2, 0, 2, 3, 2, 0];

  let z = sprite.frame;
  if (z === 2) {
    z = sprite.flag ? 3 : 1;
  } else {
    sprite.flag = z === 1 ? 1 : 0;
    z = 2;
  }

  if (sprite.count > 0) {
    sprite.count -= 1;
  }

  sprite.frame = z;

  for (const s of context.sprites) {
    if (
      s.frame !== 0 &&
      (s.type === SPRITE_TYPE.AIR ||
        s.type === SPRITE_TYPE.COP ||
        s.type === SPRITE_TYPE.SHI ||
        s.type === SPRITE_TYPE.TRA) &&
      checkSpriteCollision(sprite, s)
    ) {
      explodeSprite(context, s);
    }
  }

  z = rand(context, 5);
  sprite.x += cdx[z] ?? 0;
  sprite.y += cdy[z] ?? 0;
  if (spriteNotInBounds(sprite)) {
    sprite.frame = 0;
  }

  if (sprite.count !== 0 && rand(context, 500) === 0) {
    sprite.frame = 0;
  }

  destroyTile(context, map, rateOGMem, sprite.x + 48, sprite.y + 40);
}

function doExplosionSprite(context: RealtimeContext, map: Uint16Array, sprite: SimSprite) {
  if ((context.cycle & 1) === 0) {
    if (sprite.frame === 1) {
      makeSound(context, 'city', 'Explosion-High');
      const x = (sprite.x >> 4) + 3;
      const y = sprite.y >> 4;
      sendMessage(context, 32, x, y);
    }
    sprite.frame += 1;
  }

  if (sprite.frame > 6) {
    sprite.frame = 0;
    startFire(context, map, sprite.x + 40, sprite.y + 16);
    startFire(context, map, sprite.x + 24, sprite.y);
    startFire(context, map, sprite.x + 56, sprite.y);
    startFire(context, map, sprite.x + 24, sprite.y + 32);
    startFire(context, map, sprite.x + 56, sprite.y + 32);
  }
}

function doBusSprite(
  context: RealtimeContext,
  map: Uint16Array,
  trfDensity: Uint8Array,
  sprite: SimSprite,
) {
  const dxTable = [0, 1, 0, -1, 0];
  const dyTable = [-1, 0, 1, 0, 0];
  const dir2Frame = [1, 2, 1, 2];
  let dx = 0;
  let dy = 0;
  let turned = false;
  let speed = 0;

  if (sprite.turn) {
    if (sprite.turn < 0) {
      if (sprite.dir & 1) {
        sprite.frame = 4;
      } else {
        sprite.frame = 3;
      }
      sprite.turn += 1;
      sprite.dir = (sprite.dir - 1) & 3;
    } else {
      if (sprite.dir & 1) {
        sprite.frame = 3;
      } else {
        sprite.frame = 4;
      }
      sprite.turn -= 1;
      sprite.dir = (sprite.dir + 1) & 3;
    }
    turned = true;
  } else if (sprite.frame === 3 || sprite.frame === 4) {
    turned = true;
    sprite.frame = dir2Frame[sprite.dir] ?? sprite.frame;
  }

  if (sprite.speed === 0) {
    dx = 0;
    dy = 0;
  } else {
    const tx = (sprite.x + sprite.x_hot) >> 5;
    const ty = (sprite.y + sprite.y_hot) >> 5;
    let z = 0;
    if (tx >= 0 && tx < HWLDX && ty >= 0 && ty < HWLDY) {
      const density = trfDensity[trfIndex(tx, ty)];
      assertDefined(density);
      z = density >> 6;
      if (z > 1) {
        z -= 1;
      }
    }

    speed = 8;
    if (z === 1) {
      speed = 4;
    } else if (z === 2) {
      speed = 1;
    }

    if (speed > sprite.speed) {
      speed = sprite.speed;
    }

    if (turned) {
      if (speed > 1) {
        speed = 1;
      }
      dx = (dxTable[sprite.dir] ?? 0) * speed;
      dy = (dyTable[sprite.dir] ?? 0) * speed;
    } else {
      dx = (dxTable[sprite.dir] ?? 0) * speed;
      dy = (dyTable[sprite.dir] ?? 0) * speed;

      const tx2 = (sprite.x + sprite.x_hot) >> 4;
      const ty2 = (sprite.y + sprite.y_hot) >> 4;

      switch (sprite.dir) {
        case 0: {
          const z2 = (tx2 << 4) + 4 - (sprite.x + sprite.x_hot);
          if (z2 < 0) {
            dx = -1;
          } else if (z2 > 0) {
            dx = 1;
          }
          break;
        }
        case 1: {
          const z2 = (ty2 << 4) + 4 - (sprite.y + sprite.y_hot);
          if (z2 < 0) {
            dy = -1;
          } else if (z2 > 0) {
            dy = 1;
          }
          break;
        }
        case 2: {
          const z2 = (tx2 << 4) - (sprite.x + sprite.x_hot);
          if (z2 < 0) {
            dx = -1;
          } else if (z2 > 0) {
            dx = 1;
          }
          break;
        }
        case 3: {
          const z2 = (ty2 << 4) - (sprite.y + sprite.y_hot);
          if (z2 < 0) {
            dy = -1;
          } else if (z2 > 0) {
            dy = 1;
          }
          break;
        }
        default:
          break;
      }
    }
  }

  const ahead = 8;
  let otx = (sprite.x + sprite.x_hot + (dxTable[sprite.dir] ?? 0) * ahead) >> 4;
  let oty = (sprite.y + sprite.y_hot + (dyTable[sprite.dir] ?? 0) * ahead) >> 4;
  if (otx < 0) {
    otx = 0;
  } else if (otx >= WORLD_X) {
    otx = WORLD_X - 1;
  }
  if (oty < 0) {
    oty = 0;
  } else if (oty >= WORLD_Y) {
    oty = WORLD_Y - 1;
  }

  let tx = (sprite.x + sprite.x_hot + dx + (dxTable[sprite.dir] ?? 0) * ahead) >> 4;
  let ty = (sprite.y + sprite.y_hot + dy + (dyTable[sprite.dir] ?? 0) * ahead) >> 4;
  if (tx < 0) {
    tx = 0;
  } else if (tx >= WORLD_X) {
    tx = WORLD_X - 1;
  }
  if (ty < 0) {
    ty = 0;
  } else if (ty >= WORLD_Y) {
    ty = WORLD_Y - 1;
  }

  if (tx !== otx || ty !== oty) {
    const z = canDriveOn(map, tx, ty);
    if (z === 0) {
      if (speed === 8) {
        bulldozeTile(context, tx, ty);
      }
    } else if (z < 0) {
      dx = Math.trunc(dx / 2);
      dy = Math.trunc(dy / 2);
    }
  }

  sprite.x += dx;
  sprite.y += dy;

  if (!context.noDisasters) {
    let explode = false;
    for (const s of context.sprites) {
      if (
        sprite !== s &&
        s.frame !== 0 &&
        (s.type === SPRITE_TYPE.BUS || (s.type === SPRITE_TYPE.TRA && s.frame !== 5)) &&
        checkSpriteCollision(sprite, s)
      ) {
        explodeSprite(context, s);
        explode = true;
      }
    }
    if (explode) {
      explodeSprite(context, sprite);
    }
  }
}

function canDriveOn(map: Uint16Array, x: number, y: number): number {
  if (!testBounds(x, y)) {
    return 0;
  }
  const _t = tileAt(map, x, y);
  assertDefined(_t);
  const tile = _t & LOMASK;
  if (
    (tile >= ROADBASE && tile <= LASTROAD && tile !== BRWH && tile !== BRWV) ||
    tile === HRAILROAD ||
    tile === VRAILROAD
  ) {
    return 1;
  }
  if (tile === DIRT || tally(tile)) {
    return -1;
  }
  return 0;
}

export function explodeSprite(context: RealtimeContext, sprite: SimSprite) {
  sprite.frame = 0;

  const x = sprite.x + sprite.x_hot;
  const y = sprite.y + sprite.y_hot;
  makeExplosionAt(context, x, y);

  const tx = x >> 4;
  const ty = y >> 4;

  switch (sprite.type) {
    case SPRITE_TYPE.AIR:
      context.crashX = tx;
      context.crashY = ty;
      sendMessage(context, -24, tx, ty);
      break;
    case SPRITE_TYPE.SHI:
      context.crashX = tx;
      context.crashY = ty;
      sendMessage(context, -25, tx, ty);
      break;
    case SPRITE_TYPE.TRA:
      context.crashX = tx;
      context.crashY = ty;
      sendMessage(context, -26, tx, ty);
      break;
    case SPRITE_TYPE.COP:
      context.crashX = tx;
      context.crashY = ty;
      sendMessage(context, -27, tx, ty);
      break;
    case SPRITE_TYPE.BUS:
      context.crashX = tx;
      context.crashY = ty;
      sendMessage(context, -26, tx, ty);
      break;
    default:
      break;
  }

  makeSound(context, 'city', 'Explosion-High');
}

export function generateTrain(context: RealtimeContext, x: number, y: number) {
  if (
    context.totalPop > 20 &&
    getSprite(context, SPRITE_TYPE.TRA) === null &&
    rand(context, 25) === 0
  ) {
    makeSprite(context, SPRITE_TYPE.TRA, (x << 4) + TRA_GROOVE_X, (y << 4) + TRA_GROOVE_Y);
  }
}

export function generateBus(context: RealtimeContext, x: number, y: number) {
  if (getSprite(context, SPRITE_TYPE.BUS) === null && rand(context, 25) === 0) {
    makeSprite(context, SPRITE_TYPE.BUS, (x << 4) + BUS_GROOVE_X, (y << 4) + BUS_GROOVE_Y);
  }
}

export function generateShip(context: RealtimeContext) {
  const map = context.store.getLayer('map') as Uint16Array;
  if ((rand16(context) & 3) === 0) {
    for (let x = 4; x < WORLD_X - 2; x += 1) {
      if (tileAt(map, x, 0) === CHANNEL) {
        makeShipHere(context, x, 0);
        return;
      }
    }
  }
  if ((rand16(context) & 3) === 0) {
    for (let y = 1; y < WORLD_Y - 2; y += 1) {
      if (tileAt(map, 0, y) === CHANNEL) {
        makeShipHere(context, 0, y);
        return;
      }
    }
  }
  if ((rand16(context) & 3) === 0) {
    for (let x = 4; x < WORLD_X - 2; x += 1) {
      if (tileAt(map, x, WORLD_Y - 1) === CHANNEL) {
        makeShipHere(context, x, WORLD_Y - 1);
        return;
      }
    }
  }
  if ((rand16(context) & 3) === 0) {
    for (let y = 1; y < WORLD_Y - 2; y += 1) {
      if (tileAt(map, WORLD_X - 1, y) === CHANNEL) {
        makeShipHere(context, WORLD_X - 1, y);
        return;
      }
    }
  }
}

function makeShipHere(context: RealtimeContext, x: number, y: number) {
  makeSprite(context, SPRITE_TYPE.SHI, (x << 4) - 47, y << 4);
}

export function generateCopter(context: RealtimeContext, x: number, y: number) {
  if (getSprite(context, SPRITE_TYPE.COP)) {
    return;
  }
  makeSprite(context, SPRITE_TYPE.COP, x << 4, (y << 4) + 30);
}

export function generatePlane(context: RealtimeContext, x: number, y: number) {
  if (getSprite(context, SPRITE_TYPE.AIR)) {
    return;
  }
  makeSprite(context, SPRITE_TYPE.AIR, (x << 4) + 48, (y << 4) + 12);
}

export function makeMonster(context: RealtimeContext) {
  const existing = getSprite(context, SPRITE_TYPE.GOD);
  if (existing) {
    existing.sound_count = 1;
    existing.count = 1000;
    existing.dest_x = context.polMaxX << 4;
    existing.dest_y = context.polMaxY << 4;
    return;
  }

  const map = context.store.getLayer('map') as Uint16Array;
  let done = false;
  for (let z = 0; z < 300; z += 1) {
    const x = rand(context, WORLD_X - 20) + 10;
    const y = rand(context, WORLD_Y - 10) + 5;
    const value = tileAt(map, x, y);
    if (value === RIVER || value === RIVER + BULLBIT) {
      monsterHere(context, x, y);
      done = true;
      break;
    }
  }
  if (!done) {
    monsterHere(context, 60, 50);
  }
}

function monsterHere(context: RealtimeContext, x: number, y: number) {
  makeSprite(context, SPRITE_TYPE.GOD, (x << 4) + 48, y << 4);
  clearMessages(context);
  sendMessage(context, -21, x + 5, y);
}

export function makeTornado(context: RealtimeContext) {
  const existing = getSprite(context, SPRITE_TYPE.TOR);
  if (existing) {
    existing.count = 200;
    return;
  }
  const x = rand(context, (WORLD_X << 4) - 800) + 400;
  const y = rand(context, (WORLD_Y << 4) - 200) + 100;
  makeSprite(context, SPRITE_TYPE.TOR, x, y);
  clearMessages(context);
  sendMessage(context, -22, (x >> 4) + 3, (y >> 4) + 2);
}

export function makeExplosion(context: RealtimeContext, x: number, y: number) {
  if (x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y) {
    makeExplosionAt(context, (x << 4) + 8, (y << 4) + 8);
  }
}

export function makeExplosionAt(context: RealtimeContext, x: number, y: number) {
  makeNewSprite(context, SPRITE_TYPE.EXP, x - 40, y - 16);
}
