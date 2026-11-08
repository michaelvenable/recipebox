import { type Container, type CosmosClient, ErrorResponse } from "@azure/cosmos";
import { type ImportId, RecipeImport, type RecipeImportSnapshot } from "@recipebox/domain";
import type { ImportRepository } from "./import-repository.js";

/**
 * How long Cosmos DB keeps an import's document after its last write: one day (docs/architecture.md, "Recipe import").
 * `GET /imports` lists what is left, the imports of the last day.
 */
export const IMPORT_TTL_SECONDS = 24 * 60 * 60;

/**
 * The stored document: the snapshot plus `ttl`, Cosmos DB's per-item time to live in seconds after the last write. The
 * container has time to live switched on with no default (`defaultTtl: -1`), as for shopping list links.
 */
export type ImportDocument = RecipeImportSnapshot & { ttl: number };

/** Properties Cosmos DB adds to every stored document. They are not part of the snapshot. */
interface CosmosSystemProperties {
  _rid?: string;
  _self?: string;
  _etag?: string;
  _attachments?: string;
  _ts?: number;
}

/** The document for `recipeImport`: exactly its snapshot, and the time to live. */
export function importDocument(recipeImport: RecipeImport): ImportDocument {
  return { ...recipeImport.toSnapshot(), ttl: IMPORT_TTL_SECONDS };
}

/** Stores each import as one document in a container partitioned by `/id`, the import id (IMP-3). */
export class CosmosImportRepository implements ImportRepository {
  constructor(private readonly container: Container) {}

  async add(recipeImport: RecipeImport): Promise<void> {
    // create, not upsert: an existing document with the same id fails (409) instead of being replaced.
    await this.container.items.create(importDocument(recipeImport));
  }

  async save(recipeImport: RecipeImport): Promise<void> {
    const document = importDocument(recipeImport);
    await this.container.item(document.id, document.id).replace(document);
  }

  async get(id: ImportId): Promise<RecipeImport | undefined> {
    // read() reports a missing document as a 404 response with no resource, rather than throwing.
    const { resource } = await this.container.item(id.value, id.value).read<ImportDocument & CosmosSystemProperties>();
    return resource === undefined ? undefined : toRecipeImport(resource);
  }

  async list(): Promise<RecipeImport[]> {
    // Cosmos DB stops returning a document once its time to live has passed, even before it deletes it.
    const { resources } = await this.container.items.readAll<ImportDocument & CosmosSystemProperties>().fetchAll();
    return resources.map(toRecipeImport);
  }
}

function toRecipeImport({ _rid, _self, _etag, _attachments, _ts, ttl, ...snapshot }: ImportDocument & CosmosSystemProperties) {
  return RecipeImport.fromSnapshot(snapshot);
}

/**
 * Creates the import container if it doesn't exist, with time to live switched on and no default, for local development and
 * tests. Production resources are created by the infrastructure scripts, not by the app.
 */
export async function ensureImportContainer(
  client: CosmosClient,
  names: { database: string; importContainer: string },
): Promise<Container> {
  const { database } = await client.databases.createIfNotExists({ id: names.database });
  const { container } = await database.containers.createIfNotExists({
    id: names.importContainer,
    partitionKey: { paths: ["/id"] },
    defaultTtl: -1,
  });
  return container;
}

/**
 * The existing import container, for every run outside local development and tests. A missing one is an error, never created,
 * as for the recipes container (docs/architecture.md, "Trash cleanup").
 */
export async function openImportContainer(
  client: CosmosClient,
  names: { database: string; importContainer: string },
): Promise<Container> {
  const container = client.database(names.database).container(names.importContainer);
  let exists: boolean;
  try {
    exists = (await container.read()).resource !== undefined;
  } catch (error) {
    if (!(error instanceof ErrorResponse && error.code === 404)) throw error;
    exists = false;
  }
  if (!exists) {
    throw new Error(
      `Cosmos DB container ${JSON.stringify(names.importContainer)} in database ${JSON.stringify(names.database)} does ` +
        "not exist. Outside local development it is created by the infrastructure scripts, never by the app.",
    );
  }
  return container;
}
