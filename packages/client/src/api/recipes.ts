// Recipes, tags and their images (docs/api.md, "Public endpoints"), and the changes made from the recipe view (docs/api.md,
// "Editor endpoints").
import { EditorRecipe, EditorRecipeSummary, PublicRecipe, RecipeSummary, Tag, TagCount, type TagRequest } from "@recipebox/shared";
import { type Schema, apiBaseUrl, apiChange, apiGet } from "./client.js";

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

/**
 * One recipe. Visitors get `PublicRecipe`, editors `EditorRecipe` with to-make status and cooking history (X-1); the server
 * decides which, so code that shows private parts must check for them with `isEditorRecipe`.
 */
export type ViewedRecipe = PublicRecipe | EditorRecipe;

/** Either shape, whole, as for the list: a public recipe with any private field is refused as a contract bug. */
const OneRecipe: Schema<ViewedRecipe> = {
  parse(input) {
    const editor = EditorRecipe.safeParse(input);
    return editor.success ? editor.data : PublicRecipe.parse(input);
  },
};

export function isEditorRecipe(recipe: ViewedRecipe): recipe is EditorRecipe {
  return "cookedAt" in recipe;
}

function recipePath(id: string): string {
  return `/recipes/${encodeURIComponent(id)}`;
}

/** GET /recipes/{id} (REC-4). A 404 ApiError means not found: an unknown id or a recipe in the trash. */
export function fetchRecipe(id: string, signal?: AbortSignal): Promise<ViewedRecipe> {
  return apiGet(recipePath(id), OneRecipe, signal);
}

/** The address of a recipe's photo, for an `<img>` (REC-7). Only meaningful when the recipe has a photo. */
export function photoUrl(id: string): string {
  return `${apiBaseUrl()}${recipePath(id)}/photo`;
}

// Changes from the recipe view. Each answers with the changed recipe. The ones without input send `{}`, never a time: the
// server records its own (X-12).

/** POST /recipes/{id}/cookings: "I cooked this today" (COOK-1). The server also takes it off the to-make list (PLAN-5). */
export function markCooked(id: string): Promise<EditorRecipe> {
  return apiChange("POST", `${recipePath(id)}/cookings`, EditorRecipe);
}

/** POST /recipes/{id}/add-to-plan (PLAN-1, PLAN-2). */
export function addToPlan(id: string): Promise<EditorRecipe> {
  return apiChange("POST", `${recipePath(id)}/add-to-plan`, EditorRecipe);
}

/** POST /recipes/{id}/remove-from-plan (PLAN-4). */
export function removeFromPlan(id: string): Promise<EditorRecipe> {
  return apiChange("POST", `${recipePath(id)}/remove-from-plan`, EditorRecipe);
}

/** POST /recipes/{id}/tags: the tag as typed; the server reads and checks it (REC-10, REC-11). */
export function attachTag(id: string, tag: string): Promise<EditorRecipe> {
  return apiChange("POST", `${recipePath(id)}/tags`, EditorRecipe, { tag } satisfies TagRequest);
}

/** DELETE /recipes/{id}/tags (REC-10). */
export function removeTag(id: string, tag: string): Promise<EditorRecipe> {
  return apiChange("DELETE", `${recipePath(id)}/tags`, EditorRecipe, { tag } satisfies TagRequest);
}

/** GET /tag-suggestions: tags on other recipes containing `typed`, as the server matches them (REC-12, X-13). */
export function fetchTagSuggestions(recipeId: string, typed: string, signal?: AbortSignal): Promise<Tag[]> {
  const query = `?typed=${encodeURIComponent(typed)}&recipeId=${encodeURIComponent(recipeId)}`;
  return apiGet(`/tag-suggestions${query}`, Tag.array(), signal);
}
