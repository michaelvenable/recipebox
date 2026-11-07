// Every TanStack Query key for recipe data, in one place, so a change can invalidate what it affects. For example, deleting a
// recipe (REC-6) or changing its tags (REC-10) invalidates the recipe lists and `tagKeys.all`; adding it to the to-make list
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
  /** The mutation key of creating a recipe (REC-1), which has no id until the server answers. */
  create: () => [...recipeKeys.all, "create"] as const,
};

export const tagKeys = {
  /** GET /tags, the tags in use with counts (REC-13), and below it the suggestions (REC-12). */
  all: ["tags"] as const,
  /** GET /tag-suggestions for one recipe (undefined for a new one) and typed text (REC-12). */
  suggestions: (recipeId: string | undefined, typed: string) =>
    [...tagKeys.all, "suggestions", { recipeId: recipeId ?? null, typed }] as const,
};

/**
 * Not an API call: how many times this app has replaced or removed a recipe's photo (REC-7), added to the image addresses so
 * the browser doesn't reuse the old image it has already loaded. Outside `recipeKeys.all`, so invalidating recipes leaves it.
 */
export const photoKeys = {
  version: (id: string) => ["photoVersion", id] as const,
};

/** GET /plan, the to-make list (PLAN-3). Adding, removing and cooking (PLAN-5) change it. */
export const planKeys = {
  all: ["plan"] as const,
};

/**
 * GET /plan/shopping-list (PLAN-8). It changes with the to-make list and with the ingredients and names of the recipes on it, so
 * every change that updates the plan cache updates it too. Outside `planKeys.all`, whose entries have another shape.
 */
export const shoppingListKeys = {
  all: ["shoppingList"] as const,
};

/**
 * GET /recommendations, "Haven't made in a while" (COOK-6). Cooking a recipe changes its order. `all` is the unfiltered view and
 * the prefix of the views filtered by tags (COOK-9), so invalidating it reaches them all.
 */
export const rediscoverKeys = {
  all: ["recommendations"] as const,
  /** The view with only recipes that have every tag in `tags` (COOK-9); `all` when none is picked. */
  list: (tags: readonly string[]) => (tags.length === 0 ? rediscoverKeys.all : ([...rediscoverKeys.all, { tags: [...tags] }] as const)),
  /** Whether a query key is one of the views filtered by tags, not the unfiltered one. */
  isFiltered: (queryKey: readonly unknown[]) => queryKey[0] === rediscoverKeys.all[0] && queryKey.length > 1,
};

/** GET /trash (REC-14). Deleting (REC-6) and restoring (REC-15) change it. */
export const trashKeys = {
  all: ["trash"] as const,
  /**
   * Not an API call: the trashed recipes whose restore the server refused because their 30 days are up (REC-16). The server
   * still lists them until the daily cleanup removes them, so the trash leaves them out for as long as the app is open.
   * Outside `trashKeys.all`, so invalidating the trash leaves it.
   */
  expired: () => ["trashExpired"] as const,
};

/**
 * GET /shopping-lists/{token}, a shopping list link's page (PLAN-9): the current shopping list, the same for every caller. The
 * page reloads it when the person comes back to it (SharedListPage), so no change here invalidates it.
 */
export const sharedListKeys = {
  detail: (token: string) => ["sharedList", token] as const,
};
