import { randomUUID } from "node:crypto";
import type { Container, CosmosClient } from "@azure/cosmos";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CosmosImportRepository,
  ensureImportContainer,
  IMPORT_TTL_SECONDS,
  type ImportDocument,
  importDocument,
  openImportContainer,
} from "../../src/imports/cosmos-import-repository.js";
import { createCosmosClient } from "../../src/recipes/cosmos-recipe-repository.js";
import { emulatorCosmosConfig } from "../emulator.js";
import { importRepositoryContract, startedImport } from "./import-repository-contract.js";

// Needs the Cosmos DB emulator: `npm run services:up`. Each test gets its own container, deleted afterwards, since the
// contract needs an empty store.
// Always the emulator, whatever COSMOS_* says; emulatorCosmosConfig() throws before connecting to anything else.
const config = emulatorCosmosConfig();
let client: CosmosClient;
const containers: Container[] = [];

async function newContainer(): Promise<Container> {
  const container = await ensureImportContainer(client, {
    database: config.database,
    importContainer: `imports-test-${randomUUID()}`,
  });
  containers.push(container);
  return container;
}

beforeAll(() => {
  client = createCosmosClient(config);
});

afterAll(async () => {
  await Promise.all(containers.map((c) => c.delete()));
  client?.dispose();
});

importRepositoryContract("CosmosImportRepository", async () => new CosmosImportRepository(await newContainer()));

describe("IMP-3 CosmosImportRepository: one document per import, removed a day after its last write", () => {
  it("creates the container with time to live switched on and no default, partitioned by /id", async () => {
    const { resource } = await (await newContainer()).read();
    expect(resource?.defaultTtl).toBe(-1);
    expect(resource?.partitionKey?.paths).toEqual(["/id"]);
  });

  it("stores exactly the snapshot and a one-day ttl, under the import id", async () => {
    const container = await newContainer();
    const recipeImport = startedImport();
    await new CosmosImportRepository(container).add(recipeImport);

    const id = recipeImport.id.value;
    const { resource } = await container.item(id, id).read<ImportDocument>();

    const { _rid, _self, _etag, _attachments, _ts, ...stored } = resource as unknown as ImportDocument & Record<string, unknown>;
    expect(stored).toStrictEqual(importDocument(recipeImport));
    expect(stored.ttl).toBe(IMPORT_TTL_SECONDS);
    expect(IMPORT_TTL_SECONDS).toBe(86_400);
  });

  it("keeps the ttl when an import is saved again", async () => {
    const container = await newContainer();
    const repository = new CosmosImportRepository(container);
    const recipeImport = startedImport();
    await repository.add(recipeImport);
    recipeImport.fail();
    await repository.save(recipeImport);

    const id = recipeImport.id.value;
    const { resource } = await container.item(id, id).read<ImportDocument>();
    expect(resource?.ttl).toBe(IMPORT_TTL_SECONDS);
    expect(resource?.status).toBe("failed");
  });
});

describe("CosmosImportRepository outside local runs (architecture.md, Trash cleanup)", () => {
  it("opens an existing container", async () => {
    const container = await newContainer();
    const opened = await openImportContainer(client, { database: config.database, importContainer: container.id });
    expect(opened.id).toBe(container.id);
  });

  it("refuses a missing container, and doesn't create it", async () => {
    const missing = `imports-missing-${randomUUID()}`;
    await expect(openImportContainer(client, { database: config.database, importContainer: missing })).rejects.toThrow(
      "does not exist",
    );
    const { resources } = await client.database(config.database).containers.readAll().fetchAll();
    expect(resources.map((c) => c.id)).not.toContain(missing);
  });
});
