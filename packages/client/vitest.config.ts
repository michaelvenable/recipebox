import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

// The client's test project, run by the root `npm test` (vitest.config.ts) or `npm test -w @recipebox/client`.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: "client",
      environment: "jsdom",
      // The Vite dev server's address, so the page's origin isn't the API's (both default to localhost:3000 otherwise).
      environmentOptions: { jsdom: { url: "http://localhost:5173/" } },
      include: ["{src,test}/**/*.test.{ts,tsx}"],
      exclude: [...configDefaults.exclude, "**/*.int.test.{ts,tsx}"],
      setupFiles: ["./test/setup.ts"],
      // A device time zone other than UTC, with daylight saving, so local-day tests (COOK-5, COOK-8, X-12) prove something
      // whatever the machine's zone. Node applies a TZ assigned at run time, on Windows too; test/dates.test.ts checks it took.
      env: { TZ: "America/New_York" },
    },
  }),
);
