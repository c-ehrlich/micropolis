import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { Route } from './index.tsx';

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
});
