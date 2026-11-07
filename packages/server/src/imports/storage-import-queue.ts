import type { TokenCredential } from "@azure/identity";
import { QueueClient, QueueServiceClient } from "@azure/storage-queue";
import type { ImportId } from "@recipebox/domain";
import { managedIdentityCredential } from "../azure-credential.js";
import type { StorageConfig } from "../config.js";
import { type ImportQueue, importMessageText } from "./import-queue.js";

/**
 * The `imports` Storage queue (docs/architecture.md, "Recipe import"). Messages are plain JSON text with the import's id and
 * the queue's default time to live: a message the job hasn't taken within the 10 minutes still starts it, so it can end the
 * import as `timed-out` (IMP-11).
 */
export class StorageImportQueue implements ImportQueue {
  constructor(private readonly queue: QueueClient) {}

  async send(importId: ImportId): Promise<void> {
    await this.queue.sendMessage(importMessageText(importId));
  }
}

/**
 * The import queue's client: Azurite's connection string locally, only the managed identity at the account's Queue endpoint
 * when deployed (docs/architecture.md, "Access to Cosmos DB and Blob Storage"). Nothing is contacted until the first request.
 * `credentialFor` is replaceable in tests.
 */
export function createImportQueueClient(
  config: StorageConfig,
  credentialFor: (clientId: string) => TokenCredential = managedIdentityCredential,
): QueueClient {
  const { access } = config;
  let service: QueueServiceClient;
  switch (access.kind) {
    case "connectionString":
      service = QueueServiceClient.fromConnectionString(access.connectionString);
      break;
    case "managedIdentity":
      service = new QueueServiceClient(access.queueEndpoint, credentialFor(access.clientId));
      break;
  }
  return service.getQueueClient(config.importQueue);
}

/**
 * Creates the import queue if it doesn't exist, for local development and tests. Production resources come from the
 * infrastructure scripts.
 *
 * Outside local runs the queue is not checked at startup, unlike the containers: the identity's roles on it (Storage Queue Data
 * Message Sender and Processor, docs/architecture.md, "Recipe import") allow sending and processing messages but not reading
 * the queue's properties. A missing queue fails the first start of an import instead, which is then ended (import-routes.ts).
 */
export async function ensureImportQueue(queue: QueueClient): Promise<QueueClient> {
  await queue.createIfNotExists();
  return queue;
}
