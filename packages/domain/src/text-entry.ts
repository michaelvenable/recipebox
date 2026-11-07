import { domainError } from "./errors.js";
import { fail, ok, type Result } from "./result.js";
import { characterCount } from "./text.js";

export const MAX_ENTRY_LENGTH = 1000;

/** One ingredient, prep entry or step: trimmed, 1–1,000 characters as counted by X-13 (REC-1, REC-2, REC-20). */
export class TextEntry {
  private constructor(private readonly text: string) {
    Object.freeze(this);
  }

  static create(raw: string): Result<TextEntry> {
    const text = raw.normalize("NFC").trim(); // stored text is NFC (domain-model.md); trimmed per REC-2
    if (text.length === 0) {
      return fail(domainError("entry.required", "An entry can't be empty."));
    }
    if (characterCount(text) > MAX_ENTRY_LENGTH) {
      return fail(domainError("entry.tooLong", `An entry must be at most ${MAX_ENTRY_LENGTH} characters.`));
    }
    return ok(new TextEntry(text));
  }

  get value(): string {
    return this.text;
  }

  equals(other: TextEntry): boolean {
    return this.text === other.text;
  }

  toString(): string {
    return this.text;
  }
}
