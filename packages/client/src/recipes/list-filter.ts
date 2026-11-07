// The recipe list's search (REC-9) and tag filter (REC-13), and the tag filter of "haven't made in a while" (COOK-9), each kept
// in its own page's address so reload, back and forward keep them. Being in the address of different pages keeps the two filters
// apart: picking a tag on one doesn't pick it on the other (COOK-9).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { type RecipeFilter, filterQuery } from "../api/recipes.js";

/** How long typing must pause before the search is applied, so each keystroke doesn't send a request. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Reads `?name=…&tags=a,b`. Missing parts mean no search and no tags; a tag picked twice counts once. */
export function filterFromSearch(search: string): RecipeFilter {
  const params = new URLSearchParams(search);
  return { name: params.get("name") ?? "", tags: tagsFromParams(params) };
}

function tagsFromParams(params: URLSearchParams): string[] {
  const tags = (params.get("tags") ?? "").split(",").filter((tag) => tag !== "");
  return [...new Set(tags)];
}

/** `tags` with `tag` picked if it wasn't, or unpicked if it was. */
function toggled(tags: readonly string[], tag: string): string[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
}

/**
 * The applied filter, from the address, and the search field's text, which reaches the address once typing pauses
 * (SEARCH_DEBOUNCE_MS), on Enter, or when a tag is toggled. Changes replace the history entry rather than adding one, so Back
 * leaves the list instead of stepping through every search; returning to the list (Back from a recipe, or reload) restores it.
 */
export function useListFilter() {
  const location = useLocation();
  const navigate = useNavigate();
  const applied = useMemo(() => filterFromSearch(location.search), [location.search]);
  const [term, setTerm] = useState(applied.name);
  // The name this page last put in the address. A different name there came from outside (back, forward, a link), and
  // replaces whatever is in the search field.
  const written = useRef(applied.name);

  const apply = useCallback(
    (next: RecipeFilter) => {
      written.current = next.name;
      navigate({ search: filterQuery(next) }, { replace: true });
    },
    [navigate],
  );

  useEffect(() => {
    if (applied.name !== written.current) {
      written.current = applied.name;
      setTerm(applied.name);
    }
  }, [applied.name]);

  useEffect(() => {
    if (term === written.current) return;
    const timer = setTimeout(() => apply({ ...applied, name: term }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, applied, apply]);

  /** Applies the search field's text now (Enter). */
  const searchNow = useCallback(() => {
    if (term !== written.current) apply({ ...applied, name: term });
  }, [term, applied, apply]);

  /** Picks or unpicks a tag, applying any search text still waiting for the pause along with it. */
  const toggleTag = useCallback(
    (tag: string) => {
      apply({ name: term, tags: toggled(applied.tags, tag) });
    },
    [term, applied, apply],
  );

  /** Clears the search and every picked tag: the unfiltered list (REC-9, REC-13). */
  const clear = useCallback(() => {
    setTerm("");
    apply({ name: "", tags: [] });
  }, [apply]);

  return { applied, term, setTerm, searchNow, toggleTag, clear };
}

/**
 * Picked tags only, from `?tags=a,b` in the page's address, for a view with no search: "haven't made in a while" (COOK-9).
 * Like useListFilter, changes replace the history entry.
 */
export function useTagFilter() {
  const location = useLocation();
  const navigate = useNavigate();
  const tags = useMemo(() => tagsFromParams(new URLSearchParams(location.search)), [location.search]);

  const apply = useCallback(
    (next: readonly string[]) => navigate({ search: filterQuery({ name: "", tags: next }) }, { replace: true }),
    [navigate],
  );

  /** Picks or unpicks a tag. */
  const toggleTag = useCallback((tag: string) => void apply(toggled(tags, tag)), [tags, apply]);

  /** Unpicks every tag: every recipe again (COOK-9). */
  const clear = useCallback(() => void apply([]), [apply]);

  return { tags, toggleTag, clear };
}
