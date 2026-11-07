import type { TokenCredential } from "@azure/identity";
import { StorageSharedKeyCredential } from "@azure/storage-blob";
import { StorageSharedKeyCredential as QueueSharedKeyCredential } from "@azure/storage-queue";
import { describe, expect, it, vi } from "vitest";
import { COSMOS_EMULATOR_KEY, loadConfig } from "../src/config.js";
import { createImportQueueClient } from "../src/imports/storage-import-queue.js";
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

/** The queue SDK keeps a client's credential protected; the tests read it anyway, to check which one was given. */
function credentialOf(queue: object): unknown {
  return (queue as { credential?: unknown }).credential;
}

describe("docs/architecture.md, Recipe import: Queue Storage client (IMP-1)", () => {
  it("uses only the managed identity at STORAGE_QUEUE_ENDPOINT when deployed", () => {
    const { credential, credentialFor } = fakeIdentity();

    const queue = createImportQueueClient(deployed.storage, credentialFor);

    expect(credentialOf(queue)).toBe(credential);
    expect(queue.url).toBe(`${DEPLOYED_SETTINGS.STORAGE_QUEUE_ENDPOINT}/${DEPLOYED_SETTINGS.STORAGE_IMPORT_QUEUE}`);
    expect(credentialFor).toHaveBeenCalledExactlyOnceWith(DEPLOYED_SETTINGS.AZURE_CLIENT_ID);
  });

  it("uses Azurite's connection string locally, and no identity", () => {
    const { credentialFor } = fakeIdentity();

    const queue = createImportQueueClient(local.storage, credentialFor);

    expect(credentialOf(queue)).toBeInstanceOf(QueueSharedKeyCredential);
    expect((credentialOf(queue) as QueueSharedKeyCredential).accountName).toBe("devstoreaccount1");
    expect(queue.url).toBe("http://127.0.0.1:10001/devstoreaccount1/imports");
    expect(credentialFor).not.toHaveBeenCalled();
  });
});
