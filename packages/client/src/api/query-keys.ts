// Every TanStack Query key for recipe data, in one place, so a change can invalidate what it affects. For example, deleting a
// recipe (REC-6) or changing its tags (REC-10) invalidates `recipeKeys.all` and `tagKeys.all`; adding it to the to-make list
// (PLAN-1) invalidates `recipeKeys.lists()` for the indicator (PLAN-7). /me has its own key, ME_QUERY_KEY in auth/sign-in.ts.
import type { RecipeFilter } from "./recipes.js";

export const recipeKeys = {
  /** Everything about recipes: the lists and single recipes. */
  all: ["recipes"] as const,
  /** Every recipe list, whatever its filter (REC-8, REC-9, REC-13). */
  lists: () => [...recipeKeys.all, "list"] as const,
  list: (filter: RecipeFilter) => [...recipeKeys.lists(), { name: filter.name, tags: [...filter.tags] }] as const,
  /** One recipe, GET /recipes/{id} (REC-4). A change from the recipe view writes its answer here. */
  detail: (id: string) => [...recipeKeys.all, "detail", id] as const,
  /** The mutation key of every change to one recipe, so a view can tell a change is still being saved (COOK-1). */
  change: (id: string) => [...recipeKeys.all, "change", id] as const,
};

export const tagKeys = {
  /** GET /tags, the tags in use with counts (REC-13), and below it the suggestions (REC-12). */
  all: ["tags"] as const,
  /** GET /tag-suggestions for one recipe and typed text (REC-12). */
  suggestions: (recipeId: string, typed: string) => [...tagKeys.all, "suggestions", { recipeId, typed }] as const,
};

/** GET /plan, the to-make list (PLAN-3). Adding, removing and cooking (PLAN-5) change it. */
export const planKeys = {
  all: ["plan"] as const,
};

/** GET /recommendations, "Haven't made in a while" (COOK-6). Cooking a recipe changes its order. */
export const rediscoverKeys = {
  all: ["recommendations"] as const,
};
