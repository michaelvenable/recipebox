import type { Recipe, RecipeId } from "@recipebox/domain";

/**
 * Stores recipes, one document per recipe holding exactly `recipe.toSnapshot()` (docs/domain-model.md, "Snapshot").
 * Loaded recipes are independent copies: changing one does nothing until it is passed to `save`.
 */
export interface RecipeRepository {
  get(id: RecipeId): Promise<Recipe | undefined>;
  /**
   * Every stored recipe, including those in the trash; callers filter with the domain functions. The order is unspecified;
   * callers that need an order sort the result.
   */
  list(): Promise<Recipe[]>;
  /** Creates the recipe's document, or replaces it if it exists. */
  save(recipe: Recipe): Promise<void>;
  /** Permanently removes the recipe's document (trash cleanup, REC-16). Removing an unknown id does nothing. */
  remove(id: RecipeId): Promise<void>;
}
