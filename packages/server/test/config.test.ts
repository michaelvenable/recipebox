import { describe, expect, it } from "vitest";
import {
  COSMOS_EMULATOR_ENDPOINT,
  COSMOS_EMULATOR_KEY,
  AZURITE_CONNECTION_STRING,
  DEV_CLIENT_ORIGIN,
  loadConfig,
  parseEditors,
} from "../src/config.js";

const allSettings = {
  COSMOS_ENDPOINT: "https://recipebox.documents.azure.com:443/",
  COSMOS_KEY: "secret",
  COSMOS_DATABASE: "db",
  COSMOS_CONTAINER: "recipes-prod",
  STORAGE_CONNECTION_STRING:
    "DefaultEndpointsProtocol=https;AccountName=recipebox;AccountKey=secret;EndpointSuffix=core.windows.net",
  STORAGE_PHOTO_CONTAINER: "photos-prod",
  CLIENT_ORIGIN: "https://recipes.example.net",
};

describe("loadConfig", () => {
  it.each(["development", "test"])("falls back to the local defaults when APP_ENV=%s and settings are missing or blank", (appEnv) => {
    const config = loadConfig({ APP_ENV: appEnv, COSMOS_KEY: "  " });

    expect(config.cosmos).toEqual({
      endpoint: COSMOS_EMULATOR_ENDPOINT,
      key: COSMOS_EMULATOR_KEY,
      database: "recipebox",
      container: "recipes",
    });
    expect(config.storage).toEqual({ connectionString: AZURITE_CONNECTION_STRING, photoContainer: "photos" });
    expect(config.clientOrigin).toBe(DEV_CLIENT_ORIGIN);
    expect(config.local).toBe(true);
  });

  it("uses the settings given, in any environment", () => {
    expect(loadConfig({ APP_ENV: "development", ...allSettings }).cosmos).toEqual({
      endpoint: allSettings.COSMOS_ENDPOINT,
      key: "secret",
      database: "db",
      container: "recipes-prod",
    });
    const deployed = loadConfig(allSettings);
    expect(deployed.cosmos.endpoint).toBe(allSettings.COSMOS_ENDPOINT);
    expect(deployed.storage).toEqual({
      connectionString: allSettings.STORAGE_CONNECTION_STRING,
      photoContainer: "photos-prod",
    });
    expect(deployed.clientOrigin).toBe("https://recipes.example.net");
    expect(deployed.local).toBe(false);
  });

  it.each([undefined, "", "production", "staging", "Development"])(
    "throws naming every missing setting when APP_ENV is %j",
    (appEnv) => {
      expect(() => loadConfig({ APP_ENV: appEnv })).toThrow(
        "Missing required settings: COSMOS_ENDPOINT, COSMOS_KEY, COSMOS_DATABASE, COSMOS_CONTAINER, STORAGE_CONNECTION_STRING, " +
          "STORAGE_PHOTO_CONTAINER, CLIENT_ORIGIN.",
      );
    },
  );

  it("treats blank settings as missing outside development and test", () => {
    expect(() => loadConfig({ ...allSettings, COSMOS_KEY: " ", COSMOS_CONTAINER: "", STORAGE_CONNECTION_STRING: " " })).toThrow(
      "Missing required settings: COSMOS_KEY, COSMOS_CONTAINER, STORAGE_CONNECTION_STRING.",
    );
  });

  it.each(["https://recipes.example.net/", "https://recipes.example.net/app", "recipes.example.net", "*"])(
    "rejects a CLIENT_ORIGIN that is not an exact origin: %j",
    (origin) => {
      expect(() => loadConfig({ ...allSettings, CLIENT_ORIGIN: origin })).toThrow("CLIENT_ORIGIN must be an origin");
    },
  );

  it("detects Container Apps from CONTAINER_APP_NAME", () => {
    expect(loadConfig(allSettings).onContainerApps).toBe(false);
    expect(loadConfig({ ...allSettings, CONTAINER_APP_NAME: " " }).onContainerApps).toBe(false);
    expect(loadConfig({ ...allSettings, CONTAINER_APP_NAME: "recipebox-api" }).onContainerApps).toBe(true);
  });

  it("trusts identity headers only on Container Apps with TRUST_AUTH_HEADERS exactly \"true\"", () => {
    const onContainerApps = { ...allSettings, CONTAINER_APP_NAME: "recipebox-api" };
    expect(loadConfig({ ...onContainerApps, TRUST_AUTH_HEADERS: "true" }).trustAuthHeaders).toBe(true);
    expect(loadConfig(onContainerApps).trustAuthHeaders).toBe(false);
    for (const value of ["", "false", "TRUE", "True", " true", "true ", "1", "yes"]) {
      expect(loadConfig({ ...onContainerApps, TRUST_AUTH_HEADERS: value }).trustAuthHeaders).toBe(false);
    }
    expect(loadConfig({ ...allSettings, TRUST_AUTH_HEADERS: "true" }).trustAuthHeaders).toBe(false);
    expect(loadConfig({ ...allSettings, CONTAINER_APP_NAME: " ", TRUST_AUTH_HEADERS: "true" }).trustAuthHeaders).toBe(false);
  });

  it.each(["development", "test", " test "])("refuses to start with APP_ENV=%j on Container Apps", (appEnv) => {
    expect(() => loadConfig({ ...allSettings, APP_ENV: appEnv, CONTAINER_APP_NAME: "recipebox-api" })).toThrow(
      "is not allowed on Container Apps (CONTAINER_APP_NAME is set)",
    );
    expect(() => loadConfig({ APP_ENV: appEnv, CONTAINER_APP_NAME: "recipebox-api", TRUST_AUTH_HEADERS: "true" })).toThrow(
      "is not allowed on Container Apps",
    );
  });

  it.each([undefined, "production", "staging"])("starts on Container Apps with APP_ENV=%j", (appEnv) => {
    expect(loadConfig({ ...allSettings, APP_ENV: appEnv, CONTAINER_APP_NAME: "recipebox-api" }).local).toBe(false);
  });
});

describe("X-7 EDITORS setting", () => {
  it("parses provider:accountId entries", () => {
    expect(parseEditors("google:1098,aad:9f3c")).toEqual([
      { provider: "google", accountId: "1098" },
      { provider: "aad", accountId: "9f3c" },
    ]);
  });

  it("trims spaces and ignores empty entries", () => {
    expect(parseEditors("  google:1098 , ,aad:9f3c,, ")).toEqual([
      { provider: "google", accountId: "1098" },
      { provider: "aad", accountId: "9f3c" },
    ]);
  });

  it.each([undefined, "", "  ", ",,"])("allows an empty list (nobody can edit): %j", (value) => {
    expect(parseEditors(value)).toEqual([]);
  });

  it("is optional in every environment", () => {
    expect(loadConfig(allSettings).editors).toEqual([]);
    expect(loadConfig({ ...allSettings, EDITORS: "aad:9f3c" }).editors).toEqual([{ provider: "aad", accountId: "9f3c" }]);
  });

  it.each([
    "1098",
    "google",
    "google:",
    ":1098",
    "github:1098",
    "Google:1098",
    "mike@example.com",
    "google:mike venable",
  ])("rejects a malformed entry at startup: %j", (entry) => {
    expect(() => parseEditors(`aad:9f3c,${entry}`)).toThrow(`Malformed EDITORS entries: ${JSON.stringify(entry)}`);
    expect(() => loadConfig({ ...allSettings, EDITORS: entry })).toThrow("Malformed EDITORS entries");
  });

  it("names every malformed entry", () => {
    expect(() => parseEditors("bad, google:1, alsobad")).toThrow('Malformed EDITORS entries: "bad", "alsobad".');
  });
});
