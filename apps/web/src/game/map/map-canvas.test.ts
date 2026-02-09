import { describe, expect, it } from 'vitest';

import { selectMapCanvasDrawMode } from './map-canvas.tsx';

describe('map canvas draw-mode selection', () => {
  it('keeps full redraw ownership for authoritative snapshot frames', () => {
    expect(
      selectMapCanvasDrawMode({
        mapDrawMode: 'snapshot',
        renderEpoch: 3,
        lastRenderedEpoch: 2,
        resized: false,
      }),
    ).toBe('snapshot');
  });

  it('forces full redraw when canvas backing store was reset', () => {
    expect(
      selectMapCanvasDrawMode({
        mapDrawMode: 'patch',
        renderEpoch: 4,
        lastRenderedEpoch: 3,
        resized: true,
      }),
    ).toBe('snapshot');
  });

  it('forces full redraw for first authoritative paint', () => {
    expect(
      selectMapCanvasDrawMode({
        mapDrawMode: 'patch',
        renderEpoch: 2,
        lastRenderedEpoch: 0,
        resized: false,
      }),
    ).toBe('snapshot');
  });

  it('forces full redraw when runtime skipped intermediate map epochs', () => {
    // Stage 4 runtime envelopes can be batched by React state updates; when
    // more than one map epoch is skipped, redraw from full authoritative tiles.
    expect(
      selectMapCanvasDrawMode({
        mapDrawMode: 'patch',
        renderEpoch: 9,
        lastRenderedEpoch: 6,
        resized: false,
      }),
    ).toBe('snapshot');
  });

  it('keeps patch redraw when epochs are contiguous', () => {
    expect(
      selectMapCanvasDrawMode({
        mapDrawMode: 'patch',
        renderEpoch: 7,
        lastRenderedEpoch: 6,
        resized: false,
      }),
    ).toBe('patch');
  });
});
