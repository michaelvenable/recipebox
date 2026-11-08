// Cooking history endpoints (docs/api.md) against the in-memory repository, using the examples table in
// docs/specs/cooking-history.md. The rules themselves are tested in packages/domain; these tests show each endpoint applies them.
import { describe, expect, it } from "vitest";
import { EditorRecipe, EditorRecipeSummary, RediscoverEntry } from "@recipebox/shared";
import {
  AS_EDITOR,
  AS_NON_EDITOR,
  AS_VISITOR,
  change,
  content,
  expectErrors,
  get,
  recipeApp,
  SEEDED_AT,
  seed,
  storedSnapshots,
} from "./recipe-route-helpers.js";

const UNKNOWN_ID = "bbbbbbbb-0000-4000-8000-000000000000";
const MALFORMED_ID = "not-a-uuid";

type App = Awaited<ReturnType<typeof recipeApp>>["app"];

async function recommendations(app: App): Promise<RediscoverEntry[]> {
  const res = await get(app, "/recommendations", AS_EDITOR);
  expect(res.statusCode, res.body).toBe(200);
  return RediscoverEntry.array().parse(res.json());
}

async function listNames(app: App, query: string): Promise<string[]> {
  const res = await get(app, `/recipes${query}`, AS_EDITOR);
  expect(res.statusCode, res.body).toBe(200);
  return EditorRecipeSummary.array().parse(res.json()).map((r) => r.name);
}

describe("COOK-1 mark as cooked", () => {
  it("records the server's current time and returns the EditorRecipe", async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { cookedAt: ["2026-09-01T18:00:00.000Z"] });
    clock.set("2026-10-03T19:04:05.006Z");

    const res = await change(app, "POST", `/recipes/${recipe.id.value}/cookings`);

    expect(res.statusCode, res.body).toBe(200);
    expect(EditorRecipe.parse(res.json())).toEqual({
      id: recipe.id.value,
      name: "Pad Thai",
      ingredients: ["1 thing"],
      steps: ["Do it."],
      tags: [],
      hasPhoto: false,
      cookedAt: ["2026-10-03T19:04:05.006Z", "2026-09-01T18:00:00.000Z"],
      lastCookedAt: "2026-10-03T19:04:05.006Z",
      timesCooked: 2,
    });
    expect((await repository.get(recipe.id))?.toSnapshot().cookedAt).toEqual([
      "2026-10-03T19:04:05.006Z",
      "2026-09-01T18:00:00.000Z",
    ]);
  });

  it.each([
    ["an unknown id", UNKNOWN_ID],
    ["a malformed id", MALFORMED_ID],
  ])("answers %s with 404", async (_name, id) => {
    const { app, repository } = await recipeApp();
    expectErrors(await change(app, "POST", `/recipes/${id}/cookings`), 404, ["recipe.notFound"]);
    expect(await repository.list()).toEqual([]);
  });
});

describe("COOK-4 (withdrawn) duplicates are allowed", () => {
  it("marking a recipe cooked twice records two entries", async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    clock.set("2026-10-03T18:00:00.000Z");
    await change(app, "POST", `/recipes/${recipe.id.value}/cookings`);
    clock.set("2026-10-03T18:00:05.000Z");
    const res = await change(app, "POST", `/recipes/${recipe.id.value}/cookings`);

    const cooked = EditorRecipe.parse(res.json());
    expect(cooked.cookedAt).toEqual(["2026-10-03T18:00:05.000Z", "2026-10-03T18:00:00.000Z"]);
    expect(cooked.timesCooked).toBe(2);
  });

  it("two devices each mark the recipe cooked, one after the other: two entries", async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    clock.set("2026-10-03T18:00:00.000Z");
    await change(app, "POST", `/recipes/${recipe.id.value}/cookings`);
    const both = EditorRecipe.parse((await change(app, "POST", `/recipes/${recipe.id.value}/cookings`)).json());
    expect(both.cookedAt).toEqual(["2026-10-03T18:00:00.000Z", "2026-10-03T18:00:00.000Z"]);
    expect(both.timesCooked).toBe(2);
  });
});

describe("COOK-5 history on the recipe", () => {
  it("lists entries newest first, with the last-cooked date and count; none when never cooked", async () => {
    const { app, repository } = await recipeApp();
    const cooked = await seed(repository, content("Pad Thai"), {
      cookedAt: ["2026-10-15T18:00:00.000Z", "2026-09-01T18:00:00.000Z", "2026-09-20T18:00:00.000Z"],
    });
    const never = await seed(repository, content("Curry"));

    expect(EditorRecipe.parse((await get(app, `/recipes/${cooked.id.value}`, AS_EDITOR)).json())).toMatchObject({
      cookedAt: ["2026-10-15T18:00:00.000Z", "2026-09-20T18:00:00.000Z", "2026-09-01T18:00:00.000Z"],
      lastCookedAt: "2026-10-15T18:00:00.000Z",
      timesCooked: 3,
    });
    const fresh = EditorRecipe.parse((await get(app, `/recipes/${never.id.value}`, AS_EDITOR)).json());
    expect(fresh.lastCookedAt).toBeUndefined();
    expect(fresh.timesCooked).toBe(0);
  });
});

describe("COOK-6 haven't made in a while", () => {
  it("recipes A (never), B (last 2026-01-10), C (last 2026-08-02): view order A, B, C", async () => {
    const { app, repository } = await recipeApp();
    const c = await seed(repository, content("C", { tags: ["dinner"] }), {
      cookedAt: ["2026-03-01T18:00:00.000Z", "2026-08-02T18:00:00.000Z"],
    });
    const a = await seed(repository, content("A"));
    const b = await seed(repository, content("B"), { cookedAt: ["2026-01-10T18:00:00.000Z"] });

    expect(await recommendations(app)).toEqual([
      { id: a.id.value, name: "A", tags: [], hasPhoto: false, createdAt: SEEDED_AT },
      { id: b.id.value, name: "B", tags: [], hasPhoto: false, createdAt: SEEDED_AT, lastCookedAt: "2026-01-10T18:00:00.000Z" },
      { id: c.id.value, name: "C", tags: ["dinner"], hasPhoto: false, createdAt: SEEDED_AT, lastCookedAt: "2026-08-02T18:00:00.000Z" },
    ]);
  });

  it("puts never-cooked recipes first, sorted by name ignoring case and accents", async () => {
    const { app, repository } = await recipeApp();
    await seed(repository, content("Apple Pie"), { cookedAt: ["2026-01-01T18:00:00.000Z"] });
    for (const name of ["Zucchini Bread", "Éclair", "banana bread"]) await seed(repository, content(name));
    expect((await recommendations(app)).map((e) => e.name)).toEqual(["banana bread", "Éclair", "Zucchini Bread", "Apple Pie"]);
  });

  it("leaves out recipes in the trash (REC-6)", async () => {
    const { app, repository } = await recipeApp();
    await seed(repository, content("Pad Thai"));
    await seed(repository, content("Trashed"), { deletedAt: "2026-09-30T10:00:00.000Z" });
    expect((await recommendations(app)).map((e) => e.name)).toEqual(["Pad Thai"]);
  });

  it("returns an empty list when there are no recipes", async () => {
    const { app } = await recipeApp();
    expect(await recommendations(app)).toEqual([]);
  });

  it("marking a recipe cooked moves it to the end of the view", async () => {
    const { app, repository, clock } = await recipeApp();
    const never = await seed(repository, content("Never"));
    await seed(repository, content("Once"), { cookedAt: ["2026-09-01T18:00:00.000Z"] });
    clock.set("2026-10-03T18:00:00.000Z");

    await change(app, "POST", `/recipes/${never.id.value}/cookings`);

    expect((await recommendations(app)).map((e) => [e.name, e.lastCookedAt])).toEqual([
      ["Once", "2026-09-01T18:00:00.000Z"],
      ["Never", "2026-10-03T18:00:00.000Z"],
    ]);
  });
});

describe("COOK-9 filter recommendations by tags", () => {
  /** The COOK-6 example recipes: A (never), B (last 2026-01-10), C (last 2026-08-02); only A and C tagged "breakfast". */
  async function appWithExampleRecipes() {
    const setup = await recipeApp();
    await seed(setup.repository, content("C", { tags: ["breakfast", "quick"] }), {
      cookedAt: ["2026-08-02T18:00:00.000Z"],
    });
    await seed(setup.repository, content("B", { tags: ["dinner", "quick"] }), { cookedAt: ["2026-01-10T18:00:00.000Z"] });
    await seed(setup.repository, content("A", { tags: ["breakfast"] }));
    await seed(setup.repository, content("Trashed", { tags: ["breakfast"] }), { deletedAt: "2026-09-30T10:00:00.000Z" });
    return setup;
  }

  async function filteredNames(app: App, tags: string): Promise<string[]> {
    const res = await get(app, `/recommendations?tags=${tags}`, AS_EDITOR);
    expect(res.statusCode, res.body).toBe(200);
    return RediscoverEntry.array().parse(res.json()).map((e) => e.name);
  }

  it('spec example: only A and C tagged "breakfast"; filter it: A, C, with their last cookings', async () => {
    const { app } = await appWithExampleRecipes();
    const res = await get(app, "/recommendations?tags=breakfast", AS_EDITOR);
    expect(res.statusCode, res.body).toBe(200);
    expect(RediscoverEntry.array().parse(res.json()).map((e) => [e.name, e.lastCookedAt])).toEqual([
      ["A", undefined],
      ["C", "2026-08-02T18:00:00.000Z"],
    ]);
  });

  it.each([
    ["breakfast,quick", ["C"]],
    ["quick,breakfast", ["C"]],
    ["quick", ["B", "C"]],
    [encodeURIComponent("Breakfast, quick"), ["C"]],
    ["", ["A", "B", "C"]],
    ["breakfast,dinner", []],
    ["dessert", []],
  ])("tags %j gives %j: recipes with all of them, in the COOK-6 order", async (tags, expected) => {
    const { app } = await appWithExampleRecipes();
    expect(await filteredNames(app, tags)).toEqual(expected);
  });

  it("answers a tag that can't be valid as GET /recipes does: no recipe has it, so nothing", async () => {
    const { app } = await appWithExampleRecipes();
    expect(await filteredNames(app, "x".repeat(31))).toEqual([]);
    expect(await listNames(app, `?tags=${"x".repeat(31)}`)).toEqual([]);
  });

  it("refuses tags given twice with 400, as GET /recipes does", async () => {
    const { app } = await appWithExampleRecipes();
    expectErrors(await get(app, "/recommendations?tags=breakfast&tags=quick", AS_EDITOR), 400, ["request.invalid"]);
    expectErrors(await get(app, "/recipes?tags=breakfast&tags=quick", AS_EDITOR), 400, ["request.invalid"]);
  });

  it.each([
    ["a visitor", AS_VISITOR, 401, "auth.signInRequired"],
    ["a signed-in non-editor", AS_NON_EDITOR, 403, "auth.notEditor"],
  ] as const)("stays editor-only: refuses %s a filtered view, revealing nothing (X-1)", async (_who, as, status, code) => {
    const { app } = await appWithExampleRecipes();
    for (const url of ["/recommendations?tags=breakfast", "/recommendations?tags=breakfast&tags=quick"]) {
      const res = await get(app, url, as);
      expectErrors(res, status, [code]);
      for (const leak of ['"A"', '"C"', "2026-"]) expect(res.body, url).not.toContain(leak);
    }
  });
});

describe("REC-17 trashed recipes can't be changed: cooking history", () => {
  it("answers an editor's mark cooked on a recipe in the trash with 409 recipe.inTrash", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), {
      cookedAt: ["2026-09-01T18:00:00.000Z"],
      deletedAt: "2026-09-30T10:00:00.000Z",
    });
    const before = await storedSnapshots(repository);
    expectErrors(await change(app, "POST", `/recipes/${recipe.id.value}/cookings`), 409, ["recipe.inTrash"]);
    expect(await storedSnapshots(repository)).toEqual(before);
  });
});
