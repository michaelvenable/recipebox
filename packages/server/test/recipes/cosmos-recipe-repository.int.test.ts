import { randomUUID } from "node:crypto";
import type { Container, CosmosClient } from "@azure/cosmos";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Recipe, RecipeId, type Result } from "@recipebox/domain";
import { emulatorCosmosConfig } from "../emulator.js";
import {
  CosmosRecipeRepository,
  createCosmosClient,
  ensureRecipeContainer,
  withoutSystemProperties,
  type RecipeDocument,
} from "../../src/recipes/cosmos-recipe-repository.js";
import { recipeRepositoryContract } from "./recipe-repository-contract.js";

// Needs the Cosmos DB emulator: `npm run services:up`. Each run uses its own container and deletes it afterwards.
// Always the emulator, whatever COSMOS_* says; emulatorCosmosConfig() throws before connecting to anything else.
const config = emulatorCosmosConfig();
let client: CosmosClient;
let container: Container;

beforeAll(async () => {
  client = createCosmosClient(config);
  container = await ensureRecipeContainer(client, {
    database: config.database,
    container: `recipes-test-${randomUUID()}`,
  });
});

afterAll(async () => {
  await container?.delete();
  client?.dispose();
});

recipeRepositoryContract("CosmosRecipeRepository", async () => {
  const { resources } = await container.items.query<{ id: string }>("SELECT c.id FROM c").fetchAll();
  await Promise.all(resources.map(({ id }) => container.item(id, id).delete()));
  return new CosmosRecipeRepository(container);
});

describe("CosmosRecipeRepository document shape", () => {
  it("stores exactly the snapshot, and strips everything Cosmos adds before loading", async () => {
    const recipe = valueOf(Recipe.create(valueOf(RecipeId.create(randomUUID())), {
      name: "Pancakes",
      ingredients: ["Eggs"],
      steps: ["Cook."],
      tags: [],
    }));
    await new CosmosRecipeRepository(container).save(recipe);

    const { resource } = await container.item(recipe.id.value, recipe.id.value).read<RecipeDocument>();

    expect(resource).toBeDefined();
    expect(withoutSystemProperties(resource!)).toStrictEqual(recipe.toSnapshot());
  });

  it("creates the database and container only if they don't exist", async () => {
    const again = await ensureRecipeContainer(client, { database: config.database, container: container.id });
    const { resource } = await again.read();
    expect(resource?.partitionKey?.paths).toEqual(["/id"]);
  });
});

function valueOf<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`Expected ok, got errors: ${JSON.stringify(result.errors)}`);
  return result.value;
}
