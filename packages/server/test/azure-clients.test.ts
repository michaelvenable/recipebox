import type { TokenCredential } from "@azure/identity";
import { StorageSharedKeyCredential } from "@azure/storage-blob";
import { describe, expect, it, vi } from "vitest";
import { COSMOS_EMULATOR_KEY, loadConfig } from "../src/config.js";
import { createPhotoContainerClient } from "../src/photos/blob-photo-store.js";
import { cosmosClientOptions } from "../src/recipes/cosmos-recipe-repository.js";
import { DEPLOYED_SETTINGS } from "./app-helpers.js";

// Building the clients contacts nothing; these tests only check which credential each one is given.

const deployed = loadConfig({ APP_ENV: "production", ...DEPLOYED_SETTINGS });
const local = loadConfig({ APP_ENV: "test" });

function fakeIdentity() {
  const credential: TokenCredential = { getToken: () => Promise.resolve(null) };
  return { credential, credentialFor: vi.fn<(clientId: string) => TokenCredential>(() => credential) };
}

describe("docs/architecture.md, Access to Cosmos DB and Blob Storage: Cosmos DB client", () => {
  it("uses only the managed identity with the configured client ID when deployed", () => {
    const { credential, credentialFor } = fakeIdentity();

    const options = cosmosClientOptions(deployed.cosmos, credentialFor);

    expect(options).toEqual({ endpoint: DEPLOYED_SETTINGS.COSMOS_ENDPOINT, aadCredentials: credential });
    expect(options.key).toBeUndefined();
    expect(credentialFor).toHaveBeenCalledExactlyOnceWith(DEPLOYED_SETTINGS.AZURE_CLIENT_ID);
  });

  it("uses the emulator's key locally, and no identity", () => {
    const { credentialFor } = fakeIdentity();

    const options = cosmosClientOptions(local.cosmos, credentialFor);

    expect(options).toEqual({ endpoint: local.cosmos.endpoint, key: COSMOS_EMULATOR_KEY });
    expect(credentialFor).not.toHaveBeenCalled();
  });
});

describe("docs/architecture.md, Access to Cosmos DB and Blob Storage: Blob Storage client", () => {
  it("uses only the managed identity at STORAGE_BLOB_ENDPOINT when deployed", () => {
    const { credential, credentialFor } = fakeIdentity();

    const container = createPhotoContainerClient(deployed.storage, credentialFor);

    expect(container.credential).toBe(credential);
    expect(container.url).toBe(`${DEPLOYED_SETTINGS.STORAGE_BLOB_ENDPOINT}/${DEPLOYED_SETTINGS.STORAGE_PHOTO_CONTAINER}`);
    expect(credentialFor).toHaveBeenCalledExactlyOnceWith(DEPLOYED_SETTINGS.AZURE_CLIENT_ID);
  });

  it("uses Azurite's connection string locally, and no identity", () => {
    const { credentialFor } = fakeIdentity();

    const container = createPhotoContainerClient(local.storage, credentialFor);

    expect(container.credential).toBeInstanceOf(StorageSharedKeyCredential);
    expect((container.credential as StorageSharedKeyCredential).accountName).toBe("devstoreaccount1");
    expect(container.url).toBe("http://127.0.0.1:10000/devstoreaccount1/photos");
    expect(credentialFor).not.toHaveBeenCalled();
  });
});
