import { BlobServiceClient, type ContainerClient, RestError } from "@azure/storage-blob";
import type { TokenCredential } from "@azure/identity";
import { Instant } from "@recipebox/domain";
import { managedIdentityCredential } from "../azure-credential.js";
import type { StorageConfig } from "../config.js";
import type { PhotoStore, StoredImage, StoredImageInfo } from "./photo-store.js";

/**
 * Stores photos as block blobs in one private container (docs/architecture.md, "Photos"). Each blob's content type is set on
 * the blob, so it can be served with it.
 */
export class BlobPhotoStore implements PhotoStore {
  constructor(private readonly container: ContainerClient) {}

  async put(name: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.container.getBlockBlobClient(name).uploadData(bytes, { blobHTTPHeaders: { blobContentType: contentType } });
  }

  async get(name: string): Promise<StoredImage | undefined> {
    try {
      const response = await this.container.getBlobClient(name).download();
      const body = response.readableStreamBody;
      if (body === undefined) throw new Error(`Blob Storage returned no body for ${name}`);
      const chunks: Buffer[] = [];
      // No encoding is set on the stream, so it yields Buffers.
      for await (const chunk of body) chunks.push(chunk as Buffer);
      return { bytes: Buffer.concat(chunks), contentType: response.contentType ?? "application/octet-stream" };
    } catch (error) {
      if (error instanceof RestError && error.statusCode === 404) return undefined;
      throw error;
    }
  }

  async delete(name: string): Promise<void> {
    await this.container.getBlobClient(name).deleteIfExists();
  }

  async list(): Promise<StoredImageInfo[]> {
    const images: StoredImageInfo[] = [];
    // A flat listing gives each blob's full name, slashes included; the SDK follows continuation pages.
    for await (const blob of this.container.listBlobsFlat()) {
      const lastModified = Instant.fromEpochMillis(blob.properties.lastModified.getTime());
      if (!lastModified.ok) throw new Error(`Blob Storage returned an invalid last-modified time for ${blob.name}`);
      images.push({ name: blob.name, lastModified: lastModified.value });
    }
    return images;
  }
}

/**
 * The photo container's client: Azurite's connection string locally, only the managed identity at the account's Blob endpoint
 * when deployed (docs/architecture.md, "Access to Cosmos DB and Blob Storage"). Nothing is contacted until the first request.
 * `credentialFor` is replaceable in tests.
 */
export function createPhotoContainerClient(
  config: StorageConfig,
  credentialFor: (clientId: string) => TokenCredential = managedIdentityCredential,
): ContainerClient {
  const { access } = config;
  let service: BlobServiceClient;
  switch (access.kind) {
    case "connectionString":
      service = BlobServiceClient.fromConnectionString(access.connectionString);
      break;
    case "managedIdentity":
      service = new BlobServiceClient(access.blobEndpoint, credentialFor(access.clientId));
      break;
  }
  return service.getContainerClient(config.photoContainer);
}

/**
 * Creates the photo container if it doesn't exist, for local development and tests. It is private: no anonymous access is
 * granted, so images are read only through the API (X-1). Production resources come from the infrastructure scripts.
 */
export async function ensurePhotoContainer(container: ContainerClient): Promise<ContainerClient> {
  await container.createIfNotExists();
  return container;
}

/**
 * The existing photo container, for every run outside local development and tests: a missing container is an error, never
 * created, so a misconfigured deployment can't start against a new, empty one (docs/architecture.md, "Trash cleanup").
 */
export async function openPhotoContainer(container: ContainerClient): Promise<ContainerClient> {
  if (!(await container.exists())) {
    throw new Error(
      `Blob Storage container ${JSON.stringify(container.containerName)} does not exist. Outside local development it is ` +
        "created by the infrastructure scripts, never by the app.",
    );
  }
  return container;
}
