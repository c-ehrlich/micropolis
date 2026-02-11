import { describe, expect, it } from 'vitest';

import {
  lookupDoMessageText,
  lookupStri301MessageText,
  MICROPOLIS_STRI_301_LINES,
} from './message-table.ts';

describe('stri.301 message table parity', () => {
  it('bundles the canonical 64-line Micropolis message text payload', () => {
    // Canonical line count source: `ref/micropolis/res/stri.301`, loaded by
    // `GetIndString(..., 301, ...)` in `ref/micropolis/src/sim/w_resrc.c`.
    expect(MICROPOLIS_STRI_301_LINES).toHaveLength(64);
    expect(lookupStri301MessageText(1)).toBe('More residential zones needed.');
    expect(lookupStri301MessageText(10)).toBe('Pollution very high.');
    expect(lookupStri301MessageText(11)).toBe('Crime very high.');
    expect(lookupStri301MessageText(14)).toBe('Citizens demand a Police Department.');
    expect(lookupStri301MessageText(16)).toBe('Citizens upset. The tax rate is too high.');
    expect(lookupStri301MessageText(20)).toBe('Fire reported !');
    expect(lookupStri301MessageText(32)).toBe('Explosion detected !');
    expect(lookupStri301MessageText(43)).toBe('A Nuclear Meltdown has occurred !!!');
    expect(lookupStri301MessageText(49)).toBe('Restored a Saved City.');
    expect(lookupStri301MessageText(64)).toBe('x');
  });

  it('keeps doMessage picture/text ids text-equivalent', () => {
    // `doMessage` in `ref/micropolis/src/sim/s_msg.c` converts picture ids
    // (`MesNum < 0`) via `pictId = -MesNum` then requeues `MessagePort = pictId`
    // for the next cycle's positive text id.
    expect(lookupDoMessageText(-11)).toBe('Crime very high.');
    expect(lookupDoMessageText(11)).toBe('Crime very high.');
    expect(lookupDoMessageText(-43)).toBe('A Nuclear Meltdown has occurred !!!');
    expect(lookupDoMessageText(43)).toBe('A Nuclear Meltdown has occurred !!!');
  });

  it('returns undefined for non-message ids outside the 1-based table', () => {
    expect(lookupStri301MessageText(0)).toBeUndefined();
    expect(lookupStri301MessageText(65)).toBeUndefined();
    expect(lookupDoMessageText(0)).toBeUndefined();
    expect(lookupDoMessageText(Number.NaN)).toBeUndefined();
  });
});
