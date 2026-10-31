import { CosmosClient, ErrorResponse, type Container } from "@azure/cosmos";
import { Recipe, type RecipeId, type RecipeSnapshot } from "@recipebox/domain";
import type { CosmosConfig } from "../config.js";
import type { RecipeRepository, RecipeVersion, VersionedRecipe } from "./recipe-repository.js";

/** Properties Cosmos DB adds to every stored document. They are not part of the snapshot. */
interface CosmosSystemProperties {
  _rid?: string;
  _self?: string;
  _etag?: string;
  _attachments?: string;
  _ts?: number;
}

export type RecipeDocument = RecipeSnapshot & CosmosSystemProperties;

/**
 * Stores each recipe as one document in a container partitioned by `/id`. The document is exactly `recipe.toSnapshot()`
 * (docs/domain-model.md, "Snapshot"); the properties Cosmos adds are removed before rebuilding the `Recipe`.
 */
export class CosmosRecipeRepository implements RecipeRepository {
  constructor(private readonly container: Container) {}

  async get(id: RecipeId): Promise<Recipe | undefined> {
    // read() reports a missing document as a 404 response with no resource, rather than throwing.
    const { resource } = await this.container.item(id.value, id.value).read<RecipeDocument>();
    return resource === undefined ? undefined : toRecipe(resource);
  }

  async list(): Promise<Recipe[]> {
    const { resources } = await this.container.items.readAll<RecipeDocument>().fetchAll();
    return resources.map(toRecipe);
  }

  async save(recipe: Recipe): Promise<void> {
    await this.container.items.upsert(recipe.toSnapshot());
  }

  async remove(id: RecipeId): Promise<void> {
    try {
      await this.container.item(id.value, id.value).delete();
    } catch (error) {
      if (error instanceof ErrorResponse && error.code === 404) return;
      throw error;
    }
  }

  async getWithVersion(id: RecipeId): Promise<VersionedRecipe | undefined> {
    const { resource } = await this.container.item(id.value, id.value).read<RecipeDocument>();
    if (resource === undefined) return undefined;
    // Cosmos DB gives every write of a document a new _etag.
    if (resource._etag === undefined) throw new Error(`Cosmos DB returned recipe ${id.value} without an _etag`);
    return { recipe: toRecipe(resource), version: resource._etag as RecipeVersion };
  }

  async removeIfUnchanged(id: RecipeId, version: RecipeVersion): Promise<boolean> {
    try {
      await this.container.item(id.value, id.value).delete({ accessCondition: { type: "IfMatch", condition: version } });
      return true;
    } catch (error) {
      // 412: saved since it was read; 404: already gone. Either way it was not removed by this call.
      if (error instanceof ErrorResponse && (error.code === 412 || error.code === 404)) return false;
      throw error;
    }
  }
}

export function createCosmosClient(config: CosmosConfig): CosmosClient {
  return new CosmosClient({ endpoint: config.endpoint, key: config.key });
}

/**
 * Creates the database and the recipes container if they don't exist, for local development and tests. Production
 * resources are created by the infrastructure scripts, not by the app.
 */
export async function ensureRecipeContainer(
  client: CosmosClient,
  names: { database: string; container: string },
): Promise<Container> {
  const { database } = await client.databases.createIfNotExists({ id: names.database });
  const { container } = await database.containers.createIfNotExists({
    id: names.container,
    partitionKey: { paths: ["/id"] },
  });
  return container;
}

/**
 * The existing recipes container, for every run outside local development and tests: a missing database or container is an
 * error, never created, so a misconfigured deployment can't start against a new, empty one (docs/architecture.md, "Trash
 * cleanup").
 */
export async function openRecipeContainer(
  client: CosmosClient,
  names: { database: string; container: string },
): Promise<Container> {
  const container = client.database(names.database).container(names.container);
  let exists: boolean;
  try {
    exists = (await container.read()).resource !== undefined;
  } catch (error) {
    if (!(error instanceof ErrorResponse && error.code === 404)) throw error;
    exists = false;
  }
  if (!exists) {
    throw new Error(
      `Cosmos DB container ${JSON.stringify(names.container)} in database ${JSON.stringify(names.database)} does not exist. ` +
        "Outside local development it is created by the infrastructure scripts, never by the app.",
    );
  }
  return container;
}

function toRecipe(document: RecipeDocument): Recipe {
  return Recipe.fromSnapshot(withoutSystemProperties(document));
}

/** `Recipe.fromSnapshot` expects exactly the snapshot, so the properties Cosmos added are dropped first. */
export function withoutSystemProperties(document: RecipeDocument): RecipeSnapshot {
  const { _rid, _self, _etag, _attachments, _ts, ...snapshot } = document;
  return snapshot;
}
