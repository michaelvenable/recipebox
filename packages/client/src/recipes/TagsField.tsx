import { useEffect, useId, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { tagKeys } from "../api/query-keys.js";
import { fetchTagSuggestions } from "../api/recipes.js";
import { tagBeingTyped, tagItems, withSuggestion } from "./recipe-form.js";

/** How long typing must pause before suggestions are asked for, so each keystroke doesn't send a request. */
export const SUGGESTION_DEBOUNCE_MS = 250;

interface TagsFieldProps {
  /** Undefined for a recipe not created yet. */
  recipeId: string | undefined;
  /** The tags as typed, separated by commas (REC-10). */
  value: string;
  onChange: (value: string) => void;
  /** The server's messages about the tags, each naming the tag it is about (recipe-form.ts, formErrors). */
  errors: readonly string[] | undefined;
}

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * The tags of the create and edit form: one text field, a comma between tags (REC-10, REC-11). While it has focus, the tags
 * already used on other recipes that contain the tag being typed, the text after the last comma, are offered (REC-12); choosing
 * one puts it in place of that text. The text goes to the server as typed, split at the commas; trimming, lowercasing and the
 * tag rules are the server's (REC-11, X-13).
 *
 * The server leaves out the tags the stored recipe has (REC-12). The tags typed before the last comma aren't saved yet, so
 * suggestions already among them are left out here too.
 */
export function TagsField({ recipeId, value, onChange, errors }: TagsFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const typing = tagBeingTyped(value).current.trim();
  const query = useDebouncedValue(typing, SUGGESTION_DEBOUNCE_MS);
  // Suggestions only help; if they can't be loaded, the editor can still type the tag.
  const suggestions = useQuery({
    queryKey: tagKeys.suggestions(recipeId, query),
    queryFn: ({ signal }) => fetchTagSuggestions(recipeId, query, signal),
    placeholderData: keepPreviousData,
    enabled: open,
  });
  // Compared in lowercase, as the server stores tags (REC-11): "Dinner, " already has "dinner".
  const typed = new Set(tagItems(tagBeingTyped(value).before).map((tag) => tag.toLowerCase()));
  const offered = open ? (suggestions.data ?? []).filter((tag) => !typed.has(tag)) : [];

  function choose(tag: string) {
    onChange(withSuggestion(value, tag));
    input.current?.focus();
  }

  return (
    <div
      className="field"
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        // Open while focus stays in the field: on the text, or on a suggestion reached with Tab.
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <label htmlFor={`${id}-tags`} className="field-title">
        Tags
      </label>
      <input
        ref={input}
        id={`${id}-tags`}
        className="text-input"
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        enterKeyHint="done"
        value={value}
        aria-invalid={errors !== undefined || undefined}
        aria-describedby={errors !== undefined ? `${id}-tags-error` : undefined}
        onChange={(event) => {
          setOpen(true);
          onChange(event.target.value);
        }}
      />
      {errors !== undefined && (
        <p id={`${id}-tags-error`} className="field-error">
          {errors.join(" ")}
        </p>
      )}
      {offered.length > 0 && (
        <div className="tag-suggestions" role="group" aria-label="Suggested tags">
          {offered.map((tag) => (
            <button
              key={tag}
              type="button"
              className="chip"
              // Keeps focus in the text, so the suggestions stay open and typing goes on after the chosen tag.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
