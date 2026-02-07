import { describe, expect, it } from 'vitest';

import { ViewRegistry } from './view-registry.ts';

describe('view registry', () => {
  it('adds, gets, and removes named views', () => {
    // Mirrors view command lifecycle around `Tcl_CreateCommand` for map/editor views
    // in `ref/micropolis/src/sim/w_tk.c` and `ref/micropolis/src/sim/w_map.c`.
    const registry = new ViewRegistry<{ readonly id: string }>();
    const view = { id: 'main-editor' };
    registry.add('.editor.main', view);

    expect(registry.size).toBe(1);
    expect(registry.get('.editor.main')).toBe(view);
    expect(registry.remove('.editor.main')).toBe(view);
    expect(registry.get('.editor.main')).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it('rejects duplicate view names', () => {
    const registry = new ViewRegistry();
    registry.add('.editor.main', { tag: 1 });

    expect(() => registry.add('.editor.main', { tag: 2 })).toThrowError(
      'view already exists: .editor.main',
    );
  });
});
