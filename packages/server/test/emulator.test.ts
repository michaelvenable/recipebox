import { afterEach, describe, expect, it, vi } from "vitest";
import { COSMOS_EMULATOR_ENDPOINT, COSMOS_EMULATOR_KEY } from "../src/config.js";
import { assertLocalEndpoint, emulatorCosmosConfig } from "./emulator.js";

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
    expect(config.key).toBe(COSMOS_EMULATOR_KEY);
  });
});
