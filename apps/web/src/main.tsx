import { createRouter, RouterProvider } from '@tanstack/react-router';
import React from 'react';
import { createRoot } from 'react-dom/client';

import { createCoreHost } from './game/host-factory';
import { createGameRuntime } from './game/runtime';
import { routeTree } from './routeTree.gen';

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

const gameRuntime = createGameRuntime(createCoreHost());
gameRuntime.start();
window.addEventListener(
  'beforeunload',
  () => {
    gameRuntime.stop();
  },
  { once: true },
);

createRoot(rootElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
