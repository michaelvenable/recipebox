import { afterEach, describe, expect, it, vi } from "vitest";
import { AZURITE_CONNECTION_STRING, COSMOS_EMULATOR_ENDPOINT, COSMOS_EMULATOR_KEY } from "../src/config.js";
import {
  assertLocalConnectionString,
  assertLocalEndpoint,
  emulatorCosmosConfig,
  emulatorStorageConfig,
} from "./emulator.js";

describe("integration tests never touch Azure", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["http://localhost:8081", "https://localhost:8081/", "http://127.0.0.1:8081", "http://LOCALHOST:8081"])(
    "accepts the local endpoint %s",
    (endpoint) => {
      expect(() => assertLocalEndpoint(endpoint)).not.toThrow();
    },
  );

  it.each([
    "https://recipebox.documents.azure.com:443/",
    "https://localhost.example.com/",
    "http://10.0.0.5:8081",
    "not a url",
    "",
  ])("refuses the endpoint %j", (endpoint) => {
    expect(() => assertLocalEndpoint(endpoint)).toThrow(/Refusing to run tests/);
  });

  it("uses the emulator even when the environment points at a real account", () => {
    vi.stubEnv("COSMOS_ENDPOINT", "https://recipebox.documents.azure.com:443/");
    vi.stubEnv("COSMOS_KEY", "production-key");

    const config = emulatorCosmosConfig();

    expect(config.endpoint).toBe(COSMOS_EMULATOR_ENDPOINT);
    expect(config.access).toEqual({ kind: "key", key: COSMOS_EMULATOR_KEY });
  });

  it.each([
    AZURITE_CONNECTION_STRING,
    "AccountName=devstoreaccount1;AccountKey=a2V5;BlobEndpoint=http://localhost:10000/devstoreaccount1",
  ])("accepts the Azurite connection string %#", (connectionString) => {
    expect(() => assertLocalConnectionString(connectionString)).not.toThrow();
  });

  it.each([
    ["an Azure account", "AccountName=recipebox;AccountKey=c2VjcmV0;EndpointSuffix=core.windows.net"],
    ["an Azure Blob endpoint", "AccountName=recipebox;AccountKey=c2VjcmV0;BlobEndpoint=https://recipebox.blob.core.windows.net/"],
    ["a remote host", "AccountName=x;AccountKey=c2VjcmV0;BlobEndpoint=http://10.0.0.5:10000/x"],
    ["UseDevelopmentStorage without an endpoint", "UseDevelopmentStorage=true"],
    ["an empty string", ""],
  ])("refuses the storage connection string of %s, without showing its key", (_name, connectionString) => {
    expect(() => assertLocalConnectionString(connectionString)).toThrow(/Refusing to run tests/);
    try {
      assertLocalConnectionString(connectionString);
    } catch (error) {
      expect(String(error)).not.toContain("c2VjcmV0");
    }
  });

  it("uses Azurite even when the environment points at a real storage account", () => {
    vi.stubEnv("STORAGE_CONNECTION_STRING", "AccountName=prod;AccountKey=a2V5;EndpointSuffix=core.windows.net");

    expect(emulatorStorageConfig().access).toEqual({ kind: "connectionString", connectionString: AZURITE_CONNECTION_STRING });
  });
});
