import './styles.css';

import { createRouter, RouterProvider } from '@tanstack/react-router';
import { ClassicyAppManagerProvider } from 'classicy';
import React from 'react';
import { createRoot } from 'react-dom/client';

import classicyCssText from '../node_modules/classicy/dist/classicy.css?raw';
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

const CLASSICY_STYLE_ELEMENT_ID = 'classicy-runtime-style-sheet';
if (document.getElementById(CLASSICY_STYLE_ELEMENT_ID) === null) {
  const styleElement = document.createElement('style');
  styleElement.id = CLASSICY_STYLE_ELEMENT_ID;
  styleElement.textContent = classicyCssText;
  document.head.append(styleElement);
}

createRoot(rootElement).render(
  <React.StrictMode>
    <ClassicyAppManagerProvider appName="@city/web">
      <RouterProvider router={router} />
    </ClassicyAppManagerProvider>
  </React.StrictMode>,
);
