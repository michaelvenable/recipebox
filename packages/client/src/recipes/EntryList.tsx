import { useEffect, useId, useRef, useState } from "react";
import { type Entry, type EntryField, entryField, newEntry } from "./recipe-form.js";

interface EntryListProps {
  field: EntryField;
  entries: readonly Entry[];
  onChange: (entries: Entry[]) => void;
  /** Messages by form field (recipe-form.ts, FormErrors): the list's own and each row's. */
  errors: ReadonlyMap<string, readonly string[]>;
}

const NOUNS: Record<EntryField, { title: string; one: string; One: string }> = {
  ingredients: { title: "Ingredients", one: "ingredient", One: "Ingredient" },
  steps: { title: "Steps", one: "step", One: "Step" },
};

/** A row's text field, by the row's key, or the + Add button. */
type FocusTarget = number | "add";

/**
 * Ingredients or steps as rows of free text, in order (REC-3), with adding and removing (REC-5). Each row is a multi-line field,
 * since an entry may run to 1,000 characters. The length is the server's to check: a browser's maxlength counts UTF-16 units,
 * not characters as a person sees them (X-13), so it would cut off entries the server accepts.
 */
export function EntryList({ field, entries, onChange, errors }: EntryListProps) {
  const noun = NOUNS[field];
  const id = useId();
  const listErrors = errors.get(field);
  const addButton = useRef<HTMLButtonElement>(null);
  const textFields = useRef(new Map<number, HTMLTextAreaElement>());
  const [focus, setFocus] = useState<FocusTarget>();

  // A new row's field doesn't exist yet, and a removed row's button takes focus with it; put focus where the editor expects.
  useEffect(() => {
    if (focus === undefined) return;
    setFocus(undefined);
    if (focus === "add") addButton.current?.focus();
    else textFields.current.get(focus)?.focus();
  }, [focus]);

  function textField(key: number) {
    return (element: HTMLTextAreaElement | null) => {
      if (element === null) textFields.current.delete(key);
      else textFields.current.set(key, element);
    };
  }

  function add() {
    const entry = newEntry();
    onChange([...entries, entry]);
    setFocus(entry.key);
  }

  function remove(index: number) {
    const next = entries[index + 1] ?? entries[index - 1];
    onChange(entries.filter((_, i) => i !== index));
    setFocus(next === undefined ? "add" : next.key);
  }

  return (
    <fieldset className="field entries" aria-describedby={listErrors !== undefined ? `${id}-error` : undefined}>
      <legend className="field-title">{noun.title}</legend>
      <ol className="entry-list">
        {entries.map((entry, index) => {
          const label = `${noun.One} ${index + 1}`;
          const messages = errors.get(entryField(field, entry));
          const errorId = `${id}-${entry.key}-error`;
          return (
            <li key={entry.key} className="entry-row">
              {field === "steps" && (
                <span className="entry-number" aria-hidden="true">
                  {index + 1}
                </span>
              )}
              <div className="entry-text">
                <textarea
                  ref={textField(entry.key)}
                  className="text-input text-area"
                  aria-label={label}
                  rows={field === "steps" ? 3 : 1}
                  value={entry.text}
                  aria-invalid={messages !== undefined || undefined}
                  aria-describedby={messages !== undefined ? errorId : undefined}
                  onChange={(event) =>
                    onChange(entries.map((e) => (e.key === entry.key ? { key: e.key, text: event.target.value } : e)))
                  }
                />
                {messages !== undefined && (
                  <p id={errorId} className="field-error">
                    {messages.join(" ")}
                  </p>
                )}
              </div>
              <button type="button" className="icon-button" aria-label={`Remove ${noun.one} ${index + 1}`} onClick={() => remove(index)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          );
        })}
      </ol>
      {listErrors !== undefined && (
        <p id={`${id}-error`} className="field-error">
          {listErrors.join(" ")}
        </p>
      )}
      <button ref={addButton} type="button" className="add-entry" onClick={add}>
        + Add {noun.one}
      </button>
    </fieldset>
  );
}
