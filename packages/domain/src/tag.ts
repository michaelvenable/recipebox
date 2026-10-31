import { domainError } from "./errors.js";
import { fail, ok, type Result } from "./result.js";
import { characterCount, compareText } from "./text.js";

export const MAX_TAG_LENGTH = 30;

/** A tag: trimmed and lowercased, 1–30 characters; equal tags have equal text (REC-11). */
export class Tag {
  private constructor(private readonly text: string) {
    Object.freeze(this);
  }

  static create(raw: string): Result<Tag> {
    // REC-11: the length limit applies to the stored text, after NFC, trimming and lowercasing. NFC makes a "café" typed
    // with a precomposed "é" and one typed as "e" + combining accent the same tag (domain-model.md).
    const text = raw.normalize("NFC").trim().toLowerCase();
    if (text.length === 0) {
      return fail(domainError("tag.required", "A tag can't be empty.", "tag"));
    }
    if (characterCount(text) > MAX_TAG_LENGTH) {
      return fail(domainError("tag.tooLong", `A tag must be at most ${MAX_TAG_LENGTH} characters.`, "tag"));
    }
    return ok(new Tag(text));
  }

  /** Alphabetical order, ignoring accents (REC-11, X-13). */
  static compare(a: Tag, b: Tag): number {
    return compareText(a.text, b.text);
  }

  get value(): string {
    return this.text;
  }

  equals(other: Tag): boolean {
    return this.text === other.text;
  }

  toString(): string {
    return this.text;
  }
}
