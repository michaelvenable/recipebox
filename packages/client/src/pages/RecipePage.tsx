import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EditorRecipe } from "@recipebox/shared";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError } from "../api/client.js";
import { recipeKeys } from "../api/query-keys.js";
import { type ViewedRecipe, fetchRecipe, isEditorRecipe, photoUrl } from "../api/recipes.js";
import { useViewer } from "../auth/sign-in.js";
import { useNotices } from "../layout/notices.js";
import { formatTotalTime } from "../recipes/format.js";
import { RecipeActions } from "../recipes/RecipeActions.js";
import { ToMakeBadge } from "../recipes/RecipeCard.js";
import { type RecipeChange, changeErrorMessage, useRecipeChange } from "../recipes/recipe-changes.js";
import { RecipeTags } from "../recipes/RecipeTags.js";
import { usePhotoVersion } from "../recipes/photo-version.js";
import { useDeleteRecipe } from "../recipes/trash-changes.js";
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

/** Which ingredients, prep entries or steps are ticked, by position. */
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
  // One change at a time: the server applies each to the stored recipe, so two at once could race.
  const change = useRecipeChange(recipe.id);

  // REC-19: ticks live only here, never saved or sent; they go when the page does.
  const [ingredientTicks, setIngredientTicks] = useState(NONE);
  const [prepTicks, setPrepTicks] = useState(NONE);
  const [stepTicks, setStepTicks] = useState(NONE);
  useWakeLock(true);

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
          {/* REC-10: the view shows the tags but can't change them, for editors too. */}
          <RecipeTags tags={recipe.tags} />
        </header>

        {editorRecipe !== undefined && <EditorActions recipe={editorRecipe} change={change} />}

        <section className="recipe-section" aria-labelledby="ingredients-heading">
          <div className="section-header">
            <h2 id="ingredients-heading">Ingredients</h2>
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
        {/* REC-20: before the steps, and no section at all without prep. */}
        {recipe.prep !== undefined && recipe.prep.length > 0 && (
          <NumberedSection id="prep" title="Prep" noun="Prep" entries={recipe.prep} ticks={prepTicks} setTicks={setPrepTicks} />
        )}
        <NumberedSection id="steps" title="Steps" noun="Step" entries={recipe.steps} ticks={stepTicks} setTicks={setStepTicks} />

        {editorRecipe !== undefined && <BottomActions recipe={editorRecipe} busy={change.busy} />}
      </div>
    </article>
  );
}

interface NumberedSectionProps {
  id: string;
  title: string;
  /** What each entry is called in its tick button's label, as in "Step 2 done". */
  noun: string;
  entries: readonly string[];
  ticks: Ticks;
  setTicks: (update: (ticks: Ticks) => Ticks) => void;
}

/** Prep or steps: in the order entered (REC-3), numbered from 1 (REC-4), each number ticked off when done (REC-19). */
function NumberedSection({ id, title, noun, entries, ticks, setTicks }: NumberedSectionProps) {
  return (
    <section className="recipe-section" aria-labelledby={`${id}-heading`}>
      <div className="section-header">
        <h2 id={`${id}-heading`}>{title}</h2>
      </div>
      <ol className="steps">
        {entries.map((entry, index) => {
          const done = ticks.has(index);
          return (
            <li key={index} className={done ? "step ticked" : "step"}>
              <button
                type="button"
                className="step-number"
                aria-pressed={done}
                aria-label={`${noun} ${index + 1} done`}
                onClick={() => setTicks((current) => toggled(current, index))}
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
              <span className="step-text">{entry}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Edit and Delete, at the bottom of the recipe, away from the cooking actions (docs/mockups/RecipeView.dc.html). Delete asks
 * nothing (REC-6): the recipe goes to the trash, the app goes to the list, and the layout shows the Undo message there. `busy`
 * covers every change to this recipe, the delete included, so nothing else is sent while it is saved.
 */
function BottomActions({ recipe, busy }: { recipe: EditorRecipe; busy: boolean }) {
  const navigate = useNavigate();
  const notices = useNotices();
  const remove = useDeleteRecipe(recipe, notices.deleted);

  function onDelete() {
    if (busy) return;
    // Only while this view is still open: if the editor has gone elsewhere meanwhile, they stay there (the message still shows).
    // Replacing the recipe's history entry, so Back doesn't lead to "not found".
    remove.mutate(undefined, { onSuccess: () => void navigate("/", { replace: true }) });
  }

  return (
    <>
      <div className="recipe-bottom-actions">
        <Link to={`/recipes/${encodeURIComponent(recipe.id)}/edit`} className="button">
          Edit
        </Link>
        <button type="button" className="button button-delete" disabled={busy} onClick={onDelete}>
          Delete
        </button>
      </div>
      {remove.isError && (
        <p className="form-error" role="alert">
          {changeErrorMessage(remove.error)}
        </p>
      )}
    </>
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

function EditorActions({ recipe, change }: { recipe: EditorRecipe; change: Change }) {
  const run = (kind: RecipeChange["kind"]) => (done: () => void) => change.mutation.mutate({ kind }, { onSuccess: done });
  const { mutation } = change;
  return (
    <RecipeActions
      recipe={recipe}
      busy={change.busy}
      error={mutation.isError ? changeErrorMessage(mutation.error) : undefined}
      markCooked={run("markCooked")}
      addToPlan={run("addToPlan")}
      removeFromPlan={run("removeFromPlan")}
    />
  );
}
