import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The integration suite (tests/integration/*.test.ts) spawns the
    // built CLI as a subprocess. `globalSetup` runs `npm run build`
    // once before any spec executes so the dist/ artifact is fresh.
    // The test files themselves are picked up by the include pattern.
    globalSetup: ["tests/integration/global-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "src/index.ts"],
    },
    // Bumped from 10s to 30s: integration specs spawn 5-10 subprocesses
    // and the slowest path (init + add audit + add standard + knowledge
    // refresh + doctor in one test) can push past 10s on a cold box.
    // Unit tests are still well under the budget (their slowest is
    // ~30ms), so the bump is a no-op for them.
    testTimeout: 30000,
  },
});
