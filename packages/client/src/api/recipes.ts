// Recipes, tags and their images (docs/api.md, "Public endpoints"), and the changes made from the recipe view and the create and
// edit form (docs/api.md, "Editor endpoints").
import {
  EditorRecipe,
  EditorRecipeSummary,
  PublicRecipe,
  type RecipeContentInput,
  RecipeSummary,
  RediscoverEntry,
  ShoppingItem,
  Tag,
  TagCount,
  ToMakeEntry,
  TrashEntry,
} from "@recipebox/shared";
import { type Schema, apiBaseUrl, apiChange, apiChangeNoContent, apiGet, apiUpload } from "./client.js";

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

/** `?v=…` for a photo changed in this app (recipes/photo-version.ts); the server ignores it. Nothing for version 0. */
function versionQuery(version: number): string {
  return version === 0 ? "" : `?v=${version}`;
}

/** The address of a recipe's thumbnail, for an `<img>` (REC-7, REC-8). Only meaningful when the recipe has a photo. */
export function thumbnailUrl(id: string, version = 0): string {
  return `${apiBaseUrl()}/recipes/${encodeURIComponent(id)}/thumbnail${versionQuery(version)}`;
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
export function photoUrl(id: string, version = 0): string {
  return `${apiBaseUrl()}${recipePath(id)}/photo${versionQuery(version)}`;
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

/** GET /plan: the to-make list, oldest first (PLAN-3). Editors only (X-1). */
export function fetchPlan(signal?: AbortSignal): Promise<ToMakeEntry[]> {
  return apiGet("/plan", ToMakeEntry.array(), signal);
}

/**
 * GET /plan/shopping-list: every ingredient of every recipe on the to-make list, sorted by the server (PLAN-8, X-13). Editors
 * only (X-1).
 */
export function fetchShoppingList(signal?: AbortSignal): Promise<ShoppingItem[]> {
  return apiGet("/plan/shopping-list", ShoppingItem.array(), signal);
}

/**
 * GET /recommendations: never cooked first by name, then least recently cooked first (COOK-6), only recipes with every picked
 * tag (COOK-9), as the server filters them. Editors only (X-1).
 */
export function fetchRecommendations(tags: readonly string[], signal?: AbortSignal): Promise<RediscoverEntry[]> {
  return apiGet(`/recommendations${filterQuery({ name: "", tags })}`, RediscoverEntry.array(), signal);
}

/**
 * GET /tag-suggestions: tags on other recipes containing `typed`, as the server matches them (REC-12, X-13). `recipeId` is
 * undefined for a recipe not created yet, which the API takes as "no recipe" (docs/api.md).
 */
export function fetchTagSuggestions(recipeId: string | undefined, typed: string, signal?: AbortSignal): Promise<Tag[]> {
  const forRecipe = recipeId === undefined ? "" : `&recipeId=${encodeURIComponent(recipeId)}`;
  return apiGet(`/tag-suggestions?typed=${encodeURIComponent(typed)}${forRecipe}`, Tag.array(), signal);
}

// Changes from the create and edit form. The content goes as typed; trimming, discarding blank entries and every rule are the
// server's (REC-1, REC-2, X-13).

/** POST /recipes (REC-1). Answers with the created recipe, with the id the server chose. */
export function createRecipe(content: RecipeContentInput): Promise<EditorRecipe> {
  return apiChange("POST", "/recipes", EditorRecipe, content);
}

/** PUT /recipes/{id}/content: the whole content, tags included; photo, to-make status and history stay as they are (REC-5). */
export function saveRecipeContent(id: string, content: RecipeContentInput): Promise<EditorRecipe> {
  return apiChange("PUT", `${recipePath(id)}/content`, EditorRecipe, content);
}

/** PUT /recipes/{id}/photo: adds or replaces the photo, as multipart/form-data with the file as the only part (REC-7). */
export function uploadPhoto(id: string, file: File): Promise<EditorRecipe> {
  return apiUpload(`${recipePath(id)}/photo`, EditorRecipe, file);
}

/** DELETE /recipes/{id}/photo (REC-7). */
export function removePhoto(id: string): Promise<EditorRecipe> {
  return apiChange("DELETE", `${recipePath(id)}/photo`, EditorRecipe);
}

// The trash (docs/api.md, "Trash"). Delete and restore send `{}`, never a time: the server records its own and measures the 30
// days by its own clock (X-12, REC-16).

/** DELETE /recipes/{id}: moves the recipe to the trash (REC-6). Deleting one already there changes nothing (REC-17). */
export function deleteRecipe(id: string): Promise<void> {
  return apiChangeNoContent("DELETE", recipePath(id));
}

/** GET /trash: the deleted recipes, most recently deleted first (REC-14). */
export function fetchTrash(signal?: AbortSignal): Promise<TrashEntry[]> {
  return apiGet("/trash", TrashEntry.array(), signal);
}

/**
 * POST /trash/{id}/restore (REC-15). Answers with the restored recipe; 409 `trash.expired` once its 30 days are up (REC-16).
 * Restoring a recipe that isn't in the trash changes nothing and answers with it.
 */
export function restoreRecipe(id: string): Promise<EditorRecipe> {
  return apiChange("POST", `/trash/${encodeURIComponent(id)}/restore`, EditorRecipe);
}
