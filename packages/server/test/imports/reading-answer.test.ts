// The model's answer is untrusted input (docs/architecture.md, "Recipe import"): parsed against the schema's shape before the
// domain sees it.
import { describe, expect, it } from "vitest";
import { ImportId } from "@recipebox/domain";
import { dishPhotoArea, dishPhotoPage } from "../../src/imports/dish-photo.js";
import { importedRecipeId } from "../../src/imports/imported-recipe-id.js";
import { parseReadingAnswer } from "../../src/imports/reading-answer.js";
import { answer } from "./process-import-helpers.js";

describe("IMP-6 / IMP-11 the answer's shape", () => {
  it("gives the recipe that was read", () => {
    expect(parseReadingAnswer(answer({ tags: ["baking"], dishPhoto: { photo: 2, left: 0.1, top: 0.2, width: 0.3, height: 0.4 } })))
      .toEqual({
        ok: true,
        value: {
          found: true,
          recipe: {
            name: "Banana Bread",
            ingredients: ["3 ripe bananas", "1/3 cup melted butter"],
            prep: [],
            steps: ["Mash the bananas.", "Bake for 60 minutes."],
            totalTimeMinutes: 75,
            tags: ["baking"],
          },
          dishPhoto: { photo: 2, left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
        },
      });
  });

  it("gives no total time for null and no dish photo for null", () => {
    const parsed = parseReadingAnswer(answer({ totalTimeMinutes: null, dishPhoto: null }));
    if (!parsed.ok || !parsed.value.found) throw new Error("expected a recipe");
    expect(parsed.value.recipe).not.toHaveProperty("totalTimeMinutes");
    expect(parsed.value.dishPhoto).toBeUndefined();
  });

  it("accepts an answer without tags, as the schema has none when no tag is in use", () => {
    const { tags: _tags, ...rest } = JSON.parse(answer()) as Record<string, unknown>;
    const parsed = parseReadingAnswer(JSON.stringify(rest));
    expect(parsed).toMatchObject({ ok: true, value: { found: true, recipe: { tags: [] } } });
  });

  it("IMP-9: keeps a recipe whose box names a fractional photo; which photo that is, none, is decided later", () => {
    const parsed = parseReadingAnswer(answer({ dishPhoto: { photo: 1.5, left: 0, top: 0, width: 1, height: 1 } }));
    expect(parsed).toMatchObject({ ok: true, value: { found: true, dishPhoto: { photo: 1.5 } } });
  });

  it("is not found when found is false, whatever else it holds", () => {
    expect(parseReadingAnswer(answer({ found: false }))).toEqual({ ok: true, value: { found: false } });
  });

  it.each([
    ["not JSON", "Banana Bread"],
    ["a JSON array", "[]"],
    ["a field missing", JSON.stringify({ ...JSON.parse(answer()), steps: undefined })],
    ["a field of the wrong type", answer({ ingredients: "3 bananas" })],
    ["a fractional total time", answer({ totalTimeMinutes: 12.5 })],
    ["an extra field", answer({ notes: "Grandma's favourite" })],
    ["an extra field in the box", answer({ dishPhoto: { photo: 1, left: 0, top: 0, width: 1, height: 1, label: "loaf" } })],
    ["IMP-9: a box without the photo it is on", answer({ dishPhoto: { left: 0, top: 0, width: 1, height: 1 } })],
  ])("refuses %s, without quoting the answer", (_case, raw) => {
    const parsed = parseReadingAnswer(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    for (const text of ["Banana", "bananas", "Grandma", "loaf"]) expect(parsed.detail).not.toContain(text);
  });

  it("names the field that doesn't fit", () => {
    expect(parseReadingAnswer(answer({ steps: [1] }))).toEqual({ ok: false, detail: expect.stringContaining("steps.0") });
  });
});

describe("IMP-9 the photo the dish picture is on: from 1, in the order given", () => {
  const pages = ["front", "back"] as const;
  const box = { left: 0, top: 0, width: 1, height: 1 };

  it.each([
    [1, "front"],
    [2, "back"],
  ])("photo %i is the photo added in that place", (photo, page) => {
    expect(dishPhotoPage({ ...box, photo }, pages)).toBe(page);
  });

  it.each([0, -1, 3, 4])("means no photo for photo %i, which doesn't exist", (photo) => {
    expect(dishPhotoPage({ ...box, photo }, pages)).toBeUndefined();
  });

  it("means no photo when there is no box", () => {
    expect(dishPhotoPage(undefined, pages)).toBeUndefined();
  });
});

describe("IMP-9 the dish picture's area: the box clamped to the image, big enough for a thumbnail", () => {
  const page = { width: 2000, height: 1000 };

  it("turns fractions into pixels", () => {
    expect(dishPhotoArea({ left: 0.5, top: 0.25, width: 0.25, height: 0.5 }, page)).toEqual({
      left: 1000,
      top: 250,
      width: 500,
      height: 500,
    });
  });

  it("means no photo when there is no box", () => {
    expect(dishPhotoArea(undefined, page)).toBeUndefined();
  });

  it("clamps a box reaching outside the image", () => {
    expect(dishPhotoArea({ left: -0.5, top: 0.5, width: 1, height: 2 }, page)).toEqual({
      left: 0,
      top: 500,
      width: 1000,
      height: 500,
    });
  });

  it.each([
    ["entirely outside", { left: 1.1, top: 0, width: 0.5, height: 0.5 }],
    ["of negative size", { left: 0.5, top: 0.5, width: -0.4, height: -0.4 }],
    ["of zero height", { left: 0, top: 0.5, width: 1, height: 0 }],
    ["399 pixels on its longer side", { left: 0, top: 0, width: 399 / 2000, height: 0.3 }],
  ])("means no photo for a box %s", (_case, box) => {
    expect(dishPhotoArea(box, page)).toBeUndefined();
  });

  it("accepts a box exactly as big as a thumbnail on its longer side", () => {
    expect(dishPhotoArea({ left: 0, top: 0, width: 0.2, height: 0.1 }, page)).toEqual({
      left: 0,
      top: 0,
      width: 400,
      height: 100,
    });
  });
});

describe("IMP-10 the imported recipe's id (docs/architecture.md, 'Recipe import')", () => {
  const importId = (text: string): ImportId => {
    const id = ImportId.create(text);
    if (!id.ok) throw new Error("not a UUID");
    return id.value;
  };

  it("is always the same for the same import, so a second delivery can't add the recipe twice", () => {
    const id = importId("3f2c7f0e-1b0a-4c39-9c51-4a0f4c3e2b1d");
    expect(importedRecipeId(id).value).toBe(importedRecipeId(importId(id.value.toUpperCase())).value);
  });

  it("differs between imports and from the import id, as a version 5 UUID", () => {
    const a = importedRecipeId(importId("3f2c7f0e-1b0a-4c39-9c51-4a0f4c3e2b1d"));
    const b = importedRecipeId(importId("3f2c7f0e-1b0a-4c39-9c51-4a0f4c3e2b1e"));
    expect(a.value).not.toBe(b.value);
    expect(a.value).not.toBe("3f2c7f0e-1b0a-4c39-9c51-4a0f4c3e2b1d");
    expect(a.value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
