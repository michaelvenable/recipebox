// Deleting a recipe (REC-6) and restoring it (REC-15), and what each one makes stale.
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EditorRecipe, RediscoverEntry, TagCount, ToMakeEntry, TrashEntry } from "@recipebox/shared";
import { ApiError } from "../api/client.js";
import { planKeys, recipeKeys, rediscoverKeys, tagKeys, trashKeys } from "../api/query-keys.js";
import { type ListedRecipe, deleteRecipe, restoreRecipe } from "../api/recipes.js";
import { showSavedRecipe } from "./recipe-changes.js";

/** What the app knows about a recipe being deleted: enough to take it out of what is shown, and to name it. */
export interface DeletedRecipe {
  id: string;
  name: string;
  tags: readonly string[];
}

function without<T extends { id: string }>(id: string) {
  return (entries: T[] | undefined) => entries?.filter((entry) => entry.id !== id);
}

/**
 * REC-6: a deleted recipe disappears at once from everywhere else: the lists and search results, the tag counts, the to-make
 * list (PLAN-6) and "haven't made in a while". Each is then reloaded, so it shows what the server now says. The recipe itself is
 * removed from the cache rather than marked stale, so opening it again asks the server, which answers "not found" (REC-4),
 * instead of showing the cached copy first (REC-17).
 */
export function recipeDeleted(queryClient: QueryClient, recipe: DeletedRecipe): void {
  queryClient.removeQueries({ queryKey: recipeKeys.detail(recipe.id), exact: true });
  queryClient.setQueriesData<ListedRecipe[]>({ queryKey: recipeKeys.lists() }, without(recipe.id));
  queryClient.setQueriesData<ToMakeEntry[]>({ queryKey: planKeys.all }, without(recipe.id));
  queryClient.setQueriesData<RediscoverEntry[]>({ queryKey: rediscoverKeys.all }, without(recipe.id));
  queryClient.setQueryData<TagCount[]>(tagKeys.all, (counts) =>
    counts?.flatMap((count) => {
      if (!recipe.tags.includes(count.tag)) return [count];
      // A tag on no other recipe leaves the filter (REC-13).
      return count.count > 1 ? [{ ...count, count: count.count - 1 }] : [];
    }),
  );
  void queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
  void queryClient.invalidateQueries({ queryKey: tagKeys.all });
  void queryClient.invalidateQueries({ queryKey: planKeys.all });
  void queryClient.invalidateQueries({ queryKey: rediscoverKeys.all });
  void queryClient.invalidateQueries({ queryKey: trashKeys.all });
}

/**
 * REC-15: the restored recipe, with its content, photo, tags and history, goes into the cache as the server answered it (not on
 * the to-make list, PLAN-6), and leaves the trash. Everything that lists recipes is reloaded.
 */
export function recipeRestored(queryClient: QueryClient, recipe: EditorRecipe): void {
  showSavedRecipe(queryClient, recipe, { tagsChanged: true });
  queryClient.setQueryData<TrashEntry[]>(trashKeys.all, without(recipe.id));
  void queryClient.invalidateQueries({ queryKey: trashKeys.all });
}

/**
 * Whether a restore failed because the recipe can't come back (REC-16): its 30 days in the trash are up (409 `trash.expired`),
 * or the daily cleanup has already removed it (404). Either way its entry is dead.
 */
export function isBeyondRestore(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 404 || (error.status === 409 && error.codes.includes("trash.expired"));
}

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * The trashed recipes whose restore was refused as expired (REC-16). The server goes on listing them until the daily cleanup
 * removes them (docs/architecture.md, "Trash cleanup"), so without this a reload of the trash would bring them back.
 */
export function useExpiredTrash(): ReadonlySet<string> {
  const { data } = useQuery({ queryKey: trashKeys.expired(), queryFn: () => NO_IDS, staleTime: Infinity, gcTime: Infinity });
  return data ?? NO_IDS;
}

function restoreExpired(queryClient: QueryClient, id: string): void {
  queryClient.setQueryData<ReadonlySet<string>>(trashKeys.expired(), (ids) => new Set(ids ?? NO_IDS).add(id));
  queryClient.setQueryData<TrashEntry[]>(trashKeys.all, without(id));
  // Others may have been removed by the same cleanup.
  void queryClient.invalidateQueries({ queryKey: trashKeys.all });
}

/**
 * DELETE /recipes/{id} (REC-6), under the recipe's own mutation key, so the view's other changes wait for it and it waits for
 * them (recipe-changes.ts). `onDeleted` runs even if the view that started it has gone, like the cache updates.
 */
export function useDeleteRecipe(recipe: DeletedRecipe, onDeleted: (recipe: DeletedRecipe) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: recipeKeys.change(recipe.id),
    mutationFn: () => deleteRecipe(recipe.id),
    onSuccess: () => {
      recipeDeleted(queryClient, recipe);
      onDeleted(recipe);
    },
  });
}

/**
 * POST /trash/{id}/restore (REC-15), from the trash or from Undo after deleting (REC-6): the same request and the same cache
 * updates either way. Under the recipe's own mutation key, so a restore and a delete of one recipe can't overlap.
 */
export function useRestoreRecipe(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: recipeKeys.change(id),
    mutationFn: () => restoreRecipe(id),
    onSuccess: (recipe) => recipeRestored(queryClient, recipe),
    onError: (error) => {
      if (isBeyondRestore(error)) restoreExpired(queryClient, id);
    },
  });
}
