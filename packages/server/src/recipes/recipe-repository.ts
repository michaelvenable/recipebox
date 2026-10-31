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
  /**
   * The stored recipe with an opaque version that changes every time it is saved, for `removeIfUnchanged`. Undefined for an
   * unknown id.
   */
  getWithVersion(id: RecipeId): Promise<VersionedRecipe | undefined>;
  /**
   * Permanently removes the recipe's document only if it is still at `version`, i.e. not saved since it was read (trash
   * cleanup, REC-16; docs/architecture.md, "Trash cleanup"). Returns whether it removed it: false if the recipe was saved in
   * between or no longer exists.
   */
  removeIfUnchanged(id: RecipeId, version: RecipeVersion): Promise<boolean>;
}

/** A stored recipe's version. Only compare it by passing it back to the repository that returned it. */
export type RecipeVersion = string & { readonly __brand: "RecipeVersion" };

export interface VersionedRecipe {
  recipe: Recipe;
  version: RecipeVersion;
}
