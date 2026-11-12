import { domainError } from "./errors.js";
import type { Instant } from "./instant.js";
import { fail, ok, type Result } from "./result.js";
import { characterCount } from "./text.js";

export const MAX_NOTE_LENGTH = 1000;
/** At most this many notes per recipe (REC-25). */
export const MAX_NOTES = 50;

// Canonical 8-4-4-4-12 hex form, accepted in either case and stored in lowercase, as for RecipeId.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A note's id: UUID, stored in lowercase; created outside the domain so tests can control it, like `RecipeId`. */
export class NoteId {
  private constructor(private readonly text: string) {
    Object.freeze(this);
  }

  static create(raw: string): Result<NoteId> {
    if (!UUID.test(raw)) {
      return fail(domainError("noteId.invalid", "A note ID must be a UUID.", "id"));
    }
    return ok(new NoteId(raw.toLowerCase()));
  }

  get value(): string {
    return this.text;
  }

  equals(other: NoteId): boolean {
    return this.text === other.text;
  }

  toString(): string {
    return this.text;
  }
}

/** A note's text (REC-25): trimmed, 1–1,000 characters as counted by X-13; may have several lines. */
export class NoteText {
  private constructor(private readonly text: string) {
    Object.freeze(this);
  }

  static create(raw: string): Result<NoteText> {
    const text = raw.normalize("NFC").trim(); // stored text is NFC (domain-model.md); trimmed per REC-25
    if (text.length === 0) {
      return fail(domainError("note.required", "A note can't be empty.", "text"));
    }
    if (characterCount(text) > MAX_NOTE_LENGTH) {
      return fail(domainError("note.tooLong", `A note must be at most ${MAX_NOTE_LENGTH} characters.`, "text"));
    }
    return ok(new NoteText(text));
  }

  get value(): string {
    return this.text;
  }

  equals(other: NoteText): boolean {
    return this.text === other.text;
  }

  toString(): string {
    return this.text;
  }
}

/**
 * One note on a recipe (REC-25): its text and when it was added, by the server's clock (X-12). Who added it isn't recorded.
 * Immutable: notes can't be edited, only deleted.
 */
export class Note {
  constructor(
    readonly id: NoteId,
    readonly text: NoteText,
    readonly addedAt: Instant,
  ) {
    Object.freeze(this);
  }
}
