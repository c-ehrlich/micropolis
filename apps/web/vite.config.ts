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
  optimizeDeps: {
    // Classicy loads its fonts, art and sounds via `new URL('assets/…', import.meta.url)`;
    // pre-bundling relocates the modules and breaks those URLs.
    exclude: ['@classicy/classicy', '@classicy/appearance-platinum'],
  },
  test: {
    environment: 'node',
  },
});
