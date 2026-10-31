import { describe, expect, it } from "vitest";
import { COSMOS_EMULATOR_ENDPOINT, COSMOS_EMULATOR_KEY, loadConfig } from "../src/config.js";

const allSettings = {
  COSMOS_ENDPOINT: "https://recipebox.documents.azure.com:443/",
  COSMOS_KEY: "secret",
  COSMOS_DATABASE: "db",
  COSMOS_CONTAINER: "recipes-prod",
};

describe("loadConfig", () => {
  it.each(["development", "test"])("falls back to the emulator when APP_ENV=%s and settings are missing or blank", (appEnv) => {
    const config = loadConfig({ APP_ENV: appEnv, COSMOS_KEY: "  " });

    expect(config.cosmos).toEqual({
      endpoint: COSMOS_EMULATOR_ENDPOINT,
      key: COSMOS_EMULATOR_KEY,
      database: "recipebox",
      container: "recipes",
    });
  });

  it("uses the settings given, in any environment", () => {
    expect(loadConfig({ APP_ENV: "development", ...allSettings }).cosmos).toEqual({
      endpoint: allSettings.COSMOS_ENDPOINT,
      key: "secret",
      database: "db",
      container: "recipes-prod",
    });
    expect(loadConfig(allSettings).cosmos.endpoint).toBe(allSettings.COSMOS_ENDPOINT);
  });

  it.each([undefined, "", "production", "staging", "Development"])(
    "throws naming every missing setting when APP_ENV is %j",
    (appEnv) => {
      expect(() => loadConfig({ APP_ENV: appEnv })).toThrow(
        "Missing required settings: COSMOS_ENDPOINT, COSMOS_KEY, COSMOS_DATABASE, COSMOS_CONTAINER.",
      );
    },
  );

  it("treats blank settings as missing outside development and test", () => {
    expect(() => loadConfig({ ...allSettings, COSMOS_KEY: " ", COSMOS_CONTAINER: "" })).toThrow(
      "Missing required settings: COSMOS_KEY, COSMOS_CONTAINER.",
    );
  });
});
