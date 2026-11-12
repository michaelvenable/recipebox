import { domainError } from "./errors.js";
import { fail, ok, type Result } from "./result.js";

export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 100;

/** How many people a recipe serves: a whole number, 1–100 (REC-24). */
export class Servings {
  private constructor(private readonly count: number) {
    Object.freeze(this);
  }

  static create(raw: number): Result<Servings> {
    if (!Number.isInteger(raw)) {
      return fail(domainError("servings.notWhole", "Servings must be a whole number.", "servings"));
    }
    if (raw < MIN_SERVINGS || raw > MAX_SERVINGS) {
      return fail(
        domainError("servings.outOfRange", `Servings must be between ${MIN_SERVINGS} and ${MAX_SERVINGS}.`, "servings"),
      );
    }
    return ok(new Servings(raw));
  }

  get value(): number {
    return this.count;
  }

  equals(other: Servings): boolean {
    return this.count === other.count;
  }
}
