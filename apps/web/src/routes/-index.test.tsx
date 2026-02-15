// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { getCoreBridgeV1SnapshotTileIndex } from '../../../../packages/core-bridge/src/types.ts';
import { triggerRouteDisasterControl } from '../features/playable-runtime/behavior/runtime-panel-behavior.ts';
import {
  createPlayableRuntimeHost,
  PLAYABLE_DISASTER_CHOICES,
} from '../game/runtime/playable-runtime-host.ts';
import type { HostEnvelope } from '../game/runtime/protocol.ts';
import { SimCoreEnvelopeHost } from '../game/runtime/sim-core-envelope-host.ts';
import { Route } from './index.tsx';

const WEB_WORKSPACE_ROOT = process.cwd().endsWith('/apps/web')
  ? process.cwd()
  : resolve(process.cwd(), 'apps/web');
const ROUTE_TREE_SOURCE_PATH = resolve(WEB_WORKSPACE_ROOT, 'src/routeTree.gen.ts');

/**
 * Builds the legacy synthetic snapshot baseline in bridge x-major order.
 * Mirrors the deleted synthetic bootstrap + x-major copy behavior that previously
 * existed before sim-core-authoritative route `/` cutover.
 * Parity note: this intentionally does not mirror Micropolis C map generation;
 * it exists only as a regression sentinel against reintroducing synthetic tiles on `/`.
 */
function buildLegacySyntheticSnapshotTileWords(width: number, height: number): Uint16Array {
  const tileWords = new Uint16Array(width * height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const band = (x >> 3) & 31;
      const stripe = (y >> 2) & 31;
      const syntheticTileWord = ((band << 8) | stripe) & 0xffff;
      const bridgeIndex = getCoreBridgeV1SnapshotTileIndex(x, y, height);
      tileWords[bridgeIndex] = syntheticTileWord;
    }
  }
  return tileWords;
}

/**
 * Default Authoritative Runtime route ownership checks for `/`.
 * Mirrors the single gameplay command-surface routing intent in
 * `ref/micropolis/src/sim/w_sim.c`, where users enter one primary path.
 */
describe('routes/index default gameplay path', () => {
  test('keeps root route id at "/" and renders the Authoritative Runtime gameplay panel', () => {
    const routeTreeSource = readFileSync(ROUTE_TREE_SOURCE_PATH, 'utf8');
    expect(routeTreeSource).toContain("path: '/'");
    expect(routeTreeSource).toContain("fullPath: '/'");

    const component = Route.options.component;
    expect(typeof component).toBe('function');
    if (component === undefined) {
      throw new Error('Expected root route component to be defined');
    }

    const markup = renderToStaticMarkup(React.createElement(component));
    expect(markup).toContain('Micropolis');
    expect(markup).toContain('Settings');
    expect(markup).toContain('Play');
    expect(markup).toContain('accept=".json,application/json"');
    expect(markup).toContain('Road: $10');
    expect(markup).toContain('Message Feed');
    expect(markup).toContain('Demand heads R 0, C 0, I 0');
  });

  test('creates a SimCoreEnvelopeHost for the route runtime', () => {
    const host = createPlayableRuntimeHost();
    expect(host).toBeInstanceOf(SimCoreEnvelopeHost);
  });

  test('keeps manual disaster controls working on "/" with SimCoreEnvelopeHost', () => {
    const host = new SimCoreEnvelopeHost();
    const hostEnvelopes: HostEnvelope[] = [];
    const connection = host.connect((envelope) => {
      hostEnvelopes.push(envelope);
    });

    try {
      connection.send({
        kind: 'hello',
        roomId: 'route-manual-disaster-room',
        clientId: 'route-manual-disaster-client',
        protocolVersion: 'bridge-v1',
        coreVersion: 'sim-core',
      });

      const earthquakeChoice = PLAYABLE_DISASTER_CHOICES.find(
        (choice) => choice.id === 'earthquake',
      );
      if (earthquakeChoice === undefined) {
        throw new Error('Expected earthquake disaster choice to exist');
      }

      const envelopeCountBeforeTrigger = hostEnvelopes.length;
      const status = triggerRouteDisasterControl(host, earthquakeChoice.id, earthquakeChoice.label);
      expect(status).toBe('Trigger Earthquake.');

      const newEnvelopes = hostEnvelopes.slice(envelopeCountBeforeTrigger);
      const earthquakePatch = newEnvelopes.find((envelope) => envelope.kind === 'patch');
      if (earthquakePatch === undefined) {
        throw new Error('Expected route disaster control trigger to emit a patch envelope');
      }

      // Message id `-23` comes from `MakeEarthquake` -> `SendMesAt` in
      // `ref/micropolis/src/sim/s_disast.c`.
      expect(earthquakePatch.payload.messageDeltas?.some((message) => message.id === -23)).toBe(
        true,
      );
    } finally {
      connection.disconnect();
    }
  });

  test('keeps "/" initial map authoritative sim-core output (not synthetic demo tiles)', () => {
    const host = createPlayableRuntimeHost();
    const hostEnvelopes: HostEnvelope[] = [];
    const connection = host.connect((envelope) => {
      hostEnvelopes.push(envelope);
    });

    try {
      connection.send({
        kind: 'hello',
        roomId: 'route-initial-map-room',
        clientId: 'route-initial-map-client',
        protocolVersion: 'bridge-v1',
        coreVersion: 'sim-core',
      });

      const snapshot = hostEnvelopes.find((envelope) => envelope.kind === 'snapshot');
      if (snapshot === undefined || snapshot.kind !== 'snapshot') {
        throw new Error('Expected route host to emit initial snapshot');
      }

      const map = snapshot.payload.map;
      if (map === undefined || !('tileWords' in map)) {
        throw new Error('Expected route snapshot map tileWords payload');
      }
      if (!(map.tileWords instanceof Uint16Array)) {
        throw new Error('Expected route snapshot map tileWords to be Uint16Array');
      }

      const authoritativeMapLayer = (
        host as unknown as {
          authorityState: {
            store: {
              snapshot(layer: 'map'): Uint16Array | unknown;
            };
          };
        }
      ).authorityState.store.snapshot('map');
      if (!(authoritativeMapLayer instanceof Uint16Array)) {
        throw new Error('Expected authoritative sim-core map layer snapshot');
      }

      expect(map.tileWords).not.toBe(authoritativeMapLayer);
      expect(map.tileWords).toEqual(authoritativeMapLayer);

      const legacySyntheticMap = buildLegacySyntheticSnapshotTileWords(map.width, map.height);
      expect(map.tileWords).not.toEqual(legacySyntheticMap);
    } finally {
      connection.disconnect();
    }
  });
});
