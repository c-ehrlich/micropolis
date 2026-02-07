import { describe, expect, it } from 'vitest';

import { SpriteRegistry } from './sprite-registry.ts';

describe('sprite registry', () => {
  it('adds, gets, and removes named sprites', () => {
    // Mirrors named sprite command lifecycle in `ref/micropolis/src/sim/w_sprite.c`
    // where `SpriteCmd` creates a Tcl command per sprite name.
    const registry = new SpriteRegistry<{ readonly frame: number }>();
    const sprite = { frame: 1 };
    registry.add('godzilla', sprite);

    expect(registry.size).toBe(1);
    expect(registry.get('godzilla')).toBe(sprite);
    expect(registry.remove('godzilla')).toBe(sprite);
    expect(registry.get('godzilla')).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it('rejects duplicate sprite names', () => {
    const registry = new SpriteRegistry();
    registry.add('copter', { id: 1 });

    expect(() => registry.add('copter', { id: 2 })).toThrowError('sprite already exists: copter');
  });
});
