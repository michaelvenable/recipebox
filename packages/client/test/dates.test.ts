import { describe, expect, it } from "vitest";
import { formatDate, isOnLocalDay, localDayKey, msUntilNextLocalDay } from "../src/recipes/dates.js";

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
