import { useEffect, useId, useRef, useState } from "react";
import { type Entry, type EntryField, entryField, moved, newEntry } from "./recipe-form.js";

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

type FocusTarget = { key: number; control: "text" | "up" | "down" } | "add";

/**
 * Ingredients or steps as rows of free text, in order (REC-3), with adding, removing and moving up and down (REC-5). Each row is
 * a multi-line field, since an entry may run to 1,000 characters. The length is the server's to check: a browser's maxlength
 * counts UTF-16 units, not characters as a person sees them (X-13), so it would cut off entries the server accepts.
 */
export function EntryList({ field, entries, onChange, errors }: EntryListProps) {
  const noun = NOUNS[field];
  const id = useId();
  const listErrors = errors.get(field);
  const addButton = useRef<HTMLButtonElement>(null);
  const controls = useRef(new Map<string, HTMLElement>());
  const [focus, setFocus] = useState<FocusTarget>();

  // A row's controls move with it, but a moved or removed control loses focus; put it where the editor expects.
  useEffect(() => {
    if (focus === undefined) return;
    setFocus(undefined);
    if (focus === "add") addButton.current?.focus();
    else controls.current.get(`${focus.key}:${focus.control}`)?.focus();
  }, [focus]);

  function control(key: number, name: string) {
    return (element: HTMLElement | null) => {
      if (element === null) controls.current.delete(`${key}:${name}`);
      else controls.current.set(`${key}:${name}`, element);
    };
  }

  function add() {
    const entry = newEntry();
    onChange([...entries, entry]);
    setFocus({ key: entry.key, control: "text" });
  }

  function remove(index: number) {
    const next = entries[index + 1] ?? entries[index - 1];
    onChange(entries.filter((_, i) => i !== index));
    setFocus(next === undefined ? "add" : { key: next.key, control: "text" });
  }

  function move(index: number, to: number) {
    const entry = entries[index];
    if (entry === undefined || to < 0 || to >= entries.length) return;
    onChange(moved(entries, index, to));
    // Stay on the same button, unless the row has reached the end it was moving towards and that button is now disabled.
    const atEnd = to === 0 || to === entries.length - 1;
    const control = to < index ? (atEnd ? "down" : "up") : atEnd ? "up" : "down";
    setFocus({ key: entry.key, control });
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
                  ref={control(entry.key, "text")}
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
              <div className="entry-controls">
                <button
                  ref={control(entry.key, "up")}
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${noun.one} ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 15l6-6 6 6" />
                  </svg>
                </button>
                <button
                  ref={control(entry.key, "down")}
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${noun.one} ${index + 1} down`}
                  disabled={index === entries.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                <button type="button" className="icon-button" aria-label={`Remove ${noun.one} ${index + 1}`} onClick={() => remove(index)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
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
