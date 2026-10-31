import { randomUUID } from "node:crypto";
import type { ContainerClient } from "@azure/storage-blob";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BlobPhotoStore,
  createPhotoContainerClient,
  ensurePhotoContainer,
} from "../../src/photos/blob-photo-store.js";
import { emulatorStorageConfig } from "../emulator.js";
import { photoStoreContract } from "./photo-store-contract.js";

// Needs Azurite: `npm run services:up`. Each run uses its own container and deletes it afterwards.
// Always Azurite, whatever STORAGE_* says; emulatorStorageConfig() throws before connecting to anything else.
const config = { ...emulatorStorageConfig(), photoContainer: `photos-test-${randomUUID()}` };
let container: ContainerClient;

beforeAll(async () => {
  container = await ensurePhotoContainer(createPhotoContainerClient(config));
});

afterAll(async () => {
  await container?.deleteIfExists();
});

photoStoreContract("BlobPhotoStore", async () => new BlobPhotoStore(container));

describe("BlobPhotoStore container", () => {
  it("is private: no anonymous access to images (X-1)", async () => {
    const properties = await container.getProperties();
    expect(properties.blobPublicAccess).toBeUndefined();
  });

  it("creates the container only if it doesn't exist", async () => {
    const store = new BlobPhotoStore(container);
    await store.put("photos/kept.jpg", Buffer.from("kept"), "image/jpeg");

    await ensurePhotoContainer(createPhotoContainerClient(config));

    expect((await store.get("photos/kept.jpg"))?.bytes.toString()).toBe("kept");
  });

  it("sets the content type on the blob itself", async () => {
    await new BlobPhotoStore(container).put("photos/typed.jpg", Buffer.from("x"), "image/jpeg");
    const properties = await container.getBlobClient("photos/typed.jpg").getProperties();
    expect(properties.contentType).toBe("image/jpeg");
  });
});
