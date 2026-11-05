// The changes an editor makes from the recipe view, and what each one makes stale.
import { type QueryClient, useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import type { EditorRecipe } from "@recipebox/shared";
import { ApiError } from "../api/client.js";
import { planKeys, recipeKeys, rediscoverKeys, tagKeys } from "../api/query-keys.js";
import { addToPlan, attachTag, markCooked, removeFromPlan, removeTag } from "../api/recipes.js";

export type RecipeChange =
  | { kind: "markCooked" }
  | { kind: "addToPlan" }
  | { kind: "removeFromPlan" }
  | { kind: "attachTag"; tag: string }
  | { kind: "removeTag"; tag: string };

export function isTagChange(change: RecipeChange | undefined): boolean {
  return change?.kind === "attachTag" || change?.kind === "removeTag";
}

function send(id: string, change: RecipeChange): Promise<EditorRecipe> {
  switch (change.kind) {
    case "markCooked":
      return markCooked(id);
    case "addToPlan":
      return addToPlan(id);
    case "removeFromPlan":
      return removeFromPlan(id);
    case "attachTag":
      return attachTag(id, change.tag);
    case "removeTag":
      return removeTag(id, change.tag);
  }
}

/**
 * Changes to recipe `id`. The server answers with the whole changed recipe, which replaces the cached one, so the view shows
 * exactly what was saved, such as the recipe leaving the to-make list after cooking (PLAN-5). Lists that show part of it are
 * marked stale and reload when next shown.
 *
 * `busy` is true while any change to this recipe is being saved, from this view or one opened before it: the mutation cache
 * outlives the page, so leaving and reopening the recipe on a slow connection can't record a second cooking (COOK-1, COOK-8).
 * The server applies each change to the stored recipe, so two at once could also race.
 */
export function useRecipeChange(id: string) {
  const queryClient = useQueryClient();
  const mutationKey = recipeKeys.change(id);
  const mutation = useMutation({
    mutationKey,
    mutationFn: (change: RecipeChange) => send(id, change),
    // Runs even if the view that started the change has gone, so the cache always gets the saved recipe.
    onSuccess: (recipe, change) => showSavedRecipe(queryClient, recipe, { tagsChanged: isTagChange(change) }),
  });
  const busy = useIsMutating({ mutationKey }) > 0;
  return { mutation, busy };
}

/**
 * Puts a recipe the server has just saved into the cache, and marks stale what shows part of it. Every list entry shows the
 * recipe's name, tags and thumbnail, and some its to-make mark (REC-8, PLAN-3, PLAN-7, COOK-6); tag counts (REC-13) and
 * suggestions (REC-12) change only when tags may have.
 */
export function showSavedRecipe(queryClient: QueryClient, recipe: EditorRecipe, { tagsChanged }: { tagsChanged: boolean }): void {
  queryClient.setQueryData(recipeKeys.detail(recipe.id), recipe);
  void queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
  void queryClient.invalidateQueries({ queryKey: planKeys.all });
  void queryClient.invalidateQueries({ queryKey: rediscoverKeys.all });
  if (tagsChanged) void queryClient.invalidateQueries({ queryKey: tagKeys.all });
}

/**
 * What to tell the editor when a change fails: the server's own messages when it refused the change, such as "This recipe is in
 * the trash." (REC-17) or a tag rule (REC-11); otherwise that the change didn't get through.
 */
export function changeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.errors.length > 0 ? error.errors.map((e) => e.message).join(" ") : "The server couldn't make the change. Try again.";
  }
  // fetch rejects with a TypeError when the request doesn't reach the server.
  if (error instanceof TypeError) return "Couldn't reach the server. Check the connection and try again.";
  return "Something went wrong. Reload the page to see the recipe as saved.";
}
