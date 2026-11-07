import {
  AZURITE_CONNECTION_STRING,
  COSMOS_EMULATOR_ENDPOINT,
  COSMOS_EMULATOR_KEY,
  type CosmosConfig,
  type StorageConfig,
} from "../src/config.js";

/**
 * Cosmos settings for integration tests. They are fixed to the local emulator and deliberately ignore COSMOS_* in the
 * environment, so a shell configured for a real account can't make tests create or delete containers there. Tests never
 * touch Azure.
 */
export function emulatorCosmosConfig(): CosmosConfig {
  const config: CosmosConfig = {
    endpoint: COSMOS_EMULATOR_ENDPOINT,
    access: { kind: "key", key: COSMOS_EMULATOR_KEY },
    database: "recipebox",
    container: "recipes",
  };
  assertLocalEndpoint(config.endpoint);
  return config;
}

/**
 * Blob Storage settings for integration tests: always Azurite, whatever STORAGE_* in the environment says, for the same reason
 * as emulatorCosmosConfig.
 */
export function emulatorStorageConfig(): StorageConfig {
  const connectionString = AZURITE_CONNECTION_STRING;
  assertLocalConnectionString(connectionString);
  return { access: { kind: "connectionString", connectionString }, photoContainer: "photos" };
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

/**
 * Throws unless a storage connection string names a Blob endpoint on this machine. One without an explicit `BlobEndpoint` (such
 * as `AccountName=…;EndpointSuffix=core.windows.net`) points at Azure and is refused. Only the endpoint is shown in the error;
 * the string itself may hold a real account key.
 */
export function assertLocalConnectionString(connectionString: string): void {
  const blobEndpoint = connectionString
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("blobendpoint="))
    ?.slice("blobendpoint=".length);
  if (blobEndpoint === undefined || blobEndpoint === "") {
    throw new Error("Refusing to run tests against a storage account without a local BlobEndpoint: tests only use Azurite.");
  }
  assertLocalEndpoint(blobEndpoint);
}
