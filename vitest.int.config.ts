import { defineConfig } from "vitest/config";

// Integration tests that need the local services (`npm run services:up`). Run with `npm run test:int`.
export default defineConfig({
  test: {
    include: ["packages/*/{src,test}/**/*.int.test.{ts,tsx}"],
    // Lets packages/server/src/config.ts fall back to local defaults. Storage tests ignore COSMOS_* entirely and always use
    // the emulator (packages/server/test/emulator.ts).
    env: { APP_ENV: "test" },
    // The emulator can be slow, especially on its first requests after starting.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
