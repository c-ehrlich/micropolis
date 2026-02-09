import { describe, expect, it } from 'vitest';

import ROUTE_SOURCE from './index.tsx?raw';

describe('web route runtime boundaries', () => {
  it('documents Stage 0 surface convergence on the surviving `/` gameplay route', () => {
    expect(ROUTE_SOURCE).toContain("const SURVIVING_GAMEPLAY_ROUTE_PATH = '/'");
    expect(ROUTE_SOURCE).toContain('apps/web/src/game/core-host.ts');
    expect(ROUTE_SOURCE).toContain('apps/web/src/game/runtime/protocol.ts');
  });

  it('removes the Stage 2/Stage 4 runtime mode toggle from the primary `/` route', () => {
    expect(ROUTE_SOURCE).not.toContain('Stage 4 Runtime (Default)');
    expect(ROUTE_SOURCE).not.toContain('Stage 2 Demo Map');
    expect(ROUTE_SOURCE).toContain('<Stage4RuntimePanel />');
  });

  it('projects Stage 4 from authoritative snapshot/patch runtime state', () => {
    expect(ROUTE_SOURCE).toContain('createWebHostRuntime({ host: new DemoMapHost() })');
    expect(ROUTE_SOURCE).toContain('mapState={state.mapState}');
    expect(ROUTE_SOURCE).toContain('tileSize={STAGE4_MAP_TILE_SIZE}');
    expect(ROUTE_SOURCE).toContain("kind: 'tool'");
    expect(ROUTE_SOURCE).toContain('runtime.sendCommand');
    expect(ROUTE_SOURCE).toContain('Stage 4 Runtime');
  });

  it('renders Stage 4 HUD labels directly from authoritative hudState fields', () => {
    expect(ROUTE_SOURCE).toContain('{state.hudState.fundsLabel}');
    expect(ROUTE_SOURCE).toContain('{state.hudState.dateDisplayLabel}');
    expect(ROUTE_SOURCE).toContain('{state.hudState.demandLabel}');
    expect(ROUTE_SOURCE).toContain('{state.hudState.speedLabel}');
    expect(ROUTE_SOURCE).not.toContain('formatSpeedLabel(');
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
