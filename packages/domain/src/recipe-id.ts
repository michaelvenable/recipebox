import { domainError } from "./errors.js";
import { fail, ok, type Result } from "./result.js";

// Canonical 8-4-4-4-12 hex form, accepted in either case and stored in lowercase (domain-model.md).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID, stored in lowercase; created outside the domain so tests can control it. */
export class RecipeId {
  private constructor(private readonly text: string) {
    Object.freeze(this);
  }

  static create(raw: string): Result<RecipeId> {
    if (raw.trim().length === 0) {
      return fail(domainError("id.required", "A recipe ID is required.", "id"));
    }
    if (!UUID.test(raw)) {
      return fail(domainError("id.invalid", "A recipe ID must be a UUID.", "id"));
    }
    return ok(new RecipeId(raw.toLowerCase()));
  }

  get value(): string {
    return this.text;
  }

  equals(other: RecipeId): boolean {
    return this.text === other.text;
  }

  toString(): string {
    return this.text;
  }
}
