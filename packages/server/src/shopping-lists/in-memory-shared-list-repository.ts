import { ShoppingListLink, type ShoppingListLinkSnapshot, type ShareToken } from "@recipebox/domain";
import type { SharedListRepository } from "./shared-list-repository.js";

/**
 * A `SharedListRepository` for fast tests. It keeps serialized snapshots, as the real database does. Nothing is ever removed:
 * expiry is decided by the domain on every read, which the route tests check with a controllable clock.
 */
export class InMemorySharedListRepository implements SharedListRepository {
  private readonly documents = new Map<string, string>();

  async add(link: ShoppingListLink): Promise<void> {
    const snapshot = link.toSnapshot();
    if (this.documents.has(snapshot.id)) throw new Error("A shopping list link with this token is already stored");
    this.documents.set(snapshot.id, JSON.stringify(snapshot));
  }

  async get(token: ShareToken): Promise<ShoppingListLink | undefined> {
    const json = this.documents.get(token.value);
    return json === undefined ? undefined : ShoppingListLink.fromSnapshot(JSON.parse(json) as ShoppingListLinkSnapshot);
  }

  /** Every stored document, for tests that check what was stored. */
  documentsStored(): Record<string, unknown>[] {
    return [...this.documents.values()].map((json) => JSON.parse(json) as Record<string, unknown>);
  }
}
