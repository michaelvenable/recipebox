// The recipe list's search (REC-9) and tag filter (REC-13), kept in the page's address so reload, back and forward keep them.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { type RecipeFilter, filterQuery } from "../api/recipes.js";

/** How long typing must pause before the search is applied, so each keystroke doesn't send a request. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Reads `?name=…&tags=a,b`. Missing parts mean no search and no tags; a tag picked twice counts once. */
export function filterFromSearch(search: string): RecipeFilter {
  const params = new URLSearchParams(search);
  const tags = (params.get("tags") ?? "").split(",").filter((tag) => tag !== "");
  return { name: params.get("name") ?? "", tags: [...new Set(tags)] };
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
      const tags = applied.tags.includes(tag) ? applied.tags.filter((t) => t !== tag) : [...applied.tags, tag];
      apply({ name: term, tags });
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
