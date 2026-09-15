import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    // Point workspace imports at source, so the suite runs on a fresh clone without a build first.
    alias: {
      '@kanban/core/node': src('./packages/core/src/node.ts'),
      '@kanban/core': src('./packages/core/src/index.ts'),
    },
  },
});
