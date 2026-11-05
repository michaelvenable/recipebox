import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatRecentDay,
  isOnLocalDay,
  localDayKey,
  msUntilNextLocalDay,
  trashTimeLeft,
} from "../src/recipes/dates.js";

const HOUR = 3_600_000;

describe("X-12 device time zone in tests", () => {
  it("runs in America/New_York (vitest.config.ts), so local-day tests mean something outside UTC", () => {
    // If the zone were silently ignored, the local-midnight tests would pass in UTC without proving anything.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/New_York");
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(300);
    expect(new Date(2026, 6, 15, 12).getTimezoneOffset()).toBe(240);
  });
});

describe("COOK-8 the device's local day", () => {
  it("tells the local day from the UTC one", () => {
    // 2026-11-05 01:30 UTC is still Nov 4 in New York.
    expect(localDayKey(new Date("2026-11-05T01:30:00Z"))).toBe("2026-11-04");
    expect(isOnLocalDay("2026-11-05T01:30:00Z", "2026-11-04")).toBe(true);
    expect(isOnLocalDay("2026-11-05T05:00:00Z", "2026-11-04")).toBe(false);
  });

  it("finds the next local midnight on an ordinary day", () => {
    expect(msUntilNextLocalDay(new Date(2026, 10, 4, 18, 0))).toBe(6 * HOUR);
  });

  it("finds the next local midnight on a spring-forward day, 23 hours long", () => {
    expect(msUntilNextLocalDay(new Date(2026, 2, 8, 0, 0))).toBe(23 * HOUR);
    expect(msUntilNextLocalDay(new Date(2026, 2, 8, 1, 0))).toBe(22 * HOUR);
  });

  it("finds the next local midnight on a fall-back day, 25 hours long", () => {
    expect(msUntilNextLocalDay(new Date(2026, 10, 1, 0, 0))).toBe(25 * HOUR);
  });
});

describe("COOK-5 history dates", () => {
  it("shows a stored time as a date in the device's time zone", () => {
    expect(formatDate("2026-08-02T03:30:00Z")).toBe("Aug 1, 2026");
  });
});

describe("COOK-5, REC-14 recent days", () => {
  it("says today, the day this year, or the full date before, by the local day", () => {
    // 2026-11-05 01:30 UTC is still Nov 4 in New York.
    expect(formatRecentDay("2026-11-05T01:30:00Z", "2026-11-04")).toBe("today");
    expect(formatRecentDay("2026-10-21T16:00:00Z", "2026-11-04")).toBe("Oct 21");
    expect(formatRecentDay("2025-12-30T16:00:00Z", "2026-01-04")).toBe("Dec 30, 2025");
  });
});

/** A trash entry's times for a recipe deleted at `deletedAt`, due 30 × 24 hours later, as the server sends them (REC-16). */
function deleted(deletedAt: Date): { deletedAt: string; removalDueAt: string } {
  return { deletedAt: deletedAt.toISOString(), removalDueAt: new Date(deletedAt.getTime() + 30 * 24 * HOUR).toISOString() };
}

describe("REC-14 days left in the trash", () => {
  it.each([
    // Spec example: deleted 2026-10-01, today 2026-10-21, whatever the times of day.
    ["deleted Oct 1 noon, Oct 21 noon", new Date(2026, 9, 1, 12), new Date(2026, 9, 21, 12), "10 days left"],
    ["deleted Oct 1 23:30, Oct 21 00:10", new Date(2026, 9, 1, 23, 30), new Date(2026, 9, 21, 0, 10), "10 days left"],
    ["deleted Oct 1 00:30, Oct 21 23:50", new Date(2026, 9, 1, 0, 30), new Date(2026, 9, 21, 23, 50), "10 days left"],
    ["deleted just now", new Date(2026, 9, 21, 9), new Date(2026, 9, 21, 9), "30 days left"],
    ["deleted at 23:59, a minute later", new Date(2026, 9, 21, 23, 59), new Date(2026, 9, 22, 0, 0), "29 days left"],
    ["deleted 29 days ago, 25 hours to go", new Date(2026, 9, 1, 10), new Date(2026, 9, 30, 9), "1 day left"],
    ["deleted 29 days ago, exactly a day to go", new Date(2026, 9, 1, 10), new Date(2026, 9, 30, 10), "1 day left"],
    ["deleted 29 days ago, a minute under a day to go", new Date(2026, 9, 1, 10), new Date(2026, 9, 30, 10, 1), "less than a day left"],
    ["due in a minute", new Date(2026, 9, 1, 10), new Date(2026, 9, 31, 9, 59), "less than a day left"],
    ["due now", new Date(2026, 9, 1, 10), new Date(2026, 9, 31, 10), "removed soon"],
    ["due a day ago, not yet removed", new Date(2026, 9, 1, 10), new Date(2026, 10, 1, 10), "removed soon"],
  ])("%s: %s", (_case, deletedAt, now, label) => {
    expect(trashTimeLeft(deleted(deletedAt), now)).toBe(label);
  });

  it("counts calendar days across the end of daylight saving time (Nov 1, 2026)", () => {
    // Deleted Oct 15 at 23:30 EDT; due Nov 14 at 22:30 EST.
    const entry = deleted(new Date(2026, 9, 15, 23, 30));
    expect(trashTimeLeft(entry, new Date(2026, 9, 15, 23, 45))).toBe("30 days left");
    expect(trashTimeLeft(entry, new Date(2026, 10, 2, 0, 5))).toBe("12 days left");
    expect(trashTimeLeft(entry, new Date(2026, 10, 13, 22, 0))).toBe("1 day left");
    expect(trashTimeLeft(entry, new Date(2026, 10, 14, 8, 0))).toBe("less than a day left");
  });

  it("starts at 30 for a deletion just after midnight before daylight saving time ends, and follows the spec pattern", () => {
    // Deleted Oct 15 at 00:30 EDT; 720 hours later is Nov 13 at 23:30 EST, the day before the calendar's 30th day.
    const entry = deleted(new Date(2026, 9, 15, 0, 30));
    expect(trashTimeLeft(entry, new Date(2026, 9, 15, 0, 35))).toBe("30 days left");
    // Like deleted Oct 1, today Oct 21: 20 days on, 10 left.
    expect(trashTimeLeft(entry, new Date(2026, 10, 4, 12, 0))).toBe("10 days left");
  });

  it("starts at 30, not 31, for a deletion just before midnight before daylight saving time starts (Mar 14, 2027)", () => {
    // Deleted Mar 1, 2027 at 23:30 EST; 720 hours later is Apr 1 at 00:30 EDT, on the calendar's 31st day.
    const entry = deleted(new Date(2027, 2, 1, 23, 30));
    expect(trashTimeLeft(entry, new Date(2027, 2, 1, 23, 35))).toBe("30 days left");
    expect(trashTimeLeft(entry, new Date(2027, 2, 21, 12, 0))).toBe("10 days left");
  });

  it("never says more than 30 days when the device's clock is behind the server's", () => {
    // Deleted at 00:10 by the server's clock; the device still thinks it is the evening before.
    const entry = deleted(new Date(2026, 9, 21, 0, 10));
    expect(trashTimeLeft(entry, new Date(2026, 9, 20, 23, 0))).toBe("30 days left");
  });

  it("says at least 1 day while more than a day is left", () => {
    // Not a pair the server sends; it shows the count never reaches 0 before the last 24 hours.
    const entry = { deletedAt: new Date(2026, 9, 1, 10).toISOString(), removalDueAt: new Date(2026, 10, 3, 10).toISOString() };
    expect(trashTimeLeft(entry, new Date(2026, 9, 31, 12))).toBe("1 day left");
  });
});
