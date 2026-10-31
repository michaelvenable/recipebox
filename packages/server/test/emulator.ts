import { COSMOS_EMULATOR_ENDPOINT, COSMOS_EMULATOR_KEY, type CosmosConfig } from "../src/config.js";

/**
 * Cosmos settings for integration tests. They are fixed to the local emulator and deliberately ignore COSMOS_* in the
 * environment, so a shell configured for a real account can't make tests create or delete containers there. Tests never
 * touch Azure.
 */
export function emulatorCosmosConfig(): CosmosConfig {
  const config: CosmosConfig = {
    endpoint: COSMOS_EMULATOR_ENDPOINT,
    key: COSMOS_EMULATOR_KEY,
    database: "recipebox",
    container: "recipes",
  };
  assertLocalEndpoint(config.endpoint);
  return config;
}

const LOCAL_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

/** Throws unless the endpoint is on this machine. Call it before connecting. */
export function assertLocalEndpoint(endpoint: string): void {
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname;
  } catch {
    throw new Error(`Refusing to run tests against "${endpoint}": not a valid URL.`);
  }
  if (!LOCAL_HOSTS.includes(hostname.toLowerCase())) {
    throw new Error(`Refusing to run tests against "${endpoint}": tests only use the local emulator (localhost).`);
  }
}
