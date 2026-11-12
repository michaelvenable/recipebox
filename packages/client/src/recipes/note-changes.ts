// Adding and deleting a recipe's notes from the recipe view (REC-25).
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client.js";
import { recipeKeys } from "../api/query-keys.js";
import { addNote, deleteNote } from "../api/recipes.js";

export type NoteChange = { kind: "addNote"; text: string } | { kind: "deleteNote"; noteId: string };

/**
 * Note changes to recipe `id`. They share the mutation key of every other change to the recipe (`recipeKeys.change`), so
 * `busy` covers them all and two changes are never sent at once: the server applies each to the stored recipe. The saved
 * recipe replaces the cached one; notes show nowhere else (not in any list, REC-25), so nothing else is made stale.
 *
 * A note that is already gone (404 note.notFound, such as one deleted from another device) reloads the recipe, so the view
 * stops showing it.
 */
export function useNoteChange(id: string) {
  const queryClient = useQueryClient();
  const mutationKey = recipeKeys.change(id);
  const mutation = useMutation({
    mutationKey,
    mutationFn: (change: NoteChange) => (change.kind === "addNote" ? addNote(id, change.text) : deleteNote(id, change.noteId)),
    onSuccess: (recipe) => queryClient.setQueryData(recipeKeys.detail(recipe.id), recipe),
    onError: (error) => {
      if (error instanceof ApiError && error.codes.includes("note.notFound")) {
        void queryClient.invalidateQueries({ queryKey: recipeKeys.detail(id) });
      }
    },
  });
  const busy = useIsMutating({ mutationKey }) > 0;
  return { mutation, busy };
}
