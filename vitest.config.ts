import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests need Docker and run separately with `npm run test:int` (vitest.int.config.ts).
    exclude: [...configDefaults.exclude, "**/*.int.test.{ts,tsx}"],
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          // Only source tests; never compiled copies under dist/. The client runs in its own project, in a DOM.
          include: ["packages/*/{src,test}/**/*.test.{ts,tsx}"],
          exclude: [...configDefaults.exclude, "**/*.int.test.{ts,tsx}", "packages/client/**"],
          environment: "node",
          // Lets packages/server/src/config.ts fall back to local defaults.
          env: { APP_ENV: "test" },
        },
      },
      "packages/client/vitest.config.ts",
    ],
  },
});
