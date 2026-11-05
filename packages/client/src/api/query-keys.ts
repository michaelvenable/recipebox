// Every TanStack Query key for recipe data, in one place, so a change can invalidate what it affects. For example, deleting a
// recipe (REC-6) or changing its tags (REC-10) invalidates `recipeKeys.all` and `tagKeys.all`; adding it to the to-make list
// (PLAN-1) invalidates `recipeKeys.lists()` for the indicator (PLAN-7). /me has its own key, ME_QUERY_KEY in auth/sign-in.ts.
import type { RecipeFilter } from "./recipes.js";

export const recipeKeys = {
  /** Everything about recipes: lists now, single recipes when they get keys here. */
  all: ["recipes"] as const,
  /** Every recipe list, whatever its filter (REC-8, REC-9, REC-13). */
  lists: () => [...recipeKeys.all, "list"] as const,
  list: (filter: RecipeFilter) => [...recipeKeys.lists(), { name: filter.name, tags: [...filter.tags] }] as const,
};

export const tagKeys = {
  /** GET /tags, the tags in use with counts (REC-13). */
  all: ["tags"] as const,
};
