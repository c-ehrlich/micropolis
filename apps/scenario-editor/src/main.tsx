import './styles.css';

import { ClassicyRuntimeProvider } from '@city/classicyui';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import React from 'react';
import { createRoot } from 'react-dom/client';

import { routeTree } from './routeTree.gen.ts';

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

createRoot(rootElement).render(
  <React.StrictMode>
    <ClassicyRuntimeProvider appName="@city/scenario-editor">
      <RouterProvider router={router} />
    </ClassicyRuntimeProvider>
  </React.StrictMode>,
);
