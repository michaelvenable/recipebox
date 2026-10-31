import { domainError } from "./errors.js";
import { fail, ok, type Result } from "./result.js";
import { characterCount, compareText, containsText } from "./text.js";

export const MAX_NAME_LENGTH = 200;

/** A recipe name: trimmed, 1–200 characters as counted by X-13 (REC-1, REC-2). */
export class RecipeName {
  private constructor(private readonly text: string) {
    Object.freeze(this);
  }

  static create(raw: string): Result<RecipeName> {
    const text = raw.normalize("NFC").trim(); // stored text is NFC (domain-model.md); trimmed per REC-2
    if (text.length === 0) {
      return fail(domainError("name.required", "Name is required.", "name"));
    }
    if (characterCount(text) > MAX_NAME_LENGTH) {
      return fail(domainError("name.tooLong", `Name must be at most ${MAX_NAME_LENGTH} characters.`, "name"));
    }
    return ok(new RecipeName(text));
  }

  /** Order for the recipe list, ignoring case and accents (REC-8, X-13). */
  static compare(a: RecipeName, b: RecipeName): number {
    return compareText(a.text, b.text);
  }

  /** Search by name (REC-9): the trimmed term anywhere in the name, ignoring case and accents (X-13). Empty matches all. */
  matches(term: string): boolean {
    const needle = term.trim();
    return needle.length === 0 || containsText(this.text, needle);
  }

  get value(): string {
    return this.text;
  }

  equals(other: RecipeName): boolean {
    return this.text === other.text;
  }

  toString(): string {
    return this.text;
  }
}
