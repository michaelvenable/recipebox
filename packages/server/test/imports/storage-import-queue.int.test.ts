import { randomUUID } from "node:crypto";
import type { QueueClient } from "@azure/storage-queue";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createImportQueueClient, ensureImportQueue, StorageImportQueue } from "../../src/imports/storage-import-queue.js";
import { emulatorStorageConfig } from "../emulator.js";
import { importQueueContract } from "./import-queue-contract.js";

// Needs Azurite's queue service: `npm run services:up`. Each run uses its own queue and deletes it afterwards.
// Always Azurite, whatever STORAGE_* says; emulatorStorageConfig() throws before connecting to anything else.
const config = { ...emulatorStorageConfig(), importQueue: `imports-test-${randomUUID()}` };
let queue: QueueClient;

beforeAll(async () => {
  queue = await ensureImportQueue(createImportQueueClient(config));
});

afterAll(async () => {
  await queue?.deleteIfExists();
});

importQueueContract("StorageImportQueue", async () => {
  await queue.clearMessages();
  return {
    queue: new StorageImportQueue(queue),
    messages: async () => {
      const { peekedMessageItems } = await queue.peekMessages({ numberOfMessages: 32 });
      return peekedMessageItems.map((m) => m.messageText);
    },
  };
});

describe("StorageImportQueue queue", () => {
  it("creates the queue only if it doesn't exist", async () => {
    await queue.clearMessages();
    await queue.sendMessage("kept");

    await ensureImportQueue(createImportQueueClient(config));

    const { peekedMessageItems } = await queue.peekMessages();
    expect(peekedMessageItems.map((m) => m.messageText)).toEqual(["kept"]);
    await queue.clearMessages();
  });
});
