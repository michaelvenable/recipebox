import { Instant } from "./instant.js";
import { hasAllTags, sortByName } from "./finding.js";
import type { Recipe } from "./recipe.js";

/**
 * The "haven't made in a while" view (COOK-6): never-cooked recipes first, by name; then by last cooked, oldest first.
 * Recipes last cooked at the same time are sorted by name (domain-model.md, proposed: the spec doesn't define ties).
 * Deleted recipes are skipped (REC-6). With tags picked, only recipes that have all of them, by the same rule as the recipe
 * list's filter (REC-13), still in this order (COOK-9).
 */
export function orderForRediscovery(recipes: readonly Recipe[], by: { tags?: readonly string[] } = {}): Recipe[] {
  const hasPickedTags = hasAllTags(by.tags ?? []);
  return sortByName(recipes.filter((r) => !r.isDeleted && hasPickedTags(r))).sort((a, b) => {
    const lastA = a.lastCookedAt;
    const lastB = b.lastCookedAt;
    if (lastA === undefined || lastB === undefined) {
      return (lastA === undefined ? 0 : 1) - (lastB === undefined ? 0 : 1);
    }
    // Array.prototype.sort is stable, so equal times keep the name order from sortByName.
    return Instant.compare(lastA, lastB);
  });
}
