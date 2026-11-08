import { describe, expect, it } from "vitest";
import {
  IMPORT_MINUTES,
  ImportId,
  importedRecipe,
  Instant,
  Recipe,
  RecipeId,
  RecipeImport,
  Tag,
  type ReadRecipe,
  type RecipeImportSnapshot,
} from "../src/index.js";
import { errorKeys, errorsOf, valueOf } from "./helpers.js";

const at = (iso: string) => valueOf(Instant.fromIso(iso));
const IMPORT_ID = "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a5b";
const RECIPE_ID = "0f8e7d6c-5b4a-4321-9876-543210fedcba";
const importId = (raw = IMPORT_ID) => valueOf(ImportId.create(raw));
const recipeId = (raw = RECIPE_ID) => valueOf(RecipeId.create(raw));
const tags = (...texts: string[]) => texts.map((t) => valueOf(Tag.create(t)));

const STARTED = "2026-11-07T09:00:00Z";
const started = (iso = STARTED) => RecipeImport.start(importId(), at(iso));
/** When the recipe is added to the collection (IMP-10), by the server's clock (X-12). */
const ADDED = at("2026-11-07T09:02:00Z");

function bananaBread(): ReadRecipe {
  return {
    name: "Banana Bread",
    ingredients: ["3 ripe bananas", "1/3 cup melted butter", "1 cup sugar"],
    prep: [],
    steps: ["Mash the bananas.", "Mix everything.", "Bake for 60 minutes."],
    totalTimeMinutes: 75,
    tags: [],
  };
}

function aRecipe(name = "Banana Bread"): Recipe {
  return valueOf(Recipe.create(recipeId(), { name, ingredients: ["Something"], steps: ["Cook it."] }, ADDED));
}

describe("IMP-1 import id", () => {
  it("accepts a UUID and stores it in lowercase, like a recipe id", () => {
    expect(importId("6F1C2B9E-3D4A-4E5F-8A7B-0C1D2E3F4A5B").value).toBe(IMPORT_ID);
  });

  it.each([
    ["empty", "", "importId.required"],
    ["blank", "   ", "importId.required"],
    ["not a UUID", "current", "importId.invalid"],
    ["a UUID with spaces", ` ${IMPORT_ID} `, "importId.invalid"],
  ])("refuses an id that is %s", (_why, raw, code) => {
    expect(errorKeys(ImportId.create(raw))).toEqual([{ code, field: "importId" }]);
  });
});

describe("IMP-5 an import is in progress while it is reading", () => {
  it("is reading as soon as it starts", () => {
    const imp = started();
    expect(imp.id.value).toBe(IMPORT_ID);
    expect(imp.startedAt.toIso()).toBe("2026-11-07T09:00:00.000Z");
    expect(imp.statusAt(at(STARTED))).toBe("reading");
    expect(imp.isInProgress(at(STARTED))).toBe(true);
    expect(imp.recipeId).toBeUndefined();
    expect(imp.recipeName).toBeUndefined();
  });

  it("is no longer in progress once it has succeeded", () => {
    const imp = started();
    valueOf(imp.succeed(aRecipe(), at("2026-11-07T09:01:00Z")));
    expect(imp.statusAt(at("2026-11-07T09:01:00Z"))).toBe("done");
    expect(imp.isInProgress(at("2026-11-07T09:01:00Z"))).toBe(false);
  });

  it("is no longer in progress once it has failed (IMP-11)", () => {
    const imp = started();
    imp.fail();
    expect(imp.statusAt(at("2026-11-07T09:01:00Z"))).toBe("failed");
    expect(imp.isInProgress(at("2026-11-07T09:01:00Z"))).toBe(false);
  });
});

describe("IMP-11 an import unfinished 10 minutes after the upload has failed (X-12)", () => {
  it("the limit is 10 minutes", () => {
    expect(IMPORT_MINUTES).toBe(10);
  });

  it("spec example: started 09:00:00, in progress at 09:09:59, not at 09:10:00", () => {
    const imp = started("2026-11-07T09:00:00Z");
    expect(imp.isInProgress(at("2026-11-07T09:09:59Z"))).toBe(true);
    expect(imp.isInProgress(at("2026-11-07T09:09:59.999Z"))).toBe(true);
    expect(imp.statusAt(at("2026-11-07T09:09:59Z"))).toBe("reading");
    expect(imp.isInProgress(at("2026-11-07T09:10:00Z"))).toBe(false);
    expect(imp.statusAt(at("2026-11-07T09:10:00Z"))).toBe("failed");
    expect(imp.statusAt(at("2026-11-07T10:00:00Z"))).toBe("failed");
  });

  it("a finished import keeps its status after the 10 minutes", () => {
    const imp = started();
    valueOf(imp.succeed(aRecipe(), at("2026-11-07T09:05:00Z")));
    expect(imp.statusAt(at("2026-11-07T12:00:00Z"))).toBe("done");
  });

  it("succeed at 09:09:59 adds the recipe", () => {
    const imp = started();
    valueOf(imp.succeed(aRecipe(), at("2026-11-07T09:09:59Z")));
    expect(imp.recipeId?.value).toBe(RECIPE_ID);
  });

  it("spec example: succeed at 09:10:00 fails with import.timedOut, so nothing is added", () => {
    const imp = started();
    expect(errorKeys(imp.succeed(aRecipe(), at("2026-11-07T09:10:00Z")))).toEqual([
      { code: "import.timedOut", field: undefined },
    ]);
    expect(imp.recipeId).toBeUndefined();
    expect(imp.recipeName).toBeUndefined();
    expect(imp.statusAt(at("2026-11-07T09:10:00Z"))).toBe("failed");
  });

  it("a timed-out import can still be marked failed, and is then failed whatever the time", () => {
    const imp = started();
    imp.fail();
    expect(imp.statusAt(at("2026-11-07T09:00:00Z"))).toBe("failed");
    expect(imp.toSnapshot().status).toBe("failed");
  });
});

describe("IMP-10 / IMP-11 a finished import doesn't change again", () => {
  it("succeed keeps the recipe's id and name", () => {
    const imp = started();
    valueOf(imp.succeed(aRecipe("Pad Thai"), at("2026-11-07T09:02:00Z")));
    expect(imp.recipeId?.value).toBe(RECIPE_ID);
    expect(imp.recipeName?.value).toBe("Pad Thai");
  });

  it("succeed on a done import fails with import.finished and keeps the first recipe", () => {
    const imp = started();
    valueOf(imp.succeed(aRecipe("Pad Thai"), at("2026-11-07T09:02:00Z")));
    const other = valueOf(
      Recipe.create(
        recipeId("11111111-2222-4333-8444-555555555555"),
        { name: "Chili", ingredients: ["Beans"], steps: ["Cook."] },
        ADDED,
      ),
    );
    expect(errorKeys(imp.succeed(other, at("2026-11-07T09:03:00Z")))).toEqual([
      { code: "import.finished", field: undefined },
    ]);
    expect(imp.recipeId?.value).toBe(RECIPE_ID);
    expect(imp.recipeName?.value).toBe("Pad Thai");
  });

  it("succeed on a failed import fails with import.finished", () => {
    const imp = started();
    imp.fail();
    expect(errorKeys(imp.succeed(aRecipe(), at("2026-11-07T09:02:00Z")))).toEqual([
      { code: "import.finished", field: undefined },
    ]);
    expect(imp.statusAt(at("2026-11-07T09:02:00Z"))).toBe("failed");
    expect(imp.recipeId).toBeUndefined();
  });

  it("fail on a done import does nothing", () => {
    const imp = started();
    valueOf(imp.succeed(aRecipe(), at("2026-11-07T09:02:00Z")));
    imp.fail();
    expect(imp.statusAt(at("2026-11-07T09:02:00Z"))).toBe("done");
    expect(imp.recipeName?.value).toBe("Banana Bread");
  });

  it("fail on a failed import does nothing", () => {
    const imp = started();
    imp.fail();
    imp.fail();
    expect(imp.statusAt(at("2026-11-07T09:02:00Z"))).toBe("failed");
  });
});

describe("IMP-7 saved like any other recipe", () => {
  it("spec example: a banana bread card becomes the recipe as read", () => {
    const r = valueOf(importedRecipe(recipeId(), bananaBread(), [], ADDED));
    expect(r.id.value).toBe(RECIPE_ID);
    expect(r.content.name.value).toBe("Banana Bread");
    expect(r.content.steps.map((s) => s.value)).toEqual(["Mash the bananas.", "Mix everything.", "Bake for 60 minutes."]);
    expect(r.content.prep).toEqual([]);
    expect(r.photo).toBeUndefined();
    expect(r.isOnMakeList).toBe(false);
    expect(r.timesCooked).toBe(0);
  });

  it('spec example: "1/3 cup melted butter" is kept as written, in the page\'s order (REC-3)', () => {
    const r = valueOf(importedRecipe(recipeId(), bananaBread(), [], ADDED));
    expect(r.content.ingredients.map((e) => e.value)).toEqual(["3 ripe bananas", "1/3 cup melted butter", "1 cup sugar"]);
  });

  it('spec example: "Prep 15 min, Bake 60 min" read as 75 minutes gives a total time of 1 h 15 min', () => {
    expect(valueOf(importedRecipe(recipeId(), bananaBread(), [], ADDED)).content.totalTime?.value).toBe(75);
  });

  it("spec example: a card that states no times has no total time", () => {
    const { totalTimeMinutes: _, ...read } = bananaBread();
    expect(valueOf(importedRecipe(recipeId(), read, [], ADDED)).content.totalTime).toBeUndefined();
  });

  it("keeps prep when the page lists it separately (REC-20)", () => {
    const r = valueOf(importedRecipe(recipeId(), { ...bananaBread(), prep: ["Grease the pan."] }, [], ADDED));
    expect(r.content.prep.map((e) => e.value)).toEqual(["Grease the pan."]);
  });

  it("is cleaned up like a typed recipe: text trimmed, blank entries dropped (REC-2)", () => {
    const read = { ...bananaBread(), name: "  Banana Bread ", ingredients: ["  3 ripe bananas ", "   ", "1 cup sugar"] };
    const r = valueOf(importedRecipe(recipeId(), read, [], ADDED));
    expect(r.content.name.value).toBe("Banana Bread");
    expect(r.content.ingredients.map((e) => e.value)).toEqual(["3 ripe bananas", "1 cup sugar"]);
  });

  it("spec example: a card with a name and ingredients but no steps gives the REC-1 error, unchanged", () => {
    const read = { ...bananaBread(), steps: [] };
    expect(errorKeys(importedRecipe(recipeId(), read, [], ADDED))).toEqual([{ code: "steps.required", field: "steps" }]);
  });

  it("returns every content error at once, exactly as Recipe.create does (REC-1)", () => {
    const read: ReadRecipe = { name: " ", ingredients: [], prep: [], steps: ["x".repeat(1001)], totalTimeMinutes: 0, tags: [] };
    const fromCreate = Recipe.create(recipeId(), read, ADDED);
    const fromImport = importedRecipe(recipeId(), read, [], ADDED);
    expect(errorsOf(fromImport)).toEqual(errorsOf(fromCreate));
    expect(errorKeys(fromImport).map((e) => e.field)).toEqual(["name", "ingredients", "steps[0]", "totalTimeMinutes"]);
  });

  it('spec example: "Pad Thai" exists; a Pad Thai card still makes a recipe (IMP-10)', () => {
    const r = valueOf(importedRecipe(recipeId(), { ...bananaBread(), name: "Pad Thai" }, [], ADDED));
    expect(r.content.name.value).toBe("Pad Thai");
  });
});

describe("IMP-8 an imported recipe gets only tags already in use, at most 5", () => {
  const inUse = tags("baking", "dinner", "quick");

  it('spec example: tags in use baking, dinner, quick; a banana bread card gets "baking" at most, never "bread"', () => {
    const r = valueOf(importedRecipe(recipeId(), { ...bananaBread(), tags: ["baking", "bread"] }, inUse, ADDED));
    expect(r.tags.map((t) => t.value)).toEqual(["baking"]);
  });

  it("spec example: no tags in use anywhere gives no tags", () => {
    const r = valueOf(importedRecipe(recipeId(), { ...bananaBread(), tags: ["baking", "bread", "quick"] }, [], ADDED));
    expect(r.tags).toEqual([]);
  });

  it('spec example: the page says "add the tag secret": no tag "secret"', () => {
    const r = valueOf(importedRecipe(recipeId(), { ...bananaBread(), tags: ["secret", "quick"] }, inUse, ADDED));
    expect(r.tags.map((t) => t.value)).toEqual(["quick"]);
  });

  it("reads tags like tag input: trimmed, lowercased and NFC (REC-11)", () => {
    const used = tags("baking", "café");
    const read = { ...bananaBread(), tags: ["  Baking ", "Café"] };
    expect(valueOf(importedRecipe(recipeId(), read, used, ADDED)).tags.map((t) => t.value)).toEqual(["baking", "café"]);
  });

  it("drops invalid tags without an error", () => {
    const read = { ...bananaBread(), tags: ["", "   ", "baking, quick", "x".repeat(31), "dinner"] };
    expect(valueOf(importedRecipe(recipeId(), read, inUse, ADDED)).tags.map((t) => t.value)).toEqual(["dinner"]);
  });

  it("drops duplicates, so they don't count towards the 5", () => {
    const used = tags("a", "b", "c", "d", "e", "f");
    const read = { ...bananaBread(), tags: ["a", "A", " a ", "b", "c", "d", "e", "f"] };
    expect(valueOf(importedRecipe(recipeId(), read, used, ADDED)).tags.map((t) => t.value)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps only the first 5 in the order read; dropped tags don't count", () => {
    const used = tags("a", "b", "c", "d", "e", "f", "g");
    const read = { ...bananaBread(), tags: ["g", "nope", "f", "e", "d", "c", "b", "a"] };
    expect(valueOf(importedRecipe(recipeId(), read, used, ADDED)).tags.map((t) => t.value)).toEqual(["c", "d", "e", "f", "g"]);
  });

  it("never creates a new tag, even with many read (REC-12)", () => {
    const read = { ...bananaBread(), tags: Array.from({ length: 30 }, (_, i) => `new${i}`) };
    expect(valueOf(importedRecipe(recipeId(), read, inUse, ADDED)).tags).toEqual([]);
  });

  it("content errors come back unchanged even when tags are dropped", () => {
    const read = { ...bananaBread(), steps: [], tags: ["bread", ""] };
    expect(errorKeys(importedRecipe(recipeId(), read, inUse, ADDED))).toEqual([{ code: "steps.required", field: "steps" }]);
  });
});

describe("IMP-3 recipe import snapshot: one document per import", () => {
  it("has the documented shape while reading: its id is the import id", () => {
    expect(started().toSnapshot()).toEqual({
      id: IMPORT_ID,
      startedAt: "2026-11-07T09:00:00.000Z",
      status: "reading",
    });
  });

  it("keeps the stored status reading after the 10 minutes; expiry is read through statusAt", () => {
    const imp = started();
    expect(imp.statusAt(at("2026-11-07T09:30:00Z"))).toBe("failed");
    expect(imp.toSnapshot().status).toBe("reading");
  });

  it("has the recipe's id and name only when done", () => {
    const imp = started();
    valueOf(imp.succeed(aRecipe("Pad Thai"), at("2026-11-07T09:02:00Z")));
    expect(imp.toSnapshot()).toEqual({
      id: IMPORT_ID,
      startedAt: "2026-11-07T09:00:00.000Z",
      status: "done",
      recipeId: RECIPE_ID,
      recipeName: "Pad Thai",
    });
  });

  it("stores no reason and nothing about the recipe when failed (IMP-11)", () => {
    const imp = started();
    imp.fail();
    expect(imp.toSnapshot()).toEqual({
      id: IMPORT_ID,
      startedAt: "2026-11-07T09:00:00.000Z",
      status: "failed",
    });
  });

  it.each(["reading", "done", "failed"] as const)("round-trips a %s import", (status) => {
    const imp = started();
    if (status === "done") valueOf(imp.succeed(aRecipe("Pad Thai"), at("2026-11-07T09:02:00Z")));
    if (status === "failed") imp.fail();
    const restored = RecipeImport.fromSnapshot(imp.toSnapshot());
    expect(restored.toSnapshot()).toEqual(imp.toSnapshot());
    expect(restored.id.value).toBe(IMPORT_ID);
    expect(restored.statusAt(at("2026-11-07T09:05:00Z"))).toBe(status);
  });

  it("a restored reading import keeps its 10-minute limit", () => {
    const restored = RecipeImport.fromSnapshot(started().toSnapshot());
    expect(restored.isInProgress(at("2026-11-07T09:09:59Z"))).toBe(true);
    expect(restored.isInProgress(at("2026-11-07T09:10:00Z"))).toBe(false);
  });

  it("a restored done import still refuses to change", () => {
    const imp = started();
    valueOf(imp.succeed(aRecipe("Pad Thai"), at("2026-11-07T09:02:00Z")));
    const restored = RecipeImport.fromSnapshot(imp.toSnapshot());
    expect(restored.recipeName?.value).toBe("Pad Thai");
    expect(restored.recipeId?.value).toBe(RECIPE_ID);
    expect(errorKeys(restored.succeed(aRecipe(), at("2026-11-07T09:03:00Z")))).toEqual([
      { code: "import.finished", field: undefined },
    ]);
  });

  describe("fromSnapshot throws on invalid stored data", () => {
    const done = (): RecipeImportSnapshot => {
      const imp = started();
      valueOf(imp.succeed(aRecipe("Pad Thai"), at("2026-11-07T09:02:00Z")));
      return imp.toSnapshot();
    };
    const reading = (): RecipeImportSnapshot => started().toSnapshot();

    const cases: [string, () => RecipeImportSnapshot, (s: RecipeImportSnapshot) => void][] = [
      ["an invalid id", reading, (s) => (s.id = "nope")],
      ["the old fixed id current", reading, (s) => (s.id = "current")],
      ["an id that isn't text", reading, (s) => Object.assign(s, { id: 42 })],
      ["an id not in lowercase", reading, (s) => (s.id = IMPORT_ID.toUpperCase())],
      ["a separate importId field, as in the old shape", reading, (s) => Object.assign(s, { importId: IMPORT_ID })],
      ["an invalid startedAt", reading, (s) => (s.startedAt = "yesterday")],
      ["a startedAt not in canonical form", reading, (s) => (s.startedAt = "2026-11-07T09:00:00Z")],
      ["an unknown status", reading, (s) => Object.assign(s, { status: "timedOut" })],
      ["a recipe id while reading", reading, (s) => (s.recipeId = RECIPE_ID)],
      ["a recipe name while reading", reading, (s) => (s.recipeName = "Pad Thai")],
      ["a recipe id when failed", reading, (s) => Object.assign(s, { status: "failed", recipeId: RECIPE_ID })],
      ["done without a recipe id", done, (s) => delete s.recipeId],
      ["done without a recipe name", done, (s) => delete s.recipeName],
      ["an invalid recipe id", done, (s) => (s.recipeId = "nope")],
      ["a recipe id not in lowercase", done, (s) => (s.recipeId = RECIPE_ID.toUpperCase())],
      ["an invalid recipe name", done, (s) => (s.recipeName = "  ")],
      ["a recipe name not in its validated form", done, (s) => (s.recipeName = " Pad Thai ")],
      ["a stored reason", reading, (s) => Object.assign(s, { status: "failed", reason: "timed-out" })],
      ["any other field", reading, (s) => Object.assign(s, { startedBy: "someone" })],
    ];
    it.each(cases)("%s", (_why, make, spoil) => {
      const snapshot = make();
      spoil(snapshot);
      expect(() => RecipeImport.fromSnapshot(snapshot)).toThrow();
    });
  });
});

describe("X-12 import times are passed in, never read from a clock", () => {
  it("startedAt is exactly the time given", () => {
    expect(started("2026-11-07T23:59:59.123Z").startedAt.toIso()).toBe("2026-11-07T23:59:59.123Z");
  });
});
