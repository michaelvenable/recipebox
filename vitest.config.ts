import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only source tests; never compiled copies under dist/.
    include: ["packages/*/{src,test}/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
  },
});
