import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.integration.ts"],
    restoreMocks: true,
    setupFiles: ["./tests/setup.ts"],
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
