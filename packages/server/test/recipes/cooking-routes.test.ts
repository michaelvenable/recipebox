// Cooking history endpoints (docs/api.md) against the in-memory repository, using the examples table in
// docs/specs/cooking-history.md. The rules themselves are tested in packages/domain; these tests show each endpoint applies them.
import { describe, expect, it } from "vitest";
import { EditorRecipe, RediscoverEntry } from "@recipebox/shared";
import {
  AS_EDITOR,
  change,
  content,
  expectErrors,
  get,
  recipeApp,
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
      { id: a.id.value, name: "A", tags: [], hasPhoto: false },
      { id: b.id.value, name: "B", tags: [], hasPhoto: false, lastCookedAt: "2026-01-10T18:00:00.000Z" },
      { id: c.id.value, name: "C", tags: ["dinner"], hasPhoto: false, lastCookedAt: "2026-08-02T18:00:00.000Z" },
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
