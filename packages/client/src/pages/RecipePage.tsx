import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EditorRecipe } from "@recipebox/shared";
import { Link, useParams } from "react-router";
import { ApiError } from "../api/client.js";
import { recipeKeys } from "../api/query-keys.js";
import { type ViewedRecipe, fetchRecipe, isEditorRecipe, photoUrl } from "../api/recipes.js";
import { useViewer } from "../auth/sign-in.js";
import { formatTotalTime } from "../recipes/format.js";
import { RecipeActions } from "../recipes/RecipeActions.js";
import { ToMakeBadge } from "../recipes/RecipeCard.js";
import { type RecipeChange, changeErrorMessage, isTagChange, useRecipeChange } from "../recipes/recipe-changes.js";
import { RecipeTags, type TagEditing } from "../recipes/RecipeTags.js";
import { usePhotoVersion } from "../recipes/photo-version.js";
import { useWakeLock } from "../recipes/use-wake-lock.js";

/**
 * A recipe at /recipes/:id (REC-4). Keyed by the id, so opening another recipe starts afresh: its ticks are cleared like on
 * leaving (REC-19).
 */
export function RecipePage() {
  const { id = "" } = useParams();
  return <RecipeView key={id} id={id} />;
}

function RecipeView({ id }: { id: string }) {
  const recipe = useQuery({ queryKey: recipeKeys.detail(id), queryFn: ({ signal }) => fetchRecipe(id, signal) });

  if (recipe.data !== undefined) return <RecipeContent recipe={recipe.data} />;
  if (recipe.error instanceof ApiError && recipe.error.status === 404) return <RecipeNotFound />;
  if (recipe.isError) {
    return (
      <div className="card stack" role="alert">
        <p>Couldn't load the recipe. Check the connection and try again.</p>
        <button type="button" className="button" onClick={() => void recipe.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  return <p role="status">Loading recipe…</p>;
}

/** An unknown id or a recipe in the trash: the server answers 404 to both (REC-4, REC-6). */
export function RecipeNotFound() {
  return (
    <>
      <h1>Recipe not found</h1>
      <p className="muted">
        This recipe doesn't exist, or it has been deleted. <Link to="/">Back to the recipes</Link>
      </p>
    </>
  );
}

/** Which ingredients or steps are ticked, by position. */
type Ticks = ReadonlySet<number>;
const NONE: Ticks = new Set();

function toggled(ticks: Ticks, index: number): Ticks {
  const next = new Set(ticks);
  if (!next.delete(index)) next.add(index);
  return next;
}

function RecipeContent({ recipe }: { recipe: ViewedRecipe }) {
  const { viewer } = useViewer();
  // Both checks, as on the list: private parts come only in the editor shape (X-1), and a recipe loaded before the session
  // ended (X-9) shouldn't keep offering changes once the app knows it is a visitor (X-8).
  const editorRecipe = viewer === "editor" && isEditorRecipe(recipe) ? recipe : undefined;
  // One change at a time across tags and actions: the server applies each to the stored recipe, so two at once could race.
  const change = useRecipeChange(recipe.id);

  // REC-19: ticks live only here, never saved or sent; they go when the page does.
  const [ingredientTicks, setIngredientTicks] = useState(NONE);
  const [stepTicks, setStepTicks] = useState(NONE);
  const screenOn = useWakeLock(true);

  return (
    <article className="recipe-view">
      <div className="recipe-side">
        <RecipePhoto recipe={recipe} />
        <header className="recipe-header">
          {editorRecipe?.toMake !== undefined && <ToMakeBadge />}
          <h1>{recipe.name}</h1>
          {recipe.totalTimeMinutes !== undefined && (
            <p className="recipe-time">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v4l3 2" />
              </svg>
              {formatTotalTime(recipe.totalTimeMinutes)} total
            </p>
          )}
          {editorRecipe !== undefined ? (
            <EditorTags recipe={editorRecipe} change={change} />
          ) : (
            <RecipeTags recipeId={recipe.id} tags={recipe.tags} />
          )}
        </header>

        {editorRecipe !== undefined && <EditorActions recipe={editorRecipe} change={change} />}

        {screenOn && (
          <p className="screen-on-note" role="status">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            Screen stays on while this recipe is open
          </p>
        )}

        <section className="recipe-section" aria-labelledby="ingredients-heading">
          <div className="section-header">
            <h2 id="ingredients-heading">Ingredients</h2>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setIngredientTicks(NONE);
                setStepTicks(NONE);
              }}
            >
              Clear ticks
            </button>
          </div>
          {/* REC-3: in the order entered. */}
          <ul className="ingredients">
            {recipe.ingredients.map((ingredient, index) => (
              <li key={index}>
                <label className={ingredientTicks.has(index) ? "ingredient ticked" : "ingredient"}>
                  <input
                    type="checkbox"
                    checked={ingredientTicks.has(index)}
                    onChange={() => setIngredientTicks((ticks) => toggled(ticks, index))}
                  />
                  <span>{ingredient}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="recipe-main">
        <section className="recipe-section" aria-labelledby="steps-heading">
          <div className="section-header">
            <h2 id="steps-heading">Steps</h2>
            <span className="muted">Tap a number when done</span>
          </div>
          {/* REC-4: numbered from 1. */}
          <ol className="steps">
            {recipe.steps.map((step, index) => {
              const done = stepTicks.has(index);
              return (
                <li key={index} className={done ? "step ticked" : "step"}>
                  <button
                    type="button"
                    className="step-number"
                    aria-pressed={done}
                    aria-label={`Step ${index + 1} done`}
                    onClick={() => setStepTicks((ticks) => toggled(ticks, index))}
                  >
                    <span aria-hidden="true">
                      {done ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12l5 5 9-10" />
                        </svg>
                      ) : (
                        index + 1
                      )}
                    </span>
                  </button>
                  <span className="step-text">{step}</span>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Delete (REC-6) joins Edit here, at the bottom, in a later task. */}
        {editorRecipe !== undefined && (
          <div className="recipe-bottom-actions">
            <Link to={`/recipes/${encodeURIComponent(recipe.id)}/edit`} className="button">
              Edit
            </Link>
          </div>
        )}
      </div>
    </article>
  );
}

/** The photo (REC-7), or nothing when the recipe has none or it can't be loaded. */
function RecipePhoto({ recipe }: { recipe: ViewedRecipe }) {
  const [failed, setFailed] = useState(false);
  const version = usePhotoVersion(recipe.id);
  if (!recipe.hasPhoto || failed) return null;
  return (
    <img className="recipe-photo" src={photoUrl(recipe.id, version)} alt={`${recipe.name} photo`} decoding="async" onError={() => setFailed(true)} />
  );
}

type Change = ReturnType<typeof useRecipeChange>;

/** Splits the failure of the last change between the two places that show it: the tags, or the cooking actions. */
function errorFor({ mutation }: Change, tags: boolean): string | undefined {
  if (!mutation.isError || isTagChange(mutation.variables) !== tags) return undefined;
  return changeErrorMessage(mutation.error);
}

function EditorTags({ recipe, change }: { recipe: EditorRecipe; change: Change }) {
  const editing: TagEditing = {
    attach: (tag, done) => change.mutation.mutate({ kind: "attachTag", tag }, { onSuccess: done }),
    remove: (tag, done) => change.mutation.mutate({ kind: "removeTag", tag }, { onSuccess: done }),
    busy: change.busy,
    error: errorFor(change, true),
  };
  return <RecipeTags recipeId={recipe.id} tags={recipe.tags} editing={editing} />;
}

function EditorActions({ recipe, change }: { recipe: EditorRecipe; change: Change }) {
  const run = (kind: Exclude<RecipeChange["kind"], "attachTag" | "removeTag">) => (done: () => void) =>
    change.mutation.mutate({ kind }, { onSuccess: done });
  return (
    <RecipeActions
      recipe={recipe}
      busy={change.busy}
      error={errorFor(change, false)}
      markCooked={run("markCooked")}
      addToPlan={run("addToPlan")}
      removeFromPlan={run("removeFromPlan")}
    />
  );
}
