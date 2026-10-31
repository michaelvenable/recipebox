import { domainError } from "./errors.js";
import { fail, ok, type Result } from "./result.js";

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 1440;

/** Total time: whole minutes, 1–1440 (REC-1). */
export class Minutes {
  private constructor(private readonly minutes: number) {
    Object.freeze(this);
  }

  static create(raw: number): Result<Minutes> {
    if (!Number.isInteger(raw)) {
      return fail(
        domainError("totalTime.notWhole", "Total time must be a whole number of minutes.", "totalTimeMinutes"),
      );
    }
    if (raw < MIN_MINUTES || raw > MAX_MINUTES) {
      return fail(
        domainError(
          "totalTime.outOfRange",
          `Total time must be between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`,
          "totalTimeMinutes",
        ),
      );
    }
    return ok(new Minutes(raw));
  }

  get value(): number {
    return this.minutes;
  }

  equals(other: Minutes): boolean {
    return this.minutes === other.minutes;
  }
}
