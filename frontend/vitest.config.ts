import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.ts - that one carries the PWA
// plugin and dev-server proxy config, neither of which a pure-function test
// run needs (and the PWA plugin's own build-time assumptions aren't worth
// dragging into `vitest run`).
export default defineConfig({
  test: {
    environment: 'node',
  },
})
