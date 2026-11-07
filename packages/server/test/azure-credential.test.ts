import { beforeEach, describe, expect, it, vi } from "vitest";
import { managedIdentityCredential } from "../src/azure-credential.js";
import { loadConfig } from "../src/config.js";
import { createPhotoContainerClient } from "../src/photos/blob-photo-store.js";
import { cosmosClientOptions, createCosmosClient } from "../src/recipes/cosmos-recipe-repository.js";
import { DEPLOYED_SETTINGS } from "./app-helpers.js";

// Only ManagedIdentityCredential is provided, so using any other credential (such as DefaultAzureCredential) fails these
// tests. The fake records the options it is built with and never contacts Azure.
const built = vi.hoisted(() => [] as unknown[]);
vi.mock("@azure/identity", () => ({
  ManagedIdentityCredential: class {
    constructor(readonly options: unknown) {
      built.push(options);
    }
    getToken(): Promise<null> {
      return Promise.resolve(null);
    }
  },
}));

// The Cosmos DB client records the options it is built with, so createCosmosClient can be checked without contacting Azure.
const cosmosOptions = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@azure/cosmos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@azure/cosmos")>()),
  CosmosClient: class {
    constructor(options: Record<string, unknown>) {
      cosmosOptions.push(options);
    }
  },
}));

const { ManagedIdentityCredential } = await import("@azure/identity");
const deployed = loadConfig({ APP_ENV: "production", ...DEPLOYED_SETTINGS });

describe("docs/architecture.md, Access to Cosmos DB and Blob Storage: the deployed credential", () => {
  beforeEach(() => {
    built.length = 0;
    cosmosOptions.length = 0;
  });

  it("is what createCosmosClient, used by the API and the cleanup job, builds the client with when deployed", () => {
    createCosmosClient(deployed.cosmos);

    expect(cosmosOptions).toHaveLength(1);
    const [options] = cosmosOptions;
    expect(options?.endpoint).toBe(DEPLOYED_SETTINGS.COSMOS_ENDPOINT);
    expect(options?.aadCredentials).toBeInstanceOf(ManagedIdentityCredential);
    expect(options?.key).toBeUndefined();
    expect(built).toEqual([{ clientId: DEPLOYED_SETTINGS.AZURE_CLIENT_ID }]);
  });

  it("is the user-assigned managed identity with the given client ID", () => {
    expect(managedIdentityCredential("client-1")).toBeInstanceOf(ManagedIdentityCredential);
    expect(built).toEqual([{ clientId: "client-1" }]);
  });

  it("is what the Cosmos DB client uses by default when deployed", () => {
    const options = cosmosClientOptions(deployed.cosmos);

    expect(options.aadCredentials).toBeInstanceOf(ManagedIdentityCredential);
    expect(built).toEqual([{ clientId: DEPLOYED_SETTINGS.AZURE_CLIENT_ID }]);
  });

  it("is what the Blob Storage client uses by default when deployed", () => {
    const container = createPhotoContainerClient(deployed.storage);

    expect(container.credential).toBeInstanceOf(ManagedIdentityCredential);
    expect(built).toEqual([{ clientId: DEPLOYED_SETTINGS.AZURE_CLIENT_ID }]);
  });
});
