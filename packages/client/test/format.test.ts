import { describe, expect, it } from "vitest";
import { filterQuery } from "../src/api/recipes.js";
import { describeResults, formatTotalTime, isFiltering, recipeMeta } from "../src/recipes/format.js";
import { filterFromSearch } from "../src/recipes/list-filter.js";

describe("REC-8 total time", () => {
  it.each([
    [1, "1 min"],
    [30, "30 min"],
    [59, "59 min"],
    [60, "1 h"],
    [65, "1 h 5 min"],
    [150, "2 h 30 min"],
    [1440, "24 h"],
  ])("shows %i minutes as %s", (minutes, text) => {
    expect(formatTotalTime(minutes)).toBe(text);
  });

  it("joins the time and tags, leaving out what a recipe doesn't have", () => {
    expect(recipeMeta({ totalTimeMinutes: 35, tags: ["curry", "dinner"] })).toBe("35 min · curry, dinner");
    expect(recipeMeta({ tags: ["curry"] })).toBe("curry");
    expect(recipeMeta({ totalTimeMinutes: 35, tags: [] })).toBe("35 min");
    expect(recipeMeta({ tags: [] })).toBe("");
  });
});

describe("REC-9, REC-13 result descriptions", () => {
  it.each([
    [18, { name: "", tags: ["dinner"] }, "18 recipes tagged dinner"],
    [1, { name: "", tags: ["dinner", "quick"] }, "1 recipe tagged dinner and quick"],
    [0, { name: "", tags: ["dinner", "quick", "slow"] }, "No recipes tagged dinner, quick, and slow"],
    [3, { name: " chick ", tags: [] }, "3 recipes match “chick”"],
    [1, { name: "chick", tags: [] }, "1 recipe matches “chick”"],
    [0, { name: "zzz", tags: [] }, "No recipes match “zzz”"],
    [0, { name: "b", tags: ["dinner"] }, "No recipes match “b” with the tag dinner"],
    [2, { name: "b", tags: ["dinner", "quick"] }, "2 recipes match “b” with the tags dinner and quick"],
  ])("describes %i results for %j as %s", (count, filter, text) => {
    expect(describeResults(count, filter)).toBe(text);
  });

  it("treats an empty or blank term with no tags as showing every recipe", () => {
    expect(isFiltering({ name: "", tags: [] })).toBe(false);
    expect(isFiltering({ name: "   ", tags: [] })).toBe(false);
    expect(isFiltering({ name: "a", tags: [] })).toBe(true);
    expect(isFiltering({ name: "", tags: ["dinner"] })).toBe(true);
  });
});

describe("REC-9, REC-13 filter in the address", () => {
  it("writes the term and tags, commas between tags kept readable", () => {
    expect(filterQuery({ name: "", tags: [] })).toBe("");
    expect(filterQuery({ name: "crème brûlée", tags: [] })).toBe("?name=cr%C3%A8me%20br%C3%BBl%C3%A9e");
    expect(filterQuery({ name: "", tags: ["dinner", "épicé"] })).toBe("?tags=dinner,%C3%A9pic%C3%A9");
    expect(filterQuery({ name: "b", tags: ["dinner"] })).toBe("?name=b&tags=dinner");
  });

  it("reads back what it wrote", () => {
    const filter = { name: "a & b", tags: ["dinner", "épicé"] };
    expect(filterFromSearch(filterQuery(filter))).toEqual(filter);
  });

  it("reads missing, empty and repeated tags sensibly", () => {
    expect(filterFromSearch("")).toEqual({ name: "", tags: [] });
    expect(filterFromSearch("?tags=")).toEqual({ name: "", tags: [] });
    expect(filterFromSearch("?tags=dinner,,dinner,quick")).toEqual({ name: "", tags: ["dinner", "quick"] });
    expect(filterFromSearch("?tags=dinner%2Cquick")).toEqual({ name: "", tags: ["dinner", "quick"] });
  });
});
