import { domainError } from "./errors.js";
import { fail, ok, type Result } from "./result.js";

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
// The range a JavaScript Date can represent.
const MAX_EPOCH_MS = 8.64e15;

// Full date and time with an explicit offset. A time without an offset would be read in the
// local time zone of whatever machine parses it, so it is not a point in time (X-12).
const ISO_8601 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;

/**
 * A point in time, in UTC (X-12). Always passed in from the server's clock; the domain never reads
 * the clock, so there is deliberately no `now()`.
 */
export class Instant {
  private constructor(private readonly epochMs: number) {
    Object.freeze(this);
  }

  static fromEpochMillis(ms: number): Result<Instant> {
    if (!Number.isInteger(ms) || Math.abs(ms) > MAX_EPOCH_MS) {
      return fail(domainError("instant.invalid", "Not a valid point in time."));
    }
    return ok(new Instant(ms));
  }

  /** Parses an ISO 8601 date-time with `Z` or a `±hh:mm` offset, e.g. "2026-10-01T09:30:00Z". */
  static fromIso(text: string): Result<Instant> {
    const invalid = fail<Instant>(domainError("instant.invalid", "Not a valid ISO 8601 date and time."));
    const m = ISO_8601.exec(text);
    if (m === null) {
      return invalid;
    }
    const [, y, mo, d, h, mi, s, frac, zulu, sign, oh, om] = m;
    const year = Number(y);
    const month = Number(mo);
    const day = Number(d);
    const hour = Number(h);
    const minute = Number(mi);
    const second = s === undefined ? 0 : Number(s);
    const millis = frac === undefined ? 0 : Number(frac.slice(0, 3).padEnd(3, "0"));
    const offsetHours = zulu === undefined ? Number(oh) : 0;
    const offsetMinutes = zulu === undefined ? Number(om) : 0;

    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > daysInMonth(year, month) ||
      hour > 23 ||
      minute > 59 ||
      second > 59 ||
      offsetHours > 23 ||
      offsetMinutes > 59
    ) {
      return invalid;
    }

    // setUTCFullYear rather than Date.UTC, which maps years 0–99 to 1900–1999.
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, millis);
    const offsetMs = (offsetHours * 60 + offsetMinutes) * 60 * 1000 * (sign === "-" ? -1 : 1);
    return Instant.fromEpochMillis(date.getTime() - offsetMs);
  }

  static compare(a: Instant, b: Instant): number {
    return a.epochMs - b.epochMs;
  }

  get epochMillis(): number {
    return this.epochMs;
  }

  /** ISO 8601 in UTC with milliseconds, e.g. "2026-10-01T09:30:00.000Z". */
  toIso(): string {
    return new Date(this.epochMs).toISOString();
  }

  isBefore(other: Instant): boolean {
    return this.epochMs < other.epochMs;
  }

  equals(other: Instant): boolean {
    return this.epochMs === other.epochMs;
  }

  /** Adds whole 24-hour days. UTC has no daylight saving, so every day is exactly 24 hours. */
  plusDays(days: number): Instant {
    if (!Number.isInteger(days)) {
      throw new RangeError(`plusDays needs a whole number of days, got ${days}`);
    }
    const result = Instant.fromEpochMillis(this.epochMs + days * MS_PER_DAY);
    if (!result.ok) {
      throw new RangeError(`plusDays(${days}) is outside the representable range`);
    }
    return result.value;
  }

  /** Adds whole minutes. */
  plusMinutes(minutes: number): Instant {
    if (!Number.isInteger(minutes)) {
      throw new RangeError(`plusMinutes needs a whole number of minutes, got ${minutes}`);
    }
    const result = Instant.fromEpochMillis(this.epochMs + minutes * MS_PER_MINUTE);
    if (!result.ok) {
      throw new RangeError(`plusMinutes(${minutes}) is outside the representable range`);
    }
    return result.value;
  }

  toString(): string {
    return this.toIso();
  }
}

function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}
