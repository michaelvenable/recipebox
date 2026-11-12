import { describe, expect, it } from "vitest";
import { pieSlicePath, stopwatches } from "../src/recipes/time-stopwatches.js";

describe("REC-26 time stopwatches", () => {
  it.each([
    ["spec example: 15 min, one stopwatch a quarter filled", 15, { full: 0, partial: 0.25 }],
    ["spec example: 1 h, one full stopwatch", 60, { full: 1 }],
    ["spec example: 1 h 15 min, one full and one a quarter filled", 75, { full: 1, partial: 0.25 }],
    ["spec example: 2 h 30 min, two full and one half filled", 150, { full: 2, partial: 0.5 }],
    ["spec example: 4 h, four full stopwatches", 240, { full: 4 }],
    ["spec example: 7 h 30 min, one full, ×8", 450, { full: 1, more: 8 }],
    ["1 min, a sliver", 1, { full: 0, partial: 1 / 60 }],
    ["59 min, almost full", 59, { full: 0, partial: 59 / 60 }],
    ["2 h, two full, not an empty third", 120, { full: 2 }],
    ["3 h 59 min, three full and one almost full", 239, { full: 3, partial: 59 / 60 }],
    ["4 h 1 min, over 4 h: one full, ×5 started hours", 241, { full: 1, more: 5 }],
    ["5 h, one full, ×5", 300, { full: 1, more: 5 }],
    ["24 h, the longest time, one full, ×24", 1440, { full: 1, more: 24 }],
  ])("%s", (_what, minutes, shown) => {
    expect(stopwatches(minutes)).toEqual(shown);
  });

  it("spec example: no total time, no stopwatch", () => {
    expect(stopwatches(undefined)).toBeUndefined();
  });

  it.each([
    [0.25, "M12 14V6.5A7.5 7.5 0 0 1 19.5 14Z"],
    [0.5, "M12 14V6.5A7.5 7.5 0 0 1 12 21.5Z"],
    [0.75, "M12 14V6.5A7.5 7.5 0 1 1 4.5 14Z"],
  ])("fills a %s turn clockwise from 12 o'clock", (fraction, path) => {
    expect(pieSlicePath(12, 14, 7.5, fraction)).toBe(path);
  });
});
