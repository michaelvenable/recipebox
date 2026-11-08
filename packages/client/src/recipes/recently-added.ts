// The "Recently added" row (REC-22), worked out on the device (X-12) from the recipe list the server sends.
import type { ListedRecipe } from "../api/recipes.js";

/** REC-22: the row shows recipes added today or in the 30 calendar days before it, at most 8. */
export const RECENT_DAYS = 30;
export const RECENT_MAX = 8;

/** A listed recipe that has an added time; recipes stored before added times were recorded have none (REC-22). */
export type AddedRecipe = ListedRecipe & { createdAt: string };

/**
 * The recipes for the row, from the unfiltered list as the server sent it, sorted by name (REC-8): those added today or in the
 * 30 days before it, by local calendar date on the device (REC-22, X-12), newest first, at most 8. On Nov 8 a recipe added any
 * time on Oct 9 counts and one added on Oct 8 doesn't. The first day starts at local midnight, built from the calendar date,
 * so a daylight saving change in between doesn't move it by an hour. The sort is stable, so recipes added at the same time
 * keep the server's name order (X-13), which is not re-implemented here. The list never holds recipes in the trash (REC-6).
 * Recipes without an added time are left out. One added after `now`, by a server clock ahead of the device's, counts as new.
 */
export function recentlyAdded(recipes: readonly ListedRecipe[], now: Date): AddedRecipe[] {
  const firstDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - RECENT_DAYS).getTime();
  return recipes
    .filter((recipe): recipe is AddedRecipe => recipe.createdAt !== undefined && Date.parse(recipe.createdAt) >= firstDay)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, RECENT_MAX);
}
