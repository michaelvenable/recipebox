// The recipe list, tags and thumbnails (docs/api.md, "Public endpoints").
import { EditorRecipeSummary, RecipeSummary, TagCount } from "@recipebox/shared";
import { type Schema, apiBaseUrl, apiGet } from "./client.js";

/** The name search (REC-9) and picked tags (REC-13). The server does the matching (X-13); the client only passes them on. */
export interface RecipeFilter {
  name: string;
  tags: readonly string[];
}

/**
 * A recipe in the list. Visitors get `RecipeSummary`, editors `EditorRecipeSummary` (X-1, PLAN-7); the server decides which,
 * so code that shows the to-make indicator must check that `onToMakeList` is there.
 */
export type ListedRecipe = RecipeSummary | EditorRecipeSummary;

/** Either shape, whole: both are strict, so a list mixing them, or with any unknown field, is refused as a contract bug. */
const RecipeList: Schema<ListedRecipe[]> = {
  parse(input) {
    const editor = EditorRecipeSummary.array().safeParse(input);
    return editor.success ? editor.data : RecipeSummary.array().parse(input);
  },
};

/** The query string for GET /recipes and for the list page's address: `?name=…&tags=a,b`, empty parts left out. */
export function filterQuery(filter: RecipeFilter): string {
  const parts: string[] = [];
  if (filter.name !== "") parts.push(`name=${encodeURIComponent(filter.name)}`);
  // Commas between tags stay readable. A tag can't contain a comma (REC-11), so the comma always separates tags.
  if (filter.tags.length > 0) parts.push(`tags=${filter.tags.map(encodeURIComponent).join(",")}`);
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

/** GET /recipes: sorted, searched and filtered by the server (REC-8, REC-9, REC-13). */
export function fetchRecipes(filter: RecipeFilter, signal?: AbortSignal): Promise<ListedRecipe[]> {
  return apiGet(`/recipes${filterQuery(filter)}`, RecipeList, signal);
}

/** GET /tags: every tag in use with its count, alphabetical (REC-13). */
export function fetchTags(signal?: AbortSignal): Promise<TagCount[]> {
  return apiGet("/tags", TagCount.array(), signal);
}

/** The address of a recipe's thumbnail, for an `<img>` (REC-7, REC-8). Only meaningful when the recipe has a photo. */
export function thumbnailUrl(id: string): string {
  return `${apiBaseUrl()}/recipes/${encodeURIComponent(id)}/thumbnail`;
}

/** Whether a listed recipe is on the to-make list (PLAN-7). False for the public shape, which never has the field (X-1). */
export function isOnToMakeList(recipe: ListedRecipe): boolean {
  return "onToMakeList" in recipe && recipe.onToMakeList;
}
