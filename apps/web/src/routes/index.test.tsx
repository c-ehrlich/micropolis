import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { PLAYABLE_DISASTER_CHOICES } from '../game/runtime/playable-runtime-host.ts';
import type { HostEnvelope } from '../game/runtime/protocol.ts';
import { SimCoreEnvelopeHost } from '../game/runtime/sim-core-envelope-host.ts';
import { Route, triggerRouteDisasterControl } from './index.tsx';

/**
 * Default Authoritative Runtime route ownership checks for `/`.
 * Mirrors the single gameplay command-surface routing intent in
 * `ref/micropolis/src/sim/w_sim.c`, where users enter one primary path.
 */
describe('routes/index default gameplay path', () => {
  test('keeps root route id at "/" and renders the Authoritative Runtime gameplay panel', () => {
    const routeTreeSource = readFileSync(
      fileURLToPath(new URL('../routeTree.gen.ts', import.meta.url)),
      'utf8',
    );
    expect(routeTreeSource).toContain("path: '/'");
    expect(routeTreeSource).toContain("fullPath: '/'");

    const component = Route.options.component;
    expect(typeof component).toBe('function');
    if (component === undefined) {
      throw new Error('Expected root route component to be defined');
    }

    const markup = renderToStaticMarkup(React.createElement(component));
    expect(markup).toContain('City Runtime');
    expect(markup).toContain('Authoritative Runtime Runtime');
    expect(markup).toContain('Sound Test');
    expect(markup).toContain('surviving gameplay route is');
    expect(markup).toContain('Envelope runtime contract for `/`');
    expect(markup).toContain('apps/web/src/game/runtime/protocol.ts');
    expect(markup).toContain('Micropolis');
  });

  test('keeps manual disaster controls working on "/" with SimCoreEnvelopeHost (no DemoMapHost)', () => {
    const host = new SimCoreEnvelopeHost({ enableAmbientTicks: false });
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
});
