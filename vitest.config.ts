import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only source tests; never compiled copies under dist/.
    include: ["packages/*/{src,test}/**/*.test.{ts,tsx}"],
    // Integration tests need Docker and run separately with `npm run test:int` (vitest.int.config.ts).
    exclude: [...configDefaults.exclude, "**/*.int.test.{ts,tsx}"],
    // Lets packages/server/src/config.ts fall back to local defaults.
    env: { APP_ENV: "test" },
    passWithNoTests: true,
  },
});
