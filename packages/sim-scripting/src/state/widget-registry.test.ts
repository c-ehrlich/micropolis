import { describe, expect, it } from 'vitest';

import { WidgetRegistry } from './widget-registry.ts';

describe('widget registry', () => {
  it('adds, gets, and removes named widgets', () => {
    // Mirrors command lookup lifecycle for custom Tcl widgets registered from
    // `ref/micropolis/src/sim/w_tk.c` (`piemenu`, `interval`, and command-backed widgets).
    const registry = new WidgetRegistry<{ readonly visible: boolean }>();
    const widget = { visible: true };
    registry.add('.budget', widget);

    expect(registry.size).toBe(1);
    expect(registry.get('.budget')).toBe(widget);
    expect(registry.remove('.budget')).toBe(widget);
    expect(registry.get('.budget')).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it('rejects duplicate widget names', () => {
    const registry = new WidgetRegistry();
    registry.add('.pie', { id: 1 });

    expect(() => registry.add('.pie', { id: 2 })).toThrowError('widget already exists: .pie');
  });
});
