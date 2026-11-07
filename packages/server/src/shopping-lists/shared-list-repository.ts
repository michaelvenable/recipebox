import type { ShareToken, ShoppingListLink } from "@recipebox/domain";

/**
 * Stores shopping list links (PLAN-9), one document per link holding exactly `link.toSnapshot()`: its code and when it was
 * made, nothing of the list, which is built live on every read. A link never changes once made, so there is no update; each
 * is removed by the store itself after it expires (Cosmos DB time to live, docs/architecture.md, "Sent shopping lists").
 */
export interface SharedListRepository {
  /**
   * Stores a new link. A token that is already stored is a bug (128 random bits never repeat) and throws; an existing link is
   * never replaced.
   */
  add(link: ShoppingListLink): Promise<void>;
  /**
   * The stored link for `token`, or undefined if there is none. An expired link may still be returned until the store removes
   * it; whether it still works is the domain's (`isAvailable`).
   */
  get(token: ShareToken): Promise<ShoppingListLink | undefined>;
}
