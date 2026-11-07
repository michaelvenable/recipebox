import { InMemorySharedListRepository } from "../../src/shopping-lists/in-memory-shared-list-repository.js";
import { sharedListRepositoryContract } from "./shared-list-repository-contract.js";

sharedListRepositoryContract("InMemorySharedListRepository", async () => new InMemorySharedListRepository());
