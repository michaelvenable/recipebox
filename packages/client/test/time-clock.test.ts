import { describe, expect, it } from "vitest";
import { clockFace, pieSlicePath } from "../src/recipes/time-clock.js";

describe("REC-26 time clock", () => {
  it.each([
    ["spec example: 15 min, a quarter filled, first shade", 15, { partial: { fraction: 0.25, shade: 1 } }],
    ["spec example: 1 h, full, first shade", 60, { full: 1 }],
    ["spec example: 1 h 15 min, full first shade, a quarter in the second", 75, { full: 1, partial: { fraction: 0.25, shade: 2 } }],
    ["spec example: 2 h 30 min, full second shade, half in the third", 150, { full: 2, partial: { fraction: 0.5, shade: 3 } }],
    ["spec example: 6 h, full, darkest shade", 360, { full: 4 }],
    ["1 min, a sliver in the first shade", 1, { partial: { fraction: 1 / 60, shade: 1 } }],
    ["59 min, almost full in the first shade", 59, { partial: { fraction: 59 / 60, shade: 1 } }],
    ["2 h, full in the second shade, not an empty third lap", 120, { full: 2 }],
    ["3 h, full in the third shade", 180, { full: 3 }],
    ["3 h 30 min, the fourth lap in the darkest shade", 210, { full: 3, partial: { fraction: 0.5, shade: 4 } }],
    ["4 h, full in the darkest shade", 240, { full: 4 }],
    ["5 h 45 min, darkest over darkest", 345, { full: 4, partial: { fraction: 0.75, shade: 4 } }],
    ["24 h, the longest time, full in the darkest shade", 1440, { full: 4 }],
  ])("%s", (_what, minutes, face) => {
    expect(clockFace(minutes)).toEqual(face);
  });

  it("spec example: no total time, no clock", () => {
    expect(clockFace(undefined)).toBeUndefined();
  });

  it.each([
    [0.25, "M12 12V2A10 10 0 0 1 22 12Z"],
    [0.5, "M12 12V2A10 10 0 0 1 12 22Z"],
    [0.75, "M12 12V2A10 10 0 1 1 2 12Z"],
  ])("fills a %s turn clockwise from 12 o'clock", (fraction, path) => {
    expect(pieSlicePath(12, 12, 10, fraction)).toBe(path);
  });
});
