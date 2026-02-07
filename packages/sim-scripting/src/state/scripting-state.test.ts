import { describe, expect, it } from 'vitest';

import { createScriptingState } from './scripting-state.ts';

describe('scripting state', () => {
  it('creates state with sim/view/widget/sprite/callback references', () => {
    // Mirrors the Tcl bridge object graph rooted from `sim`/views/sprites/callback
    // procedures described in `ref/micropolis/spec/scripting/SPEC.md`.
    const state = createScriptingState<
      { readonly cityName: string },
      { readonly viewId: string },
      { readonly spriteId: string },
      { readonly widgetId: string }
    >({
      sim: { cityName: 'Capitol' },
      callbackEntries: [['UISetFunds', '::ui::setFunds']],
    });

    state.views.add('.editor.main', { viewId: 'editor-1' });
    state.sprites.add('copter', { spriteId: 'sprite-1' });
    state.widgets.add('.pie.main', { widgetId: 'widget-1' });

    expect(state.sim).toEqual({ cityName: 'Capitol' });
    expect(state.views.get('.editor.main')).toEqual({ viewId: 'editor-1' });
    expect(state.sprites.get('copter')).toEqual({ spriteId: 'sprite-1' });
    expect(state.widgets.get('.pie.main')).toEqual({ widgetId: 'widget-1' });
    expect(state.callbacks.get('UISetFunds')).toBe('::ui::setFunds');
  });
});
