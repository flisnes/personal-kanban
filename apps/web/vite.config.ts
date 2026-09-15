import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Served from https://<user>.github.io/personal-kanban/, so assets need that prefix.
// Overridable for a custom domain or a local preview at the root.
const base = process.env['VITE_BASE'] ?? '/personal-kanban/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Build straight from core's source: one typecheck, no stale dist between the two.
      '@kanban/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
