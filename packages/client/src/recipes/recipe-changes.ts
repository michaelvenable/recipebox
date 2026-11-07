// The changes an editor makes from the recipe view, and what each one makes stale.
import { type Mutation, type QueryClient, useIsMutating, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import type { EditorRecipe, RecipeSummary, RediscoverEntry, ToMakeEntry } from "@recipebox/shared";
import { ApiError } from "../api/client.js";
import { planKeys, recipeKeys, rediscoverKeys, tagKeys } from "../api/query-keys.js";
import { type ListedRecipe, addToPlan, markCooked, removeFromPlan } from "../api/recipes.js";

/** Tags are changed only in the create and edit form, not from the view (REC-10). */
export type RecipeChange = { kind: "markCooked" } | { kind: "addToPlan" } | { kind: "removeFromPlan" };

function send(id: string, change: RecipeChange): Promise<EditorRecipe> {
  switch (change.kind) {
    case "markCooked":
      return markCooked(id);
    case "addToPlan":
      return addToPlan(id);
    case "removeFromPlan":
      return removeFromPlan(id);
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
    onSuccess: (recipe) => showSavedRecipe(queryClient, recipe, { tagsChanged: false }),
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
  // What the saved recipe already tells, so a list shown again before it reloads doesn't show the old state first: the
  // to-make mark (PLAN-7), the to-make list (PLAN-1, PLAN-4, PLAN-5) and "haven't made in a while" (COOK-6).
  queryClient.setQueriesData<ListedRecipe[]>({ queryKey: recipeKeys.lists() }, (recipes) =>
    recipes?.map((listed) =>
      listed.id === recipe.id && "onToMakeList" in listed ? { ...listed, onToMakeList: recipe.toMake !== undefined } : listed,
    ),
  );
  queryClient.setQueryData<ToMakeEntry[]>(planKeys.all, (entries) => entries && withPlanEntry(entries, recipe));
  queryClient.setQueryData<RediscoverEntry[]>(rediscoverKeys.all, (entries) => entries && withRediscoverEntry(entries, recipe));
  void queryClient.invalidateQueries({ queryKey: recipeKeys.lists() });
  void queryClient.invalidateQueries({ queryKey: planKeys.all });
  void queryClient.invalidateQueries({ queryKey: rediscoverKeys.all });
  if (tagsChanged) void queryClient.invalidateQueries({ queryKey: tagKeys.all });
}

function summaryOf({ id, name, tags, totalTimeMinutes, hasPhoto }: EditorRecipe): RecipeSummary {
  return { id, name, tags, hasPhoto, ...(totalTimeMinutes === undefined ? {} : { totalTimeMinutes }) };
}

/**
 * The to-make list with the saved recipe as it now stands: gone if it is off the list, updated in place if it was on it, or
 * added at the end if just added, since the list is oldest first (PLAN-3) and nothing was added after it.
 */
function withPlanEntry(entries: ToMakeEntry[], recipe: EditorRecipe): ToMakeEntry[] {
  if (recipe.toMake === undefined) return entries.filter((entry) => entry.id !== recipe.id);
  const entry: ToMakeEntry = { ...summaryOf(recipe), addedAt: recipe.toMake.addedAt };
  return entries.some((e) => e.id === recipe.id) ? entries.map((e) => (e.id === recipe.id ? entry : e)) : [...entries, entry];
}

/**
 * "Haven't made in a while" with the saved recipe as it now stands. A recipe whose last cooking changed was just cooked, so it
 * is now the most recently cooked and goes to the end (COOK-6). Left to the reload: recipes the cached list doesn't have, and a
 * renamed recipe never cooked, since those are in name order and only the server sorts names (X-13).
 */
function withRediscoverEntry(entries: RediscoverEntry[], recipe: EditorRecipe): RediscoverEntry[] {
  const old = entries.find((e) => e.id === recipe.id);
  if (old === undefined) return entries;
  if (recipe.lastCookedAt === undefined && old.name !== recipe.name) return entries;
  const entry: RediscoverEntry = {
    ...summaryOf(recipe),
    ...(recipe.lastCookedAt === undefined ? {} : { lastCookedAt: recipe.lastCookedAt }),
  };
  if (old.lastCookedAt === recipe.lastCookedAt) return entries.map((e) => (e.id === recipe.id ? entry : e));
  return [...entries.filter((e) => e.id !== recipe.id), entry];
}

const CHANGE_PREFIX = [...recipeKeys.all, "change"] as const;

/**
 * The recipes being taken off the to-make list right now (PLAN-4), from any page: the list leaves them out at once, and brings
 * them back if the change fails. Read from the mutation cache, so it holds across leaving and reopening the list.
 */
export function usePendingPlanRemovals(): ReadonlySet<string> {
  const ids = useMutationState({
    filters: { mutationKey: CHANGE_PREFIX, status: "pending" },
    select: (mutation) => {
      const change = mutation.state.variables as RecipeChange | undefined;
      const id = mutation.options.mutationKey?.[2];
      return change?.kind === "removeFromPlan" && typeof id === "string" ? id : undefined;
    },
  });
  return new Set(ids.filter((id) => id !== undefined));
}

/** A removal from the to-make list that the server refused or that didn't get through (PLAN-4). */
export interface FailedPlanRemoval {
  id: string;
  error: unknown;
  /** Identifies the attempt, so a page can tell a new failure from one it has shown. */
  mutationId: number;
}

function isPlanRemoval(mutation: Pick<Mutation, "state">): boolean {
  return (mutation.state.variables as RecipeChange | undefined)?.kind === "removeFromPlan";
}

/**
 * The latest failed removal from the to-make list, if it is also the latest change to its recipe. Read from the mutation cache
 * rather than from the page that started it, so a failure that lands after the editor has left the list and come back is
 * still reported. Cleared by `clearFailedPlanRemovals`, or by a newer change to the recipe.
 */
export function useFailedPlanRemoval(): FailedPlanRemoval | undefined {
  const changes = useMutationState({
    filters: { mutationKey: CHANGE_PREFIX },
    select: (mutation) => ({
      id: mutation.options.mutationKey?.[2],
      mutationId: mutation.mutationId,
      submittedAt: mutation.state.submittedAt,
      failed: mutation.state.status === "error" && isPlanRemoval(mutation),
      error: mutation.state.error,
    }),
  });
  const latest = new Map<unknown, (typeof changes)[number]>();
  for (const change of changes) {
    const seen = latest.get(change.id);
    if (seen === undefined || change.submittedAt >= seen.submittedAt) latest.set(change.id, change);
  }
  let failure: FailedPlanRemoval | undefined;
  let failedAt = -Infinity;
  for (const change of latest.values()) {
    if (change.failed && typeof change.id === "string" && change.submittedAt >= failedAt) {
      failure = { id: change.id, error: change.error, mutationId: change.mutationId };
      failedAt = change.submittedAt;
    }
  }
  return failure;
}

/** Forgets failed removals once the editor has moved on, such as by starting another removal. */
export function clearFailedPlanRemovals(queryClient: QueryClient): void {
  const cache = queryClient.getMutationCache();
  for (const mutation of cache.findAll({ mutationKey: CHANGE_PREFIX, status: "error" })) {
    if (isPlanRemoval(mutation)) cache.remove(mutation);
  }
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
