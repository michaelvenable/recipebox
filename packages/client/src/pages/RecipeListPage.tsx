import { useRef } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { recipeKeys, tagKeys } from "../api/query-keys.js";
import { type ListedRecipe, type RecipeFilter, fetchRecipes, fetchTags } from "../api/recipes.js";
import { useViewer } from "../auth/sign-in.js";
import { describeResults, isFiltering } from "../recipes/format.js";
import { useListFilter } from "../recipes/list-filter.js";
import { RecipeCard } from "../recipes/RecipeCard.js";
import { TagChips } from "../recipes/TagChips.js";

/**
 * The recipe list at "/" (REC-8), with search by name (REC-9) and tag filter (REC-13). Public (X-1): visitors see it without
 * editing controls (X-8); editors also get "Add recipe" and the to-make mark (PLAN-7).
 */
export function RecipeListPage() {
  const { viewer } = useViewer();
  const isEditor = viewer === "editor";
  const filter = useListFilter();
  const searchField = useRef<HTMLInputElement>(null);

  const recipes = useQuery({
    queryKey: recipeKeys.list(filter.applied),
    queryFn: ({ signal }) => fetchRecipes(filter.applied, signal),
    // While a new search loads, keep showing the previous results rather than flashing a loading message.
    placeholderData: keepPreviousData,
  });
  const tags = useQuery({ queryKey: tagKeys.all, queryFn: ({ signal }) => fetchTags(signal) });

  function showAll() {
    filter.clear();
    // The button that was pressed disappears with the filter; keep focus somewhere useful.
    searchField.current?.focus();
  }

  return (
    <div className="recipe-list-page">
      <header className="page-header">
        {/* Visitors see the app's name, as in docs/mockups/Main.dc.html; editors see the section name (ListEditor). */}
        <h1>{isEditor ? "Catalog" : "Recipe Box"}</h1>
        {isEditor && (
          <Link to="/recipes/new" className="add-recipe">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add recipe
          </Link>
        )}
      </header>

      <form
        role="search"
        className="search"
        onSubmit={(event) => {
          event.preventDefault();
          filter.searchNow();
        }}
      >
        <label htmlFor="recipe-search" className="visually-hidden">
          Search by name
        </label>
        <div className="search-box">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={searchField}
            id="recipe-search"
            type="search"
            placeholder="Find a recipe"
            autoComplete="off"
            enterKeyHint="search"
            value={filter.term}
            onChange={(event) => filter.setTerm(event.target.value)}
          />
        </div>
      </form>

      <TagChips
        tags={tags.data}
        failed={tags.isError}
        retry={() => void tags.refetch()}
        picked={filter.applied.tags}
        toggle={filter.toggleTag}
      />

      <Results
        recipes={recipes.data}
        isPending={recipes.isPending}
        isUpdating={recipes.isPlaceholderData}
        failed={recipes.isError}
        retry={() => void recipes.refetch()}
        filter={filter.applied}
        isEditor={isEditor}
        showAll={showAll}
      />
    </div>
  );
}

interface ResultsProps {
  recipes: ListedRecipe[] | undefined;
  isPending: boolean;
  isUpdating: boolean;
  failed: boolean;
  retry: () => void;
  filter: RecipeFilter;
  isEditor: boolean;
  showAll: () => void;
}

/** The results and their states: loading, error, an empty collection, nothing matching, or the recipes. */
function Results({ recipes: loaded, isPending, isUpdating, failed, retry, filter, isEditor, showAll }: ResultsProps) {
  const filtering = isFiltering(filter);
  const hasTerm = filter.name.trim() !== "";
  // REC-13: with only tags picked, the picked chips say what is shown; a summary only when nothing matches.
  const summarized = hasTerm || (filtering && !isUpdating && loaded?.length === 0);
  // While the unfiltered list loads (e.g. right after "Show all recipes"), an empty previous result would claim "No recipes
  // yet." about a collection it wasn't loaded for, so show loading instead. While a search or filter loads, the previous
  // results stay, and the summary below says "Searching…" in the same live region, so refining a search that matched nothing
  // doesn't flicker.
  const recipes = isUpdating && !filtering && loaded?.length === 0 ? undefined : loaded;

  if (recipes === undefined) {
    if (failed) {
      return (
        <div className="card stack" role="alert">
          <p>Couldn't load the recipes. Check the connection and try again.</p>
          <button type="button" className="button" onClick={retry}>
            Try again
          </button>
        </div>
      );
    }
    return isPending || isUpdating ? <p role="status">Loading recipes…</p> : null;
  }

  if (recipes.length === 0 && !filtering) {
    return (
      <div className="card stack">
        <p>No recipes yet.</p>
        {isEditor && (
          <Link to="/recipes/new" className="button button-primary">
            Add your first recipe
          </Link>
        )}
      </div>
    );
  }

  return (
    <>
      {/* A live region, so screen readers hear how many recipes a search found, or that a filter found none. */}
      <p role="status" className="results-summary">
        {summarized && (
          <>
            {isUpdating ? "Searching…" : describeResults(recipes.length, filter)}{" "}
            <button type="button" className="link-button" onClick={showAll}>
              Show all recipes
            </button>
          </>
        )}
      </p>
      {recipes.length > 0 && (
        <ul className="recipe-list" aria-label="Recipes" aria-busy={isUpdating}>
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} isEditor={isEditor} />
          ))}
        </ul>
      )}
    </>
  );
}
