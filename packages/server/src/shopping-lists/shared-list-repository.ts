import type { SharedShoppingList, ShareToken } from "@recipebox/domain";

/**
 * Stores sent shopping lists (PLAN-9), one document per list holding exactly `list.toSnapshot()`, keyed by its token. A list
 * never changes once sent, so there is no update; each is removed by the store itself after it expires (Cosmos DB time to
 * live, docs/architecture.md, "Sent shopping lists").
 */
export interface SharedListRepository {
  /**
   * Stores a new list. A token that is already stored is a bug (128 random bits never repeat) and throws; an existing list is
   * never replaced.
   */
  add(list: SharedShoppingList): Promise<void>;
  /**
   * The stored list for `token`, or undefined if there is none. An expired list may still be returned until the store removes
   * it; whether it may be shown is the domain's (`isAvailable`).
   */
  get(token: ShareToken): Promise<SharedShoppingList | undefined>;
}
