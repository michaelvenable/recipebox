import { randomUUID } from "node:crypto";
import type { Container, CosmosClient } from "@azure/cosmos";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCosmosClient } from "../../src/recipes/cosmos-recipe-repository.js";
import {
  CosmosSharedListRepository,
  type SharedListDocument,
  ensureShoppingListContainer,
  openShoppingListContainer,
  sharedListDocument,
} from "../../src/shopping-lists/cosmos-shared-list-repository.js";
import { emulatorCosmosConfig } from "../emulator.js";
import { sentList, sharedListRepositoryContract } from "./shared-list-repository-contract.js";

// Needs the Cosmos DB emulator: `npm run services:up`. Each run uses its own container and deletes it afterwards.
// Always the emulator, whatever COSMOS_* says; emulatorCosmosConfig() throws before connecting to anything else.
const config = emulatorCosmosConfig();
let client: CosmosClient;
let container: Container;

beforeAll(async () => {
  client = createCosmosClient(config);
  container = await ensureShoppingListContainer(client, {
    database: config.database,
    shoppingListContainer: `shopping-lists-test-${randomUUID()}`,
  });
});

afterAll(async () => {
  await container?.delete();
  client?.dispose();
});

sharedListRepositoryContract("CosmosSharedListRepository", async () => new CosmosSharedListRepository(container));

describe("PLAN-9 CosmosSharedListRepository: removed within a day after expiry", () => {
  it("creates the container with time to live switched on and no default, partitioned by /id", async () => {
    const { resource } = await container.read();
    expect(resource?.defaultTtl).toBe(-1);
    expect(resource?.partitionKey?.paths).toEqual(["/id"]);
  });

  it("stores exactly the snapshot plus its time to live", async () => {
    const list = sentList();
    await new CosmosSharedListRepository(container).add(list);

    const { resource } = await container.item(list.token.value, list.token.value).read<SharedListDocument>();

    expect(resource).toBeDefined();
    const { _rid, _self, _etag, _attachments, _ts, ...stored } = resource as unknown as SharedListDocument & Record<string, unknown>;
    expect(stored).toStrictEqual(sharedListDocument(list));
  });
});

describe("CosmosSharedListRepository outside local runs (architecture.md, Trash cleanup)", () => {
  it("opens an existing container", async () => {
    const opened = await openShoppingListContainer(client, { database: config.database, shoppingListContainer: container.id });
    expect(opened.id).toBe(container.id);
  });

  it("refuses a missing container, and doesn't create it", async () => {
    const missing = `shopping-lists-missing-${randomUUID()}`;
    await expect(
      openShoppingListContainer(client, { database: config.database, shoppingListContainer: missing }),
    ).rejects.toThrow("does not exist");
    const { resources } = await client.database(config.database).containers.readAll().fetchAll();
    expect(resources.map((c) => c.id)).not.toContain(missing);
  });
});
