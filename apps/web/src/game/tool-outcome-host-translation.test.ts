import { describe, expect, test } from 'vitest';

import {
  createOutOfBoundsHostRejectOutcome,
  translateToolResultToHostOutcome,
} from './tool-outcome-host-translation';

describe('tool outcome host translation', () => {
  test('maps each sim-core tool result to a stable host outcome payload', () => {
    expect(translateToolResultToHostOutcome('ok')).toEqual({ kind: 'ack' });
    expect(translateToolResultToHostOutcome('out-of-bounds')).toEqual({
      kind: 'reject',
      code: 'OUT_OF_BOUNDS',
      message: 'tool coordinates are out of bounds',
    });
    expect(translateToolResultToHostOutcome('no-funds')).toEqual({
      kind: 'reject',
      code: 'NO_FUNDS',
      message: 'insufficient funds for tool placement',
    });
    expect(translateToolResultToHostOutcome('reject')).toEqual({
      kind: 'reject',
      code: 'INVALID_PLACEMENT',
      message: 'tool placement was rejected by simulation rules',
    });
  });

  test('reuses the same out-of-bounds reject payload for coordinate preflight rejects', () => {
    expect(createOutOfBoundsHostRejectOutcome()).toEqual(
      translateToolResultToHostOutcome('out-of-bounds'),
    );
  });
});
