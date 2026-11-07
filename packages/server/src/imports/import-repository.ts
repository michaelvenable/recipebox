import type { RecipeImport } from "@recipebox/domain";

/**
 * Stores imports, one document per import holding exactly `recipeImport.toSnapshot()`, keyed by the import id (IMP-3;
 * docs/architecture.md, "Recipe import"). Any number can be in progress at once. Each is removed by the store itself one day
 * after it was last written (Cosmos DB time to live), so `list` gives what is left: the imports of the last day. Loaded imports
 * are independent copies: changing one does nothing until it is passed to `save`.
 */
export interface ImportRepository {
  /** Stores a new import. An id that is already stored is a bug (ids are random UUIDs) and throws; nothing is replaced. */
  add(recipeImport: RecipeImport): Promise<void>;
  /** Replaces a stored import, such as one ended as failed. */
  save(recipeImport: RecipeImport): Promise<void>;
  /** Every stored import, in no particular order; callers sort. */
  list(): Promise<RecipeImport[]>;
}
