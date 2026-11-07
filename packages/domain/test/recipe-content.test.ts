import { describe, expect, it } from "vitest";
import { RecipeContent, type RecipeContentInput } from "../src/index.js";
import { errorKeys, expectEveryErrorHasMessage, valueOf } from "./helpers.js";

const valid: RecipeContentInput = {
  name: "Pad Thai",
  ingredients: ["200 g rice noodles", "2 eggs"],
  steps: ["Soak the noodles.", "Fry everything."],
};

const create = (overrides: Partial<RecipeContentInput>) => RecipeContent.create({ ...valid, ...overrides });
const content = (overrides: Partial<RecipeContentInput>) => valueOf(create(overrides));
const texts = (items: readonly { value: string }[]) => items.map((i) => i.value);
const tagNames = (n: number) => Array.from({ length: n }, (_, i) => `tag${String(i).padStart(2, "0")}`);

describe("REC-1 create", () => {
  it("accepts valid content with only the required fields", () => {
    const c = content({});
    expect(c.name.value).toBe("Pad Thai");
    expect(texts(c.ingredients)).toEqual(["200 g rice noodles", "2 eggs"]);
    expect(texts(c.steps)).toEqual(["Soak the noodles.", "Fry everything."]);
    expect(c.totalTime).toBeUndefined();
    expect(c.tags).toEqual([]);
  });

  it("accepts an optional total time", () => {
    expect(content({ totalTimeMinutes: 45 }).totalTime?.value).toBe(45);
    expect(content({ totalTimeMinutes: undefined }).totalTime).toBeUndefined();
  });

  it("accepts 200-character names and rejects 201", () => {
    expect(create({ name: "x".repeat(200) }).ok).toBe(true);
    expect(errorKeys(create({ name: "x".repeat(201) }))).toEqual([{ code: "name.tooLong", field: "name" }]);
  });

  it("rejects an empty name", () => {
    expect(errorKeys(create({ name: "   " }))).toEqual([{ code: "name.required", field: "name" }]);
  });

  it("rejects no ingredients or no steps", () => {
    expect(errorKeys(create({ ingredients: [] }))).toEqual([{ code: "ingredients.required", field: "ingredients" }]);
    expect(errorKeys(create({ steps: [] }))).toEqual([{ code: "steps.required", field: "steps" }]);
  });

  it.each([0, 2.5])("rejects total time %d", (minutes) => {
    const result = create({ totalTimeMinutes: minutes });
    expect(result.ok).toBe(false);
    expect(errorKeys(result).map((e) => e.field)).toEqual(["totalTimeMinutes"]);
  });

  it("accepts total time 1440 and rejects 1441", () => {
    expect(create({ totalTimeMinutes: 1440 }).ok).toBe(true);
    expect(errorKeys(create({ totalTimeMinutes: 1441 }))).toEqual([
      { code: "totalTime.outOfRange", field: "totalTimeMinutes" },
    ]);
  });

  it("rejects an ingredient of 1,001 characters", () => {
    expect(errorKeys(create({ ingredients: ["2 eggs", "  ", "x".repeat(1001)] }))).toEqual([
      { code: "entry.tooLong", field: "ingredients[2]" },
    ]);
  });

  it("accepts ingredients and steps of 1,000 characters and rejects a step of 1,001", () => {
    const c = content({ ingredients: ["x".repeat(1000)], steps: [` ${"y".repeat(1000)} `] });
    expect(texts(c.ingredients)).toEqual(["x".repeat(1000)]);
    expect(texts(c.steps)).toEqual(["y".repeat(1000)]);
    expect(errorKeys(create({ steps: ["Boil.", "y".repeat(1001)] }))).toEqual([
      { code: "entry.tooLong", field: "steps[1]" },
    ]);
  });

  it("reports a too-long entry, not a missing one, when it is the only entry", () => {
    expect(errorKeys(create({ ingredients: ["x".repeat(1001)] }))).toEqual([
      { code: "entry.tooLong", field: "ingredients[0]" },
    ]);
  });

  it("reports too-long entries alongside other errors", () => {
    const result = RecipeContent.create({
      name: "",
      ingredients: ["x".repeat(1001), "salt", "y".repeat(1001)],
      steps: ["z".repeat(1001)],
      tags: ["a".repeat(31)],
    });
    expect(errorKeys(result)).toEqual([
      { code: "name.required", field: "name" },
      { code: "entry.tooLong", field: "ingredients[0]" },
      { code: "entry.tooLong", field: "ingredients[2]" },
      { code: "entry.tooLong", field: "steps[0]" },
      { code: "tag.tooLong", field: "tags[0]" },
    ]);
    expectEveryErrorHasMessage(result);
  });

  it("reports every invalid field at once", () => {
    const result = RecipeContent.create({
      name: " ",
      ingredients: ["   "],
      steps: [],
      totalTimeMinutes: 0,
      tags: ["ok", "a".repeat(31), "  "],
    });
    expect(errorKeys(result)).toEqual([
      { code: "name.required", field: "name" },
      { code: "ingredients.required", field: "ingredients" },
      { code: "steps.required", field: "steps" },
      { code: "totalTime.outOfRange", field: "totalTimeMinutes" },
      { code: "tag.tooLong", field: "tags[1]" },
      { code: "tag.required", field: "tags[2]" },
    ]);
    expectEveryErrorHasMessage(result);
  });
});

describe("REC-2 entry cleanup", () => {
  it('saves name "  Pad Thai " as "Pad Thai"', () => {
    expect(content({ name: "  Pad Thai " }).name.value).toBe("Pad Thai");
  });

  it('saves ingredients ["2 eggs", "  ", ""] as ["2 eggs"]', () => {
    expect(texts(content({ ingredients: ["2 eggs", "  ", ""] }).ingredients)).toEqual(["2 eggs"]);
  });

  it('rejects ingredients ["   "]: at least 1 ingredient required', () => {
    expect(errorKeys(create({ ingredients: ["   "] }))).toEqual([
      { code: "ingredients.required", field: "ingredients" },
    ]);
  });

  it("discards blank steps and rejects when none remain", () => {
    expect(texts(content({ steps: ["", " Boil. ", "\t"] }).steps)).toEqual(["Boil."]);
    expect(errorKeys(create({ steps: ["", " "] }))).toEqual([{ code: "steps.required", field: "steps" }]);
  });

  it("trims every ingredient and step", () => {
    const c = content({ ingredients: ["  salt ", "pepper\n"], steps: [" Mix.  "] });
    expect(texts(c.ingredients)).toEqual(["salt", "pepper"]);
    expect(texts(c.steps)).toEqual(["Mix."]);
  });
});

describe("REC-3 order is preserved", () => {
  it("keeps ingredients and steps in the order entered, including duplicates", () => {
    const c = content({
      ingredients: ["zucchini", "apple", "  ", "mango", "apple"],
      steps: ["Third? No, first.", "", "Then this.", "Finally."],
    });
    expect(texts(c.ingredients)).toEqual(["zucchini", "apple", "mango", "apple"]);
    expect(texts(c.steps)).toEqual(["Third? No, first.", "Then this.", "Finally."]);
  });

  it("is not affected by later changes to the input arrays", () => {
    const ingredients = ["a", "b"];
    const c = content({ ingredients });
    ingredients.push("c");
    expect(texts(c.ingredients)).toEqual(["a", "b"]);
    expect(Object.isFrozen(c.ingredients)).toBe(true);
  });
});

describe("REC-21 one entry per line", () => {
  it('saves steps typed as "Boil water", two blank lines, "Add pasta" as ["Boil water", "Add pasta"]', () => {
    // The form sends each line as an entry; blank lines are discarded here (REC-2).
    expect(texts(content({ steps: ["Boil water", "", "", "Add pasta"] }).steps)).toEqual(["Boil water", "Add pasta"]);
  });

  it("reports a too-long line by its position among the lines sent, blank ones included", () => {
    expect(errorKeys(create({ steps: ["Boil water", "", "x".repeat(1001)] }))).toEqual([
      { code: "entry.tooLong", field: "steps[2]" },
    ]);
  });
});

describe("REC-20 prep", () => {
  it("is optional: missing or empty prep means none", () => {
    expect(content({}).prep).toEqual([]);
    expect(content({ prep: undefined }).prep).toEqual([]);
    expect(content({ prep: [] }).prep).toEqual([]);
  });

  it("keeps prep entries in the order entered (REC-3)", () => {
    const c = content({ prep: ["Chop the onions.", "Soak the noodles.", "Chop the onions."] });
    expect(texts(c.prep)).toEqual(["Chop the onions.", "Soak the noodles.", "Chop the onions."]);
    expect(Object.isFrozen(c.prep)).toBe(true);
  });

  it("trims every prep entry and discards blank ones (REC-2)", () => {
    expect(texts(content({ prep: ["  Chop. ", "", "\t", " Soak.\n"] }).prep)).toEqual(["Chop.", "Soak."]);
  });

  it("has no 'at least 1' rule: only blank entries leave no prep", () => {
    expect(content({ prep: ["   ", ""] }).prep).toEqual([]);
  });

  it("accepts a prep entry of 1,000 characters and rejects 1,001 with its position", () => {
    expect(texts(content({ prep: ["x".repeat(1000)] }).prep)).toEqual(["x".repeat(1000)]);
    expect(errorKeys(create({ prep: ["Chop.", " ", "x".repeat(1001)] }))).toEqual([
      { code: "entry.tooLong", field: "prep[2]" },
    ]);
  });

  it("reports a too-long prep entry alongside other errors", () => {
    expect(errorKeys(create({ name: "", prep: ["x".repeat(1001)], steps: [] }))).toEqual([
      { code: "name.required", field: "name" },
      { code: "entry.tooLong", field: "prep[0]" },
      { code: "steps.required", field: "steps" },
    ]);
  });
});

describe("REC-11 tag rules", () => {
  it("trims and lowercases tags", () => {
    expect(texts(content({ tags: [" Dinner ", "QUICK"] }).tags)).toEqual(["dinner", "quick"]);
  });

  it('" Quick " with "quick" stays one tag "quick"', () => {
    expect(texts(content({ tags: ["quick", " Quick "] }).tags)).toEqual(["quick"]);
  });

  it("shows tags in alphabetical order", () => {
    expect(texts(content({ tags: ["vegetarian", "dinner", "Quick"] }).tags)).toEqual(["dinner", "quick", "vegetarian"]);
  });

  it('tags "zucchini", "épicé", "apple" are shown as apple, épicé, zucchini (X-13)', () => {
    expect(texts(content({ tags: ["zucchini", "épicé", "apple"] }).tags)).toEqual(["apple", "épicé", "zucchini"]);
  });

  it("keeps tags that differ only in accents as separate tags", () => {
    expect(texts(content({ tags: ["epice", "épicé"] }).tags)).toEqual(["epice", "épicé"]);
  });

  it("a tag typed precomposed and one typed with a combining accent are one tag", () => {
    expect(texts(content({ tags: ["café", "café"] }).tags)).toEqual(["café"]);
  });

  it("accepts 30-character tags and rejects 31 with the tag's index", () => {
    expect(create({ tags: ["a".repeat(30)] }).ok).toBe(true);
    expect(errorKeys(create({ tags: ["ok", "a".repeat(31)] }))).toEqual([{ code: "tag.tooLong", field: "tags[1]" }]);
  });

  it("rejects an empty tag with its index", () => {
    expect(errorKeys(create({ tags: ["dinner", "  "] }))).toEqual([{ code: "tag.required", field: "tags[1]" }]);
  });

  it("accepts 20 tags and rejects 21", () => {
    expect(content({ tags: tagNames(20) }).tags).toHaveLength(20);
    expect(errorKeys(create({ tags: tagNames(21) }))).toEqual([{ code: "tags.tooMany", field: "tags" }]);
  });

  it("counts tags after duplicates collapse", () => {
    const twenty = tagNames(20);
    expect(content({ tags: [...twenty, " TAG00 ", "tag19"] }).tags).toHaveLength(20);
  });
});
