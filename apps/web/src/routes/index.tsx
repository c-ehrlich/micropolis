import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

import { MapCanvas } from '../game/map/map-canvas.tsx';
import {
  type ClientEnvelope,
  type CoreHost,
  type CoreHostConnection,
  createWebHostRuntime,
  type HostEnvelope,
  type WebRuntimeState,
} from '../game/runtime/index.ts';

const DEMO_WORLD_WIDTH = 120;
const DEMO_WORLD_HEIGHT = 100;
const DEMO_PATCH_INTERVAL_MS = 180;
const DEMO_PATCH_TILE_COUNT = 28;

export const Route = createFileRoute('/')({
  component: HomePage,
});

/**
 * Deterministic local map host used for Stage 2 map rendering bring-up.
 * Mirrors authoritative map update cadence intent from
 * `ref/micropolis/src/sim/w_map.c` + `ref/micropolis/src/sim/g_map.c`.
 * Difference: this is a scripted bridge-host stand-in and not full sim-core.
 */
class DemoMapHost implements CoreHost {
  private onEnvelope: ((envelope: HostEnvelope) => void) | undefined;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private serverSeq = 0;
  private tick = 0;
  private rngState = 0x12345678;
  private readonly mapTiles = buildInitialDemoMapTiles(DEMO_WORLD_WIDTH, DEMO_WORLD_HEIGHT);

  connect(onEnvelope: (envelope: HostEnvelope) => void): CoreHostConnection {
    this.onEnvelope = onEnvelope;

    return {
      send: (envelope) => {
        this.handleClientEnvelope(envelope);
      },
      disconnect: () => {
        this.stopInterval();
        this.onEnvelope = undefined;
      },
    };
  }

  private handleClientEnvelope(envelope: ClientEnvelope): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    if (envelope.kind === 'hello') {
      this.onEnvelope({
        kind: 'hello',
        roomId: envelope.roomId,
        clientId: envelope.clientId,
        protocolVersion: envelope.protocolVersion,
        coreVersion: envelope.coreVersion,
        accepted: true,
      });

      this.emitSnapshot(envelope.roomId, envelope.clientId);
      this.startInterval(envelope.roomId, envelope.clientId);
      return;
    }

    if (envelope.kind === 'request_snapshot') {
      this.emitSnapshot(envelope.roomId, envelope.clientId);
    }
  }

  private emitSnapshot(roomId: string, clientId: string): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    this.serverSeq += 1;
    this.onEnvelope({
      kind: 'snapshot',
      roomId,
      clientId,
      tick: this.tick,
      serverSeq: this.serverSeq,
      payload: {
        map: {
          width: DEMO_WORLD_WIDTH,
          height: DEMO_WORLD_HEIGHT,
          tiles: this.mapTiles.slice(),
        },
      },
    });
  }

  private emitPatch(roomId: string, clientId: string): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    const deltas: Array<{ index: number; tile: number }> = [];
    for (let i = 0; i < DEMO_PATCH_TILE_COUNT; i += 1) {
      const index = this.nextRandom() % this.mapTiles.length;
      const currentTile = this.mapTiles[index];
      if (currentTile === undefined) {
        continue;
      }
      const nextTile = (currentTile + 1 + (this.tick & 31) + i) & 0xffff;
      this.mapTiles[index] = nextTile;
      deltas.push({ index, tile: nextTile });
    }

    if (deltas.length === 0) {
      return;
    }

    this.tick += 1;
    this.serverSeq += 1;
    this.onEnvelope({
      kind: 'patch',
      roomId,
      clientId,
      tick: this.tick,
      serverSeq: this.serverSeq,
      payload: {
        map: {
          tiles: deltas,
        },
      },
    });
  }

  private startInterval(roomId: string, clientId: string): void {
    this.stopInterval();
    this.intervalHandle = setInterval(() => {
      this.emitPatch(roomId, clientId);
    }, DEMO_PATCH_INTERVAL_MS);
  }

  private stopInterval(): void {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  private nextRandom(): number {
    // Keeps deterministic host updates across runs, similar in spirit to C RNG.
    this.rngState = (Math.imul(this.rngState, 1103515245) + 12345) >>> 0;
    return this.rngState;
  }
}

/**
 * Builds an initial deterministic tile baseline for the Stage 2 debug map view.
 * Mirrors map-buffer baseline setup intent from `ref/micropolis/src/sim/g_map.c`.
 * Difference: values are synthetic so UI work can proceed before full art parity.
 */
function buildInitialDemoMapTiles(width: number, height: number): Uint16Array {
  const tiles = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const band = (x >> 3) & 31;
      const stripe = (y >> 2) & 31;
      tiles[index] = ((band << 8) | stripe) & 0xffff;
    }
  }
  return tiles;
}

/**
 * Stage 2 route that renders a live map projection sourced from host envelopes.
 * Mirrors map-view refresh flow from `ref/micropolis/src/sim/w_map.c`, adapted
 * to React + canvas with explicit bridge sequencing state.
 */
function HomePage() {
  const runtime = useMemo(() => createWebHostRuntime({ host: new DemoMapHost() }), []);
  const [state, setState] = useState<WebRuntimeState>(() => runtime.getState());

  useEffect(() => {
    const unsubscribe = runtime.subscribe((event) => {
      setState(event.state);
    });

    runtime.connect();
    return () => {
      unsubscribe();
      runtime.disconnect();
    };
  }, [runtime]);

  return (
    <main
      style={{
        display: 'grid',
        gap: 12,
        padding: 16,
      }}
    >
      <h1 style={{ fontSize: 20, margin: 0 }}>Stage 2 Simple UI: Ordered Map Stream</h1>
      <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
        phase={state.phase} seq={state.lastAppliedServerSeq} tick={state.lastAppliedTick}
      </div>
      <MapCanvas mapState={state.mapState} tileSize={5} />
    </main>
  );
}
