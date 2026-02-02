/// <reference types="vitest/config" />
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      routesDirectory: 'src/routes',
    }),
    react(),
  ],
  test: {
    environment: 'node',
  },
});
