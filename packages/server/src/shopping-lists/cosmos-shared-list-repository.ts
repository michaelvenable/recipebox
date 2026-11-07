import { type Container, type CosmosClient, ErrorResponse } from "@azure/cosmos";
import { type ShareToken, ShoppingListLink, type ShoppingListLinkSnapshot } from "@recipebox/domain";
import type { SharedListRepository } from "./shared-list-repository.js";

/**
 * How long after a link stops working Cosmos DB deletes it. PLAN-9 asks for removal within one day after expiry. The margin
 * keeps a link from vanishing early if the database's clock is a little ahead of the server's; until it is deleted, the domain
 * already refuses it (`isAvailable`).
 */
export const REMOVAL_MARGIN_SECONDS = 60 * 60;

/**
 * The stored document: the snapshot plus `ttl`, Cosmos DB's per-item time to live in seconds after the last write
 * (docs/architecture.md, "Sent shopping lists"). The container has time to live switched on with no default (`defaultTtl: -1`),
 * so only items with `ttl` expire.
 */
export type SharedListDocument = ShoppingListLinkSnapshot & { ttl: number };

/** Properties Cosmos DB adds to every stored document. They are not part of the snapshot. */
interface CosmosSystemProperties {
  _rid?: string;
  _self?: string;
  _etag?: string;
  _attachments?: string;
  _ts?: number;
}

/**
 * The document for `link`: its code, when it was made and nothing else (PLAN-9). It is written once, right when the link is
 * made, so a time to live counted from the write is the link's 7 days (`expiresAt` - `createdAt`) plus the margin: Cosmos DB
 * deletes it within an hour or so after it expires.
 */
export function sharedListDocument(link: ShoppingListLink): SharedListDocument {
  const lifetimeSeconds = Math.ceil((link.expiresAt.epochMillis - link.createdAt.epochMillis) / 1000);
  return { ...link.toSnapshot(), ttl: lifetimeSeconds + REMOVAL_MARGIN_SECONDS };
}

/** Stores each link as one document in a container partitioned by `/id`, the token. */
export class CosmosSharedListRepository implements SharedListRepository {
  constructor(private readonly container: Container) {}

  async add(link: ShoppingListLink): Promise<void> {
    // create, not upsert: an existing document with the same id fails (409) instead of being replaced.
    await this.container.items.create(sharedListDocument(link));
  }

  async get(token: ShareToken): Promise<ShoppingListLink | undefined> {
    // read() reports a missing (or already expired) document as a 404 response with no resource, rather than throwing.
    const { resource } = await this.container
      .item(token.value, token.value)
      .read<SharedListDocument & CosmosSystemProperties>();
    if (resource === undefined) return undefined;
    const { _rid, _self, _etag, _attachments, _ts, ttl, ...snapshot } = resource;
    return ShoppingListLink.fromSnapshot(snapshot);
  }
}

/**
 * Creates the container of shopping list links if it doesn't exist, with time to live switched on, for local development and
 * tests. Production resources are created by the infrastructure scripts (infra/main.bicep), not by the app.
 */
export async function ensureShoppingListContainer(
  client: CosmosClient,
  names: { database: string; shoppingListContainer: string },
): Promise<Container> {
  const { database } = await client.databases.createIfNotExists({ id: names.database });
  const { container } = await database.containers.createIfNotExists({
    id: names.shoppingListContainer,
    partitionKey: { paths: ["/id"] },
    defaultTtl: -1,
  });
  return container;
}

/**
 * The existing container of shopping list links, for every run outside local development and tests. A missing one is an
 * error, never created, as for the recipes container (docs/architecture.md, "Trash cleanup").
 */
export async function openShoppingListContainer(
  client: CosmosClient,
  names: { database: string; shoppingListContainer: string },
): Promise<Container> {
  const container = client.database(names.database).container(names.shoppingListContainer);
  let exists: boolean;
  try {
    exists = (await container.read()).resource !== undefined;
  } catch (error) {
    if (!(error instanceof ErrorResponse && error.code === 404)) throw error;
    exists = false;
  }
  if (!exists) {
    throw new Error(
      `Cosmos DB container ${JSON.stringify(names.shoppingListContainer)} in database ${JSON.stringify(names.database)} does ` +
        "not exist. Outside local development it is created by the infrastructure scripts, never by the app.",
    );
  }
  return container;
}
