import { InMemoryImportQueue } from "../../src/imports/in-memory-import-queue.js";
import { InMemoryImportRepository } from "../../src/imports/in-memory-import-repository.js";
import { importQueueContract } from "./import-queue-contract.js";
import { importRepositoryContract } from "./import-repository-contract.js";

importRepositoryContract("InMemoryImportRepository", async () => new InMemoryImportRepository());

importQueueContract("InMemoryImportQueue", async () => {
  const queue = new InMemoryImportQueue();
  return { queue, messages: async () => queue.messages() };
});
