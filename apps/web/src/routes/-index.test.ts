import { describe, expect, it } from 'vitest';

import ROUTE_SOURCE from './index.tsx?raw';

describe('web route runtime boundaries', () => {
  it('keeps a top-level runtime view toggle so Stage 4 and Stage 2 panels are both reachable', () => {
    expect(ROUTE_SOURCE).toContain('Stage 4 Runtime (Default)');
    expect(ROUTE_SOURCE).toContain('Stage 2 Demo Map');
  });

  it('wires Stage 4 panel state from the shared runtime singleton', () => {
    expect(ROUTE_SOURCE).toContain('gameRuntime.subscribeState');
    expect(ROUTE_SOURCE).toContain('describeRuntimeStatus');
    expect(ROUTE_SOURCE).toContain("type: 'tool-command'");
    expect(ROUTE_SOURCE).toContain('gameRuntime.sendCommand');
    expect(ROUTE_SOURCE).toContain('Authoritative Placement Map');
  });

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

  it('routes reconnect and resync UX actions through runtime host APIs', () => {
    expect(ROUTE_SOURCE).toContain('runtime.reconnect');
    expect(ROUTE_SOURCE).toContain("runtime.requestSnapshot('resync')");
  });
});
