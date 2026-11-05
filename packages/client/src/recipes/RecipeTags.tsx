import { type FormEvent, useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { tagKeys } from "../api/query-keys.js";
import { fetchTagSuggestions } from "../api/recipes.js";
import { focusIsUnclaimed } from "./focus.js";

/** How long typing must pause before suggestions are asked for, so each keystroke doesn't send a request. */
export const SUGGESTION_DEBOUNCE_MS = 250;

/** Editing from the recipe view (REC-10): absent for visitors and non-editors (X-8). */
export interface TagEditing {
  /** Attaches the tag as typed; `done` runs once it is saved. */
  attach: (tag: string, done: () => void) => void;
  /** Removes the tag; `done` runs once it is saved. */
  remove: (tag: string, done: () => void) => void;
  /** A change is being saved; controls wait for it. */
  busy: boolean;
  /** Why the last tag change failed, from the server (e.g. a tag rule, REC-11), or undefined. */
  error: string | undefined;
  /**
   * The text typed and not yet added, when the owner needs it: the create and edit form adds it on Save and counts it as an
   * unsaved change. Otherwise the add form keeps it to itself. Closing the add form clears it.
   */
  draft?: { text: string; setText: (text: string) => void } | undefined;
}

interface RecipeTagsProps {
  /** Undefined in the form for a recipe not created yet. */
  recipeId: string | undefined;
  /** In the recipe view, as saved: the server's alphabetical order (REC-11). In the form, as added so far. */
  tags: readonly string[];
  editing?: TagEditing | undefined;
}

/**
 * A recipe's tags. Editors can also remove each one and add tags with suggestions (REC-10, REC-12), from the recipe view, where
 * each change is saved at once, and from the create and edit form, where they are saved with the rest of the content.
 */
export function RecipeTags({ recipeId, tags, editing }: RecipeTagsProps) {
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const closed = useRef(false);

  // Back to "+ Tag" once the form closes, so keyboard and screen reader users don't lose their place. The button only exists
  // again after the render that closes the form.
  useEffect(() => {
    if (!adding && closed.current) {
      closed.current = false;
      addButton.current?.focus();
    }
  }, [adding]);

  // After a removal is saved, the pressed button is gone: focus the next tag's remove button, or "+ Tag" after the last tag,
  // once the saved tags are shown and the buttons no longer wait (a disabled button can't take focus). Not if the editor has
  // moved focus elsewhere meanwhile (focusIsUnclaimed).
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const [afterRemoval, setAfterRemoval] = useState<{ removed: string; next: string | undefined; pressed: Element }>();
  const busy = editing?.busy ?? false;
  useEffect(() => {
    if (afterRemoval === undefined || tags.includes(afterRemoval.removed) || busy) return;
    setAfterRemoval(undefined);
    if (!focusIsUnclaimed(afterRemoval.pressed)) return;
    const next = afterRemoval.next === undefined ? undefined : removeButtons.current.get(afterRemoval.next);
    (next ?? addButton.current)?.focus();
  }, [afterRemoval, tags, busy]);

  if (editing === undefined && tags.length === 0) return null;

  function close() {
    closed.current = true;
    setAdding(false);
    editing?.draft?.setText("");
  }

  function remove(editing: TagEditing, tag: string, pressed: Element) {
    const next = tags[tags.indexOf(tag) + 1];
    editing.remove(tag, () => setAfterRemoval({ removed: tag, next, pressed }));
  }

  return (
    <div className="recipe-tags">
      <ul className="tag-list" aria-label="Tags">
        {tags.map((tag) => (
          <li key={tag} className="tag">
            {tag}
            {editing !== undefined && (
              <button
                ref={(button) => {
                  if (button === null) removeButtons.current.delete(tag);
                  else removeButtons.current.set(tag, button);
                }}
                type="button"
                className="tag-remove"
                aria-label={`Remove tag ${tag}`}
                disabled={editing.busy}
                onClick={(event) => remove(editing, tag, event.currentTarget)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </li>
        ))}
        {editing !== undefined && !adding && (
          <li>
            {/* A 44px hit area around the smaller chip (X-3). */}
            <button ref={addButton} type="button" className="tag-add" onClick={() => setAdding(true)}>
              <span>+ Tag</span>
            </button>
          </li>
        )}
      </ul>
      {editing !== undefined && adding && <AddTagForm recipeId={recipeId} tags={tags} editing={editing} close={close} />}
      {editing?.error !== undefined && !adding && (
        <p className="form-error" role="alert">
          {editing.error}
        </p>
      )}
    </div>
  );
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
 * Typing a tag, with the tags already used on other recipes offered as suggestions (REC-12). The text goes to the server as typed;
 * trimming, lowercasing and the tag rules are the server's (REC-11, X-13). The form stays open after adding, for the next tag.
 *
 * The server leaves out the tags the stored recipe has (REC-12). In the create and edit form the shown tags aren't saved yet, so
 * suggestions already among them are left out here too; in the recipe view this changes nothing.
 */
function AddTagForm({
  recipeId,
  tags,
  editing,
  close,
}: {
  recipeId: string | undefined;
  tags: readonly string[];
  editing: TagEditing;
  close: () => void;
}) {
  const [ownTyped, setOwnTyped] = useState("");
  const typed = editing.draft?.text ?? ownTyped;
  const setTyped = editing.draft?.setText ?? setOwnTyped;
  const input = useRef<HTMLInputElement>(null);
  const query = useDebouncedValue(typed, SUGGESTION_DEBOUNCE_MS);
  // Suggestions only help; if they can't be loaded, the editor can still type the tag.
  const suggestions = useQuery({
    queryKey: tagKeys.suggestions(recipeId, query),
    queryFn: ({ signal }) => fetchTagSuggestions(recipeId, query, signal),
    placeholderData: keepPreviousData,
  });
  const offered = (suggestions.data ?? []).filter((tag) => !tags.includes(tag));

  useEffect(() => input.current?.focus(), []);

  function attach(tag: string) {
    editing.attach(tag, () => {
      setTyped("");
      input.current?.focus();
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (typed.trim() !== "") attach(typed);
  }

  return (
    <form
      className="add-tag-form"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <label htmlFor="new-tag" className="field-label">
        Add a tag
      </label>
      <div className="add-tag-row">
        <input
          ref={input}
          id="new-tag"
          className="text-input"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          enterKeyHint="done"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          aria-describedby={editing.error !== undefined ? "new-tag-error" : undefined}
        />
        <button type="submit" className="button button-small" disabled={editing.busy}>
          Add
        </button>
        <button type="button" className="button button-small" onClick={close}>
          Done
        </button>
      </div>
      {editing.error !== undefined && (
        <p id="new-tag-error" className="form-error" role="alert">
          {editing.error}
        </p>
      )}
      {offered.length > 0 && (
        <div className="tag-suggestions" role="group" aria-label="Suggested tags">
          {offered.map((tag) => (
            <button key={tag} type="button" className="chip" disabled={editing.busy} onClick={() => attach(tag)}>
              {tag}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
