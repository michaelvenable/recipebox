import { Instant } from "./instant.js";
import { RecipeName } from "./recipe-name.js";
import type { Recipe } from "./recipe.js";
import { Tag } from "./tag.js";
import { containsText } from "./text.js";

/**
 * The recipe list, filtered (REC-8, REC-9, REC-13): recipes whose name matches `name` and that have every picked tag,
 * sorted by name. No name and no tags returns every recipe. Deleted recipes are skipped (REC-6).
 *
 * Picked tags are read like tag input (trimmed, lowercased, NFC), so "Dinner " picks "dinner". A picked text that isn't a
 * valid tag (blank or too long) can't be on any recipe, so no recipe has all picked tags and the result is empty.
 */
export function findRecipes(recipes: readonly Recipe[], by: { name?: string; tags?: readonly string[] }): Recipe[] {
  const picked = (by.tags ?? []).map((t) => Tag.create(t));
  if (picked.some((p) => !p.ok)) return [];
  const tags = picked.flatMap((p) => (p.ok ? [p.value] : []));
  const term = by.name ?? "";
  return sortByName(
    recipes.filter(
      (r) =>
        !r.isDeleted && r.content.name.matches(term) && tags.every((wanted) => r.tags.some((t) => t.equals(wanted))),
    ),
  );
}

/**
 * Every tag on at least one recipe, with how many recipes have it, alphabetically (REC-13, X-13). Deleted recipes don't
 * count (REC-6), so a tag whose last recipe is deleted or loses it simply disappears; there is no tag list to keep in sync.
 */
export function tagsInUse(recipes: readonly Recipe[]): { tag: Tag; count: number }[] {
  const counts = new Map<string, { tag: Tag; count: number }>();
  for (const r of recipes) {
    if (r.isDeleted) continue;
    for (const tag of r.tags) {
      const entry = counts.get(tag.value);
      if (entry === undefined) counts.set(tag.value, { tag, count: 1 });
      else entry.count += 1;
    }
  }
  return [...counts.values()].sort((a, b) => Tag.compare(a.tag, b.tag));
}

/**
 * Tags in use on other recipes that contain the typed text, ignoring case and accents (REC-12, X-13), alphabetically.
 * Tags `forRecipe` already has are left out. With `forRecipe` undefined (a recipe not yet created), every recipe counts as
 * another recipe and only the typed text matters. Deleted recipes are skipped (REC-6).
 */
export function suggestTags(recipes: readonly Recipe[], forRecipe: Recipe | undefined, typed: string): Tag[] {
  const term = typed.normalize("NFC").trim();
  const others = forRecipe === undefined ? recipes : recipes.filter((r) => !r.id.equals(forRecipe.id));
  const own = forRecipe?.tags ?? [];
  return tagsInUse(others)
    .map((entry) => entry.tag)
    .filter((tag) => containsText(tag.value, term) && !own.some((t) => t.equals(tag)));
}

/** Deleted recipes only, most recently deleted first (REC-14). */
export function trashContents(recipes: readonly Recipe[]): Recipe[] {
  return recipes
    .flatMap((r) => (r.deletedAt === undefined ? [] : [{ recipe: r, deletedAt: r.deletedAt }]))
    .sort((a, b) => Instant.compare(b.deletedAt, a.deletedAt))
    .map((entry) => entry.recipe);
}

/**
 * The "to make" list (PLAN-3): recipes on the list, oldest added first; recipes added at the same moment by name (REC-8,
 * X-13). Deleted recipes are skipped (REC-6, PLAN-6).
 */
export function toMakeList(recipes: readonly Recipe[]): Recipe[] {
  return sortByName(recipes.filter((r) => !r.isDeleted))
    .flatMap((r) => (r.addedToMakeListAt === undefined ? [] : [{ recipe: r, addedAt: r.addedToMakeListAt }]))
    .sort((a, b) => Instant.compare(a.addedAt, b.addedAt))
    .map((entry) => entry.recipe);
}

/** By name, ignoring case and accents (REC-8, X-13). Returns a new array. */
export function sortByName(recipes: readonly Recipe[]): Recipe[] {
  return [...recipes].sort((a, b) => RecipeName.compare(a.content.name, b.content.name));
}
