// Tag endpoints (docs/api.md, "Tags") against the in-memory repository: attaching and removing a tag (REC-10, REC-11) and
// suggestions while typing (REC-12). The rules themselves are tested in packages/domain; these tests show each endpoint applies
// them, using the tag rows of the examples table in docs/specs/recipes.md.
import { describe, expect, it } from "vitest";
import { EditorRecipe, Tag, TagCount } from "@recipebox/shared";
import {
  AS_EDITOR,
  change,
  content,
  expectErrors,
  get,
  recipeApp,
  type RecipeTestApp,
  seed,
  storedSnapshots,
} from "./recipe-route-helpers.js";

const UNKNOWN_ID = "bbbbbbbb-0000-4000-8000-000000000000";
const MALFORMED_ID = "not-a-uuid";

/** Attach (POST) or remove (DELETE) a tag; the tag travels in the body as TagRequest (docs/api.md). */
function tagChange(app: RecipeTestApp["app"], method: "POST" | "DELETE", id: string, tag: string) {
  return change(app, method, `/recipes/${id}/tags`, { tag });
}

/** Twenty valid tags, "quick" among them. */
const TWENTY_TAGS = ["quick", ...Array.from({ length: 19 }, (_, i) => `tag${String(i).padStart(2, "0")}`)];

describe("REC-10 tags", () => {
  it("attaches a tag from the recipe view, saves it and returns the EditorRecipe", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai", { tags: ["thai"] }), {
      cookedAt: ["2026-09-01T18:00:00.000Z"],
    });

    const res = await tagChange(app, "POST", recipe.id.value, "dinner");

    expect(res.statusCode, res.body).toBe(200);
    expect(EditorRecipe.parse(res.json())).toEqual({
      id: recipe.id.value,
      name: "Pad Thai",
      ingredients: ["1 thing"],
      steps: ["Do it."],
      tags: ["dinner", "thai"],
      hasPhoto: false,
      cookedAt: ["2026-09-01T18:00:00.000Z"],
      lastCookedAt: "2026-09-01T18:00:00.000Z",
      timesCooked: 1,
    });
    expect((await repository.get(recipe.id))?.toSnapshot().tags).toEqual(["dinner", "thai"]);
  });

  it("creates a new tag simply by attaching it, including spaces, accents and slashes", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    for (const tag of ["main course", "épicé", "50/50"]) {
      expect((await tagChange(app, "POST", recipe.id.value, tag)).statusCode, tag).toBe(200);
    }
    expect((await repository.get(recipe.id))?.toSnapshot().tags).toEqual(["50/50", "épicé", "main course"]);
  });

  it("removes a tag, saves it and returns the EditorRecipe", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai", { tags: ["dinner", "thai"] }));

    const res = await tagChange(app, "DELETE", recipe.id.value, "Dinner ");

    expect(res.statusCode, res.body).toBe(200);
    expect(EditorRecipe.parse(res.json()).tags).toEqual(["thai"]);
    expect((await repository.get(recipe.id))?.toSnapshot().tags).toEqual(["thai"]);
  });

  it("removing a tag the recipe doesn't have changes nothing and is not an error", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai", { tags: ["thai"] }));
    const before = await storedSnapshots(repository);

    const res = await tagChange(app, "DELETE", recipe.id.value, "dinner");

    expect(res.statusCode, res.body).toBe(200);
    expect(EditorRecipe.parse(res.json()).tags).toEqual(["thai"]);
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it("attaching and removing leave the to-make status and cooking history alone", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), {
      cookedAt: ["2026-09-01T18:00:00.000Z"],
      toMakeAt: "2026-09-20T08:00:00.000Z",
    });
    await tagChange(app, "POST", recipe.id.value, "dinner");
    const res = await tagChange(app, "DELETE", recipe.id.value, "dinner");
    expect(EditorRecipe.parse(res.json())).toMatchObject({
      toMake: { addedAt: "2026-09-20T08:00:00.000Z" },
      cookedAt: ["2026-09-01T18:00:00.000Z"],
    });
  });

  for (const method of ["POST", "DELETE"] as const) {
    it.each([
      ["an unknown id", UNKNOWN_ID],
      ["a malformed id", MALFORMED_ID],
    ])(`answers ${method} for %s with 404`, async (_name, id) => {
      const { app, repository } = await recipeApp();
      expectErrors(await tagChange(app, method, id, "dinner"), 404, ["recipe.notFound"]);
      expect(await repository.list()).toEqual([]);
    });
  }

  it.each([
    [".", ["."]],
    ["..", [".."]],
    ["a/b", ["a/b"]],
    ["%2F", ["%2f"]],
  ])('attaches and removes the tag "%s", which an address would have rewritten', async (tag, stored) => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai", { tags: ["thai"] }));

    const attached = await tagChange(app, "POST", recipe.id.value, tag);
    expect(attached.statusCode, attached.body).toBe(200);
    expect(EditorRecipe.parse(attached.json()).tags).toEqual([...stored, "thai"]);
    expect((await repository.get(recipe.id))?.toSnapshot().tags).toEqual([...stored, "thai"]);

    const removed = await tagChange(app, "DELETE", recipe.id.value, tag);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(EditorRecipe.parse(removed.json()).tags).toEqual(["thai"]);
    expect((await repository.get(recipe.id))?.toSnapshot().tags).toEqual(["thai"]);
  });

  it("the old addresses with the tag in the path are gone", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai", { tags: ["thai"] }));
    const before = await storedSnapshots(repository);
    for (const method of ["PUT", "DELETE"] as const) {
      expect((await change(app, method, `/recipes/${recipe.id.value}/tags/thai`)).statusCode, method).toBe(404);
    }
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  for (const method of ["POST", "DELETE"] as const) {
    it.each([
      ["no tag", {}, "request.invalid", "tag"],
      ["a tag that isn't a string", { tag: ["dinner"] }, "request.invalid", "tag"],
      ["an unknown field", { tag: "dinner", at: "2020-01-01T00:00:00.000Z" }, "request.unknownField", "at"],
    ])(`refuses ${method} with a body with %s with 400 (TagRequest), and changes nothing`, async (_name, body, code, field) => {
      const { app, repository } = await recipeApp();
      const recipe = await seed(repository, content("Pad Thai", { tags: ["dinner"] }));
      const before = await storedSnapshots(repository);
      const res = await change(app, method, `/recipes/${recipe.id.value}/tags`, body);
      expect(expectErrors(res, 400, [code]).errors[0]?.field).toBe(field);
      expect(await storedSnapshots(repository)).toEqual(before);
    });

    it(`refuses ${method} with a body that isn't an object with 400, and changes nothing`, async () => {
      const { app, repository } = await recipeApp();
      const recipe = await seed(repository, content("Pad Thai", { tags: ["dinner"] }));
      const before = await storedSnapshots(repository);
      expectErrors(await change(app, method, `/recipes/${recipe.id.value}/tags`, "dinner"), 400, ["request.invalid"]);
      expect(await storedSnapshots(repository)).toEqual(before);
    });
  }
});

describe("REC-13 tags in use follow attaching and removing", () => {
  it('remove "quick" from A and C: "quick" is no longer offered as a filter', async () => {
    const { app, repository } = await recipeApp();
    const a = await seed(repository, content("A", { tags: ["dinner", "quick"] }));
    await seed(repository, content("B", { tags: ["dinner"] }));
    const c = await seed(repository, content("C", { tags: ["quick"] }));
    expect(TagCount.array().parse((await get(app, "/tags")).json())).toEqual([
      { tag: "dinner", count: 2 },
      { tag: "quick", count: 2 },
    ]);

    for (const recipe of [a, c]) {
      const res = await tagChange(app, "DELETE", recipe.id.value, "quick");
      expect(res.statusCode, res.body).toBe(200);
    }

    expect(TagCount.array().parse((await get(app, "/tags")).json())).toEqual([{ tag: "dinner", count: 2 }]);
  });
});

describe("REC-11 tag rules", () => {
  it('attach " Quick " to a recipe tagged "quick": no change; one tag "quick"', async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Salad", { tags: ["quick"] }));
    const before = await storedSnapshots(repository);

    const res = await tagChange(app, "POST", recipe.id.value, " Quick ");

    expect(res.statusCode, res.body).toBe(200);
    expect(EditorRecipe.parse(res.json()).tags).toEqual(["quick"]);
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it('attach "quick" to a recipe that has 20 tags including "quick": no change, no error', async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Salad", { tags: TWENTY_TAGS }));
    const before = await storedSnapshots(repository);

    const res = await tagChange(app, "POST", recipe.id.value, "quick");

    expect(res.statusCode, res.body).toBe(200);
    expect(EditorRecipe.parse(res.json()).tags).toHaveLength(20);
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it("refuses a 21st tag with 400 tags.tooMany, and changes nothing", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Salad", { tags: TWENTY_TAGS }));
    const before = await storedSnapshots(repository);
    expectErrors(await tagChange(app, "POST", recipe.id.value, "dinner"), 400, ["tags.tooMany"]);
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it.each([
    ["31 characters", "x".repeat(31), "tag.tooLong"],
    ["blank", "   ", "tag.required"],
    ["empty", "", "tag.required"],
  ])("refuses a tag that is %s with 400, and changes nothing", async (_name, tag, code) => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Salad"));
    const before = await storedSnapshots(repository);
    const body = expectErrors(await tagChange(app, "POST", recipe.id.value, tag), 400, [code]);
    expect(body.errors[0]?.field).toBe("tag");
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it('stores "Dinner" as "dinner" and keeps tags in alphabetical order, ignoring accents', async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Mix", { tags: ["zucchini", "apple"] }));
    await tagChange(app, "POST", recipe.id.value, "Dinner");
    const res = await tagChange(app, "POST", recipe.id.value, "épicé");
    expect(EditorRecipe.parse(res.json()).tags).toEqual(["apple", "dinner", "épicé", "zucchini"]);
  });
});

describe("REC-17 trashed recipes can't be changed: tags", () => {
  for (const method of ["POST", "DELETE"] as const) {
    it(`answers an editor's ${method} of a tag on a recipe in the trash with 409 recipe.inTrash, and changes nothing`, async () => {
      const { app, repository } = await recipeApp();
      const recipe = await seed(repository, content("Pad Thai", { tags: ["thai"] }), {
        deletedAt: "2026-09-30T10:00:00.000Z",
      });
      const before = await storedSnapshots(repository);
      expectErrors(await tagChange(app, method, recipe.id.value, "thai"), 409, ["recipe.inTrash"]);
      expect(await storedSnapshots(repository)).toEqual(before);
    });
  }
});

describe("REC-12 tag suggestions", () => {
  /** "Brownies" [dessert, chocolate], "Pancakes" [desserts, breakfast], "Curry" [épicé], plus one in the trash. */
  async function appWithTags(): Promise<Awaited<ReturnType<typeof recipeApp>> & { brownies: string }> {
    const setup = await recipeApp();
    const brownies = await seed(setup.repository, content("Brownies", { tags: ["dessert", "chocolate"] }));
    await seed(setup.repository, content("Pancakes", { tags: ["desserts", "breakfast"] }));
    await seed(setup.repository, content("Curry", { tags: ["épicé"] }));
    await seed(setup.repository, content("Trashed", { tags: ["dessert wine"] }), { deletedAt: "2026-09-30T10:00:00.000Z" });
    return { ...setup, brownies: brownies.id.value };
  }

  async function suggestions(
    app: RecipeTestApp["app"],
    query: Record<string, string>,
  ): Promise<string[]> {
    const res = await get(app, `/tag-suggestions?${new URLSearchParams(query).toString()}`, AS_EDITOR);
    expect(res.statusCode, res.body).toBe(200);
    return Tag.array().parse(res.json());
  }

  it('offers both "dessert" and "desserts" when typing "dess" for a new recipe, so the editor can reuse one', async () => {
    const { app } = await appWithTags();
    expect(await suggestions(app, { typed: "dess" })).toEqual(["dessert", "desserts"]);
  });

  it('offers "desserts" but not "dessert" for a recipe that already has "dessert"', async () => {
    const { app, brownies } = await appWithTags();
    expect(await suggestions(app, { typed: "dessert", recipeId: brownies })).toEqual(["desserts"]);
  });

  it("offers every tag in use on other recipes, alphabetically, before anything is typed", async () => {
    const { app, brownies } = await appWithTags();
    expect(await suggestions(app, {})).toEqual(["breakfast", "chocolate", "dessert", "desserts", "épicé"]);
    expect(await suggestions(app, { typed: "" })).toEqual(["breakfast", "chocolate", "dessert", "desserts", "épicé"]);
    expect(await suggestions(app, { typed: "", recipeId: brownies })).toEqual(["breakfast", "desserts", "épicé"]);
  });

  it("treats an empty recipeId as a new recipe", async () => {
    const { app } = await appWithTags();
    expect(await suggestions(app, { typed: "choc", recipeId: "" })).toEqual(["chocolate"]);
  });

  it.each([
    ["epice", ["épicé"]],
    ["ÉPI", ["épicé"]],
    ["  Choc ", ["chocolate"]],
    ["sert", ["dessert", "desserts"]],
    ["lasagne", []],
  ])('typing "%s" offers %j, ignoring case and accents', async (typed, expected) => {
    const { app } = await appWithTags();
    expect(await suggestions(app, { typed })).toEqual(expected);
  });

  it("doesn't offer tags used only on the recipe itself or on recipes in the trash", async () => {
    const { app, repository } = await recipeApp();
    const only = await seed(repository, content("Only", { tags: ["unique"] }));
    await seed(repository, content("Trashed", { tags: ["hidden"] }), { deletedAt: "2026-09-30T10:00:00.000Z" });
    expect(await suggestions(app, { typed: "", recipeId: only.id.value })).toEqual([]);
    expect(await suggestions(app, { typed: "" })).toEqual(["unique"]);
  });

  it.each([
    ["an unknown recipeId", UNKNOWN_ID],
    ["a malformed recipeId", MALFORMED_ID],
  ])("answers %s with 404", async (_name, id) => {
    const { app } = await appWithTags();
    expectErrors(await get(app, `/tag-suggestions?typed=d&recipeId=${id}`, AS_EDITOR), 404, ["recipe.notFound"]);
  });

  it("answers a recipeId of a recipe in the trash with the same 404 as an unknown one", async () => {
    const { app, repository } = await recipeApp();
    const trashed = await seed(repository, content("Trashed"), { deletedAt: "2026-09-30T10:00:00.000Z" });
    const res = await get(app, `/tag-suggestions?recipeId=${trashed.id.value}`, AS_EDITOR);
    expectErrors(res, 404, ["recipe.notFound"]);
    expect(res.json()).toEqual((await get(app, `/tag-suggestions?recipeId=${UNKNOWN_ID}`, AS_EDITOR)).json());
  });

  it("refuses typed or recipeId given twice with 400", async () => {
    const { app, brownies } = await appWithTags();
    expectErrors(await get(app, "/tag-suggestions?typed=a&typed=b", AS_EDITOR), 400, ["request.invalid"]);
    expectErrors(await get(app, `/tag-suggestions?recipeId=${brownies}&recipeId=${brownies}`, AS_EDITOR), 400, [
      "request.invalid",
    ]);
  });

  it("changes nothing and saves no placeholder for a new recipe", async () => {
    const { app, repository } = await appWithTags();
    const before = await storedSnapshots(repository);
    await suggestions(app, { typed: "d" });
    expect(await storedSnapshots(repository)).toEqual(before);
  });
});
