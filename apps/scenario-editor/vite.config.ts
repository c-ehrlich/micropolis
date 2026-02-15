/// <reference types="vitest/config" />

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      routesDirectory: 'src/routes',
      routeFileIgnorePattern: '\\.(test|spec)\\.(ts|tsx)$',
    }),
    tailwindcss(),
    react(),
  ],
  test: {
    environment: 'node',
  },
});
