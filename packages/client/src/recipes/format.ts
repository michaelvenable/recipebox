// Text shown in recipe lists. Formatting only: searching, sorting and tag rules are the server's and the domain's (X-13).
import type { RecipeFilter } from "../api/recipes.js";

/** A total time (whole minutes, 1-1440) as "30 min", "2 h" or "2 h 30 min". */
export function formatTotalTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Whether the list is searched or filtered, as opposed to showing every recipe. An empty or blank term searches nothing (REC-9). */
export function isFiltering(filter: RecipeFilter): boolean {
  return filter.name.trim() !== "" || filter.tags.length > 0;
}

const AND = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * What a searched or filtered list shows, e.g. "18 recipes tagged dinner", "3 recipes match “chick”", "No recipes match “b”
 * with the tag dinner". With no results and a term, it starts "No recipes match" with the term (REC-9).
 */
export function describeResults(count: number, filter: RecipeFilter): string {
  const term = filter.name.trim();
  const tags = AND.format(filter.tags);
  const recipes = count === 0 ? "No recipes" : count === 1 ? "1 recipe" : `${count} recipes`;
  if (term === "") return `${recipes} tagged ${tags}`;
  const match = `${recipes} ${count === 1 ? "matches" : "match"} “${term}”`;
  if (filter.tags.length === 0) return match;
  return `${match} with the ${filter.tags.length === 1 ? "tag" : "tags"} ${tags}`;
}
