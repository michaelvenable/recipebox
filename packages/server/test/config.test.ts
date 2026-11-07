import { describe, expect, it } from "vitest";
import {
  COSMOS_EMULATOR_ENDPOINT,
  COSMOS_EMULATOR_KEY,
  AZURITE_CONNECTION_STRING,
  DEV_CLIENT_ORIGIN,
  loadConfig,
  parseEditors,
} from "../src/config.js";

/** The settings a deployed app needs (docs/architecture.md, "Access to Cosmos DB and Blob Storage"). */
const allSettings = {
  COSMOS_ENDPOINT: "https://recipebox.documents.azure.com",
  COSMOS_DATABASE: "db",
  COSMOS_CONTAINER: "recipes-prod",
  STORAGE_BLOB_ENDPOINT: "https://recipebox.blob.core.windows.net",
  STORAGE_PHOTO_CONTAINER: "photos-prod",
  AZURE_CLIENT_ID: "11111111-2222-3333-4444-555555555555",
  CLIENT_ORIGIN: "https://recipes.example.net",
};

/** Key-based settings, which only development and test accept. */
const keySettings = {
  COSMOS_KEY: "secret",
  STORAGE_CONNECTION_STRING:
    "AccountName=devstoreaccount1;AccountKey=c2VjcmV0;BlobEndpoint=http://127.0.0.1:10001/devstoreaccount1",
};

describe("loadConfig", () => {
  it.each(["development", "test"])("falls back to the local defaults when APP_ENV=%s and settings are missing or blank", (appEnv) => {
    const config = loadConfig({ APP_ENV: appEnv, COSMOS_KEY: "  ", STORAGE_CONNECTION_STRING: " " });

    expect(config.cosmos).toEqual({
      endpoint: COSMOS_EMULATOR_ENDPOINT,
      access: { kind: "key", key: COSMOS_EMULATOR_KEY },
      database: "recipebox",
      container: "recipes",
    });
    expect(config.storage).toEqual({
      access: { kind: "connectionString", connectionString: AZURITE_CONNECTION_STRING },
      photoContainer: "photos",
    });
    expect(config.clientOrigin).toBe(DEV_CLIENT_ORIGIN);
    expect(config.local).toBe(true);
  });

  it("uses the settings given, in any environment", () => {
    expect(loadConfig({ APP_ENV: "development", ...allSettings }).cosmos).toMatchObject({
      endpoint: allSettings.COSMOS_ENDPOINT,
      database: "db",
      container: "recipes-prod",
    });
    const deployed = loadConfig(allSettings);
    expect(deployed.cosmos).toMatchObject({ endpoint: allSettings.COSMOS_ENDPOINT, database: "db", container: "recipes-prod" });
    expect(deployed.storage.photoContainer).toBe("photos-prod");
    expect(deployed.clientOrigin).toBe("https://recipes.example.net");
    expect(deployed.local).toBe(false);
  });

  it.each([undefined, "", "production", "staging", "Development"])(
    "throws naming every missing setting when APP_ENV is %j",
    (appEnv) => {
      expect(() => loadConfig({ APP_ENV: appEnv })).toThrow(
        "Missing required settings: COSMOS_ENDPOINT, COSMOS_DATABASE, COSMOS_CONTAINER, STORAGE_BLOB_ENDPOINT, " +
          "STORAGE_PHOTO_CONTAINER, AZURE_CLIENT_ID, CLIENT_ORIGIN.",
      );
    },
  );

  it("treats blank settings as missing outside development and test", () => {
    expect(() => loadConfig({ ...allSettings, COSMOS_ENDPOINT: " ", COSMOS_CONTAINER: "", AZURE_CLIENT_ID: " " })).toThrow(
      "Missing required settings: COSMOS_ENDPOINT, COSMOS_CONTAINER, AZURE_CLIENT_ID.",
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

  it("detects a Container Apps Job from CONTAINER_APP_JOB_NAME", () => {
    expect(loadConfig({ ...allSettings, CONTAINER_APP_JOB_NAME: " " }).onContainerApps).toBe(false);
    expect(loadConfig({ ...allSettings, CONTAINER_APP_JOB_NAME: "recipebox-cleanup" }).onContainerApps).toBe(true);
  });

  it("never trusts identity headers in a Container Apps Job, which serves no requests", () => {
    expect(
      loadConfig({ ...allSettings, CONTAINER_APP_JOB_NAME: "recipebox-cleanup", TRUST_AUTH_HEADERS: "true" }).trustAuthHeaders,
    ).toBe(false);
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

  it.each(["development", "test", " test "])("refuses to start with APP_ENV=%j in a Container Apps Job", (appEnv) => {
    expect(() => loadConfig({ ...allSettings, APP_ENV: appEnv, CONTAINER_APP_JOB_NAME: "recipebox-cleanup" })).toThrow(
      "is not allowed on Container Apps (CONTAINER_APP_JOB_NAME is set)",
    );
    // Without any other settings, as `npm run cleanup:dev` would run it: still refused, not run on the emulator defaults.
    expect(() => loadConfig({ APP_ENV: appEnv, CONTAINER_APP_JOB_NAME: "recipebox-cleanup" })).toThrow(
      "is not allowed on Container Apps",
    );
  });

  it.each([undefined, "production", "staging"])("starts on Container Apps with APP_ENV=%j", (appEnv) => {
    expect(loadConfig({ ...allSettings, APP_ENV: appEnv, CONTAINER_APP_NAME: "recipebox-api" }).local).toBe(false);
    expect(loadConfig({ ...allSettings, APP_ENV: appEnv, CONTAINER_APP_JOB_NAME: "recipebox-cleanup" }).local).toBe(false);
  });
});

describe("docs/architecture.md, Access to Cosmos DB and Blob Storage", () => {
  it("uses only the managed identity when deployed", () => {
    const config = loadConfig({ APP_ENV: "production", ...allSettings });

    expect(config.cosmos.access).toEqual({ kind: "managedIdentity", clientId: allSettings.AZURE_CLIENT_ID });
    expect(config.storage.access).toEqual({
      kind: "managedIdentity",
      clientId: allSettings.AZURE_CLIENT_ID,
      blobEndpoint: allSettings.STORAGE_BLOB_ENDPOINT,
    });
  });

  it.each(["COSMOS_ENDPOINT", "STORAGE_BLOB_ENDPOINT", "AZURE_CLIENT_ID"] as const)(
    "requires %s when deployed, even on Container Apps",
    (name) => {
      for (const extra of [{}, { CONTAINER_APP_NAME: "recipebox-api" }, { CONTAINER_APP_JOB_NAME: "recipebox-cleanup" }]) {
        expect(() => loadConfig({ ...allSettings, ...extra, [name]: undefined })).toThrow(`Missing required settings: ${name}.`);
        expect(() => loadConfig({ ...allSettings, ...extra, [name]: "  " })).toThrow(`Missing required settings: ${name}.`);
      }
    },
  );

  it.each(["COSMOS_KEY", "STORAGE_CONNECTION_STRING"] as const)("refuses to start when deployed with %s set", (name) => {
    for (const appEnv of [undefined, "production", "Development"]) {
      expect(() => loadConfig({ ...allSettings, APP_ENV: appEnv, [name]: keySettings[name] })).toThrow(
        `${name} must not be set outside development and test`,
      );
    }
    expect(() => loadConfig({ ...allSettings, CONTAINER_APP_NAME: "recipebox-api", [name]: keySettings[name] })).toThrow(
      `${name} must not be set outside development and test`,
    );
  });

  it("refuses a key even when other settings are missing, and names both keys", () => {
    expect(() => loadConfig(keySettings)).toThrow(
      "COSMOS_KEY and STORAGE_CONNECTION_STRING must not be set outside development and test",
    );
  });

  it("does not show the key in the error", () => {
    let message = "";
    try {
      loadConfig({ ...allSettings, ...keySettings });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("must not be set");
    expect(message).not.toContain(keySettings.COSMOS_KEY);
    expect(message).not.toContain("c2VjcmV0");
  });

  it.each(["COSMOS_KEY", "STORAGE_CONNECTION_STRING"] as const)("treats a blank %s as not set when deployed", (name) => {
    expect(loadConfig({ ...allSettings, [name]: "  " }).local).toBe(false);
  });

  it.each([
    "https://recipebox.documents.azure.com",
    "https://recipebox-westeurope.documents.azure.com",
    "https://r2.documents.azure.com",
  ])("accepts the Cosmos DB endpoint %s when deployed", (endpoint) => {
    expect(loadConfig({ ...allSettings, COSMOS_ENDPOINT: endpoint }).cosmos.endpoint).toBe(endpoint);
  });

  it.each(["https://recipebox.blob.core.windows.net", "https://recipebox-secondary.blob.core.windows.net"])(
    "accepts the Blob Storage endpoint %s when deployed",
    (endpoint) => {
      expect(loadConfig({ ...allSettings, STORAGE_BLOB_ENDPOINT: endpoint }).storage.access).toMatchObject({
        blobEndpoint: endpoint,
      });
    },
  );

  const badCosmosEndpoints = [
    ["http", "http://recipebox.documents.azure.com"],
    ["a Blob Storage host", "https://recipebox.blob.core.windows.net"],
    ["a look-alike with the domain inside another host", "https://evil-documents.azure.com.attacker.net"],
    ["the domain followed by another domain", "https://documents.azure.com.evil.net"],
    ["a host merely ending in the domain's text", "https://xdocuments.azure.com"],
    ["the bare domain", "https://documents.azure.com"],
    ["an empty account label", "https://.documents.azure.com"],
    ["a nested subdomain", "https://a.recipebox.documents.azure.com"],
    ["a trailing slash", "https://recipebox.documents.azure.com/"],
    ["a path", "https://recipebox.documents.azure.com/other"],
    ["a query", "https://recipebox.documents.azure.com?x=1"],
    ["a fragment", "https://recipebox.documents.azure.com#x"],
    ["credentials", "https://user:pw@recipebox.documents.azure.com"],
    ["an explicit :443 port", "https://recipebox.documents.azure.com:443"],
    ["the portal's form with :443 and a slash", "https://recipebox.documents.azure.com:443/"],
    ["another port", "https://recipebox.documents.azure.com:8443"],
    ["an upper-case host", "https://RecipeBox.documents.azure.com"],
    ["the local emulator", "http://localhost:8081"],
    ["not a URL", "recipebox.documents.azure.com"],
  ] as const;

  it.each(badCosmosEndpoints)("refuses a COSMOS_ENDPOINT with %s when deployed", (_case, endpoint) => {
    expect(() => loadConfig({ ...allSettings, COSMOS_ENDPOINT: endpoint })).toThrow(
      `COSMOS_ENDPOINT must be an https origin on documents.azure.com, such as https://<account>.documents.azure.com`,
    );
  });

  const badBlobEndpoints = [
    ["http", "http://recipebox.blob.core.windows.net"],
    ["a Cosmos DB host", "https://recipebox.documents.azure.com"],
    ["a look-alike with the domain inside another host", "https://evil-blob.core.windows.net.attacker.net"],
    ["the domain followed by another domain", "https://blob.core.windows.net.evil.net"],
    ["a host merely ending in the domain's text", "https://xblob.core.windows.net"],
    ["the bare domain", "https://blob.core.windows.net"],
    ["a nested subdomain", "https://a.recipebox.blob.core.windows.net"],
    ["a trailing slash", "https://recipebox.blob.core.windows.net/"],
    ["a path", "https://acct.blob.core.windows.net/other"],
    ["a query", "https://recipebox.blob.core.windows.net?sv=1"],
    ["credentials", "https://user@recipebox.blob.core.windows.net"],
    ["an explicit :443 port", "https://recipebox.blob.core.windows.net:443"],
    ["Azurite", "http://127.0.0.1:10000/devstoreaccount1"],
  ] as const;

  it.each(badBlobEndpoints)("refuses a STORAGE_BLOB_ENDPOINT with %s when deployed", (_case, endpoint) => {
    expect(() => loadConfig({ ...allSettings, STORAGE_BLOB_ENDPOINT: endpoint })).toThrow(
      `STORAGE_BLOB_ENDPOINT must be an https origin on blob.core.windows.net, such as https://<account>.blob.core.windows.net`,
    );
  });

  it("checks endpoints on Container Apps too", () => {
    const onContainerApps = { ...allSettings, CONTAINER_APP_JOB_NAME: "recipebox-cleanup" };
    expect(() => loadConfig({ ...onContainerApps, COSMOS_ENDPOINT: "https://documents.azure.com.evil.net" })).toThrow(
      "COSMOS_ENDPOINT must be an https origin",
    );
    expect(() => loadConfig({ ...onContainerApps, STORAGE_BLOB_ENDPOINT: "https://blob.core.windows.net.evil.net" })).toThrow(
      "STORAGE_BLOB_ENDPOINT must be an https origin",
    );
  });

  it.each(["development", "test"])("keeps the emulators' http endpoints when APP_ENV=%s", (appEnv) => {
    expect(loadConfig({ APP_ENV: appEnv }).cosmos.endpoint).toBe(COSMOS_EMULATOR_ENDPOINT);
    expect(loadConfig({ APP_ENV: appEnv, COSMOS_ENDPOINT: "http://127.0.0.1:8081" }).cosmos.endpoint).toBe(
      "http://127.0.0.1:8081",
    );
  });

  it.each(["development", "test"])("accepts the key overrides when APP_ENV=%s", (appEnv) => {
    const config = loadConfig({ APP_ENV: appEnv, ...allSettings, ...keySettings });

    expect(config.cosmos.access).toEqual({ kind: "key", key: keySettings.COSMOS_KEY });
    expect(config.storage.access).toEqual({
      kind: "connectionString",
      connectionString: keySettings.STORAGE_CONNECTION_STRING,
    });
  });

  it.each(["development", "test"])("uses the emulator keys, not an identity, when APP_ENV=%s", (appEnv) => {
    const config = loadConfig({ APP_ENV: appEnv, AZURE_CLIENT_ID: allSettings.AZURE_CLIENT_ID });

    expect(config.cosmos.access).toEqual({ kind: "key", key: COSMOS_EMULATOR_KEY });
    expect(config.storage.access).toEqual({ kind: "connectionString", connectionString: AZURITE_CONNECTION_STRING });
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
