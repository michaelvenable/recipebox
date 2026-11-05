import { useState } from "react";
import { useIsMutating, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { ApiError } from "../api/client.js";
import { recipeKeys } from "../api/query-keys.js";
import { type ViewedRecipe, fetchRecipe } from "../api/recipes.js";
import { RecipeForm } from "../recipes/RecipeForm.js";
import { RecipeNotFound } from "./RecipePage.js";

/** /recipes/new: an empty form (REC-1). */
export function NewRecipePage() {
  return <RecipeForm recipe={undefined} />;
}

/** /recipes/:id/edit (REC-5). Keyed by the id, so editing another recipe starts afresh. */
export function EditRecipePage() {
  const { id = "" } = useParams();
  return <EditRecipe key={id} id={id} />;
}

function EditRecipe({ id }: { id: string }) {
  const recipe = useQuery({ queryKey: recipeKeys.detail(id), queryFn: ({ signal }) => fetchRecipe(id, signal) });
  const changePending = useIsMutating({ mutationKey: recipeKeys.change(id) }) > 0;

  // Save sends the whole content (REC-5), so the form must start from the recipe as saved now: not a cached copy that may be
  // out of date, and not one from before a change still being saved from the recipe view, such as a tag removal (REC-10).
  // Otherwise saving would quietly undo that change. The reload must also have succeeded: after a failed one the cache still
  // holds the old copy, which may be of a recipe since moved to the trash (404, REC-17) or just out of date. Once filled, the
  // form keeps what is being typed whatever loads later.
  const [start, setStart] = useState<ViewedRecipe>();
  const reloaded = recipe.status === "success" && !recipe.isFetching;
  if (start === undefined && recipe.data !== undefined && reloaded && !changePending) setStart(recipe.data);

  if (start !== undefined) return <RecipeForm recipe={start} />;
  // A recipe in the trash can't be opened, so it can't be edited either (REC-4, REC-17).
  if (recipe.error instanceof ApiError && recipe.error.status === 404) return <RecipeNotFound />;
  if (recipe.isError && !recipe.isFetching) {
    return (
      <>
        <h1>Edit recipe</h1>
        <div className="card stack" role="alert">
          <p>Couldn't load the recipe. Check the connection and try again.</p>
          <button type="button" className="button" onClick={() => void recipe.refetch()}>
            Try again
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <h1>Edit recipe</h1>
      <p role="status">Loading recipe…</p>
    </>
  );
}
