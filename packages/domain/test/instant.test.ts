import { describe, expect, it } from "vitest";
import { Instant } from "../src/index.js";
import { errorKeys, valueOf } from "./helpers.js";

const iso = (text: string) => valueOf(Instant.fromIso(text));

describe("X-12 Instant", () => {
  it("parses ISO 8601 in UTC and formats it back", () => {
    expect(iso("2026-10-01T09:30:00Z").toIso()).toBe("2026-10-01T09:30:00.000Z");
    expect(iso("2026-10-01T09:30:00.123Z").toIso()).toBe("2026-10-01T09:30:00.123Z");
    expect(iso("2026-10-01T09:30Z").toIso()).toBe("2026-10-01T09:30:00.000Z");
  });

  it("converts an offset to UTC", () => {
    expect(iso("2026-10-01T11:30:00+02:00").toIso()).toBe("2026-10-01T09:30:00.000Z");
    expect(iso("2026-10-01T04:30:00-05:00").toIso()).toBe("2026-10-01T09:30:00.000Z");
  });

  it("round-trips through epoch milliseconds", () => {
    const ms = Date.UTC(2026, 9, 1, 9, 30);
    const fromMs = valueOf(Instant.fromEpochMillis(ms));
    expect(fromMs.epochMillis).toBe(ms);
    expect(fromMs.equals(iso("2026-10-01T09:30:00Z"))).toBe(true);
  });

  it.each([
    "",
    "not a date",
    "2026-10-01", // date only: no time
    "2026-10-01T09:30:00", // no offset: would depend on the parser's local time zone
    "2026-13-01T00:00:00Z",
    "2026-02-29T00:00:00Z", // 2026 is not a leap year
    "2026-04-31T00:00:00Z",
    "2026-10-01T24:00:00Z",
    "2026-10-01T09:60:00Z",
    "Thu, 01 Oct 2026 09:30:00 GMT",
  ])("rejects %j", (text) => {
    expect(errorKeys(Instant.fromIso(text))).toEqual([{ code: "instant.invalid", field: undefined }]);
  });

  it("accepts 29 February in a leap year", () => {
    expect(iso("2028-02-29T00:00:00Z").toIso()).toBe("2028-02-29T00:00:00.000Z");
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 8.64e15 + 1])("rejects epoch milliseconds %d", (ms) => {
    expect(Instant.fromEpochMillis(ms).ok).toBe(false);
  });

  it("compares and orders", () => {
    const earlier = iso("2026-10-01T00:00:00Z");
    const later = iso("2026-10-21T00:00:00Z");
    expect(earlier.isBefore(later)).toBe(true);
    expect(later.isBefore(earlier)).toBe(false);
    expect(earlier.isBefore(earlier)).toBe(false);
    expect(Instant.compare(earlier, later)).toBeLessThan(0);
    expect(Instant.compare(later, earlier)).toBeGreaterThan(0);
    expect(Instant.compare(earlier, iso("2026-10-01T00:00:00.000Z"))).toBe(0);
  });

  it("adds whole days of 24 hours", () => {
    expect(iso("2026-10-01T09:30:00Z").plusDays(30).toIso()).toBe("2026-10-31T09:30:00.000Z");
    expect(iso("2026-10-01T09:30:00Z").plusDays(-1).toIso()).toBe("2026-09-30T09:30:00.000Z");
    expect(iso("2026-10-01T09:30:00Z").plusDays(0).toIso()).toBe("2026-10-01T09:30:00.000Z");
  });

  it("plusDays with a fractional number of days is a programmer error", () => {
    expect(() => iso("2026-10-01T09:30:00Z").plusDays(1.5)).toThrow(RangeError);
  });

  it("has no way to read the clock", () => {
    expect("now" in Instant).toBe(false);
  });
});
