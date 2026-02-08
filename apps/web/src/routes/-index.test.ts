import { describe, expect, it } from 'vitest';

import ROUTE_SOURCE from './index.tsx?raw';

describe('stage 2 route boundaries', () => {
  it('does not import sim-core directly from UI route components', () => {
    // Stage plan rule: UI must consume host/runtime envelopes and avoid direct
    // simulation mutation entry points.
    expect(ROUTE_SOURCE).not.toMatch(/@city\/sim-core/);
    expect(ROUTE_SOURCE).not.toMatch(/packages\/sim-core/);
  });

  it('keeps sim-control interactions routed through runtime command envelopes', () => {
    expect(ROUTE_SOURCE).toContain("kind: 'sim-control'");
    expect(ROUTE_SOURCE).toContain('runtime.sendCommand');
  });

  it('keeps city save/load/scenario interactions routed through runtime command envelopes', () => {
    expect(ROUTE_SOURCE).toContain("kind: 'city-io'");
    expect(ROUTE_SOURCE).toContain("kind: 'city-lifecycle'");
    expect(ROUTE_SOURCE).toContain("kind: 'scenario'");
    expect(ROUTE_SOURCE).toContain('runtime.sendCommand');
  });
});
