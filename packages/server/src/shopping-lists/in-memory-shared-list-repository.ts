import { SharedShoppingList, type SharedShoppingListSnapshot, type ShareToken } from "@recipebox/domain";
import type { SharedListRepository } from "./shared-list-repository.js";

/**
 * A `SharedListRepository` for fast tests. It keeps serialized snapshots, as the real database does. Nothing is ever removed:
 * expiry is decided by the domain on every read, which the route tests check with a controllable clock.
 */
export class InMemorySharedListRepository implements SharedListRepository {
  private readonly documents = new Map<string, string>();

  async add(list: SharedShoppingList): Promise<void> {
    const snapshot = list.toSnapshot();
    if (this.documents.has(snapshot.id)) throw new Error("A shared shopping list with this token is already stored");
    this.documents.set(snapshot.id, JSON.stringify(snapshot));
  }

  async get(token: ShareToken): Promise<SharedShoppingList | undefined> {
    const json = this.documents.get(token.value);
    return json === undefined ? undefined : SharedShoppingList.fromSnapshot(JSON.parse(json) as SharedShoppingListSnapshot);
  }

  /** Every stored snapshot, for tests that check what was stored. */
  snapshots(): SharedShoppingListSnapshot[] {
    return [...this.documents.values()].map((json) => JSON.parse(json) as SharedShoppingListSnapshot);
  }
}
