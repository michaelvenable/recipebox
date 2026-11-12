import { type FormEvent, useId, useRef, useState } from "react";
import type { EditorRecipe } from "@recipebox/shared";
import { formatDate } from "./dates.js";
import { focusIsUnclaimed } from "./focus.js";
import { useNoteChange } from "./note-changes.js";
import { changeErrorMessage } from "./recipe-changes.js";

/**
 * The recipe's notes (REC-25): newest first, as the server sends them, each with its text and the date it was added in the
 * device's time zone (X-12), and a way to add one. Without notes, only the way to add one. Editors only: the server sends
 * visitors no notes at all (X-1). Text rules (trimming, 1 to 1,000 characters, at most 50) are the server's; its messages are
 * shown as they come.
 */
export function RecipeNotes({ recipe }: { recipe: EditorRecipe }) {
  const { mutation, busy } = useNoteChange(recipe.id);
  const [text, setText] = useState("");
  const textArea = useRef<HTMLTextAreaElement>(null);
  const textId = useId();
  const listId = useId();
  const notes = recipe.notes ?? [];

  function onAdd(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    mutation.mutate({ kind: "addNote", text }, { onSuccess: () => setText("") });
  }

  // No confirmation (REC-25). The deleted note's button goes with it, so focus moves to the note box rather than to the page.
  function onDelete(noteId: string, pressed: Element) {
    if (busy) return;
    mutation.mutate(
      { kind: "deleteNote", noteId },
      { onSuccess: () => (focusIsUnclaimed(pressed) ? textArea.current?.focus() : undefined) },
    );
  }

  return (
    <section className="recipe-section recipe-notes" aria-labelledby="notes-heading">
      <div className="section-header">
        <h2 id="notes-heading">Notes</h2>
      </div>
      <form className="note-form" onSubmit={onAdd}>
        <label htmlFor={textId} className="visually-hidden">
          New note
        </label>
        <textarea
          ref={textArea}
          id={textId}
          className="text-input text-area"
          rows={2}
          placeholder="Add a note, such as what to change next time"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="button button-small" disabled={busy}>
          Add note
        </button>
      </form>
      {mutation.isError && (
        <p className="form-error" role="alert">
          {changeErrorMessage(mutation.error)}
        </p>
      )}
      {notes.length > 0 && (
        <ul className="notes" aria-label="Notes">
          {notes.map((note) => {
            const date = formatDate(note.addedAt);
            const noteTextId = `${listId}-${note.id}`;
            return (
              <li key={note.id} className="note">
                <p id={noteTextId} className="note-text">
                  {note.text}
                </p>
                <p className="note-meta">
                  <time dateTime={note.addedAt}>{date}</time>
                  <button
                    type="button"
                    className="link-button note-delete"
                    aria-label={`Delete note from ${date}`}
                    aria-describedby={noteTextId}
                    disabled={busy}
                    onClick={(event) => onDelete(note.id, event.currentTarget)}
                  >
                    Delete
                  </button>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
