// "To make" list endpoints (docs/api.md) against the in-memory repository, using the examples table in docs/specs/meal-plan.md.
// The rules themselves are tested in packages/domain; these tests show each endpoint applies them.
import { describe, expect, it } from "vitest";
import { EditorRecipe, EditorRecipeSummary, ToMakeEntry } from "@recipebox/shared";
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

async function toMakeList(app: App): Promise<ToMakeEntry[]> {
  const res = await get(app, "/plan", AS_EDITOR);
  expect(res.statusCode, res.body).toBe(200);
  return ToMakeEntry.array().parse(res.json());
}

describe("PLAN-1 add", () => {
  it("adds a recipe with the server's time and returns the EditorRecipe", async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai", { totalTimeMinutes: 30, tags: ["dinner"] }));
    clock.set("2026-10-02T17:30:00.000Z");

    const res = await change(app, "POST", `/recipes/${recipe.id.value}/add-to-plan`);

    expect(res.statusCode, res.body).toBe(200);
    expect(EditorRecipe.parse(res.json())).toEqual({
      id: recipe.id.value,
      name: "Pad Thai",
      ingredients: ["1 thing"],
      steps: ["Do it."],
      totalTimeMinutes: 30,
      tags: ["dinner"],
      hasPhoto: false,
      toMake: { addedAt: "2026-10-02T17:30:00.000Z" },
      cookedAt: [],
      timesCooked: 0,
    });
    expect((await repository.get(recipe.id))?.toSnapshot().toMake).toEqual({ addedAt: "2026-10-02T17:30:00.000Z" });
    expect(await toMakeList(app)).toEqual([
      {
        id: recipe.id.value,
        name: "Pad Thai",
        tags: ["dinner"],
        totalTimeMinutes: 30,
        hasPhoto: false,
        addedAt: "2026-10-02T17:30:00.000Z",
      },
    ]);
  });

  it.each([
    ["an unknown id", UNKNOWN_ID],
    ["a malformed id", MALFORMED_ID],
  ])("answers %s with 404", async (_name, id) => {
    const { app, repository } = await recipeApp();
    expectErrors(await change(app, "POST", `/recipes/${id}/add-to-plan`), 404, ["recipe.notFound"]);
    expect(await repository.list()).toEqual([]);
  });
});

describe("PLAN-2 no duplicates", () => {
  it('add "Pad Thai" twice: appears once, with the time it was first added', async () => {
    const { app, repository, clock } = await recipeApp("2026-10-01T09:00:00.000Z");
    const recipe = await seed(repository, content("Pad Thai"));

    expect((await change(app, "POST", `/recipes/${recipe.id.value}/add-to-plan`)).statusCode).toBe(200);
    clock.set("2026-10-05T09:00:00.000Z");
    const again = await change(app, "POST", `/recipes/${recipe.id.value}/add-to-plan`);

    expect(again.statusCode, again.body).toBe(200);
    expect(EditorRecipe.parse(again.json()).toMake).toEqual({ addedAt: "2026-10-01T09:00:00.000Z" });
    const list = await toMakeList(app);
    expect(list.map((e) => [e.name, e.addedAt])).toEqual([["Pad Thai", "2026-10-01T09:00:00.000Z"]]);
  });
});

describe("PLAN-3 view", () => {
  it("orders the list by when each recipe was added, oldest first, not by name", async () => {
    const { app, repository } = await recipeApp();
    await seed(repository, content("Apple Pie"), { toMakeAt: "2026-09-20T08:00:00.000Z" });
    await seed(repository, content("Zucchini Bread"), { toMakeAt: "2026-09-01T08:00:00.000Z" });
    await seed(repository, content("Éclair"), { toMakeAt: "2026-09-10T08:00:00.000Z" });
    await seed(repository, content("Not on the list"));

    expect((await toMakeList(app)).map((e) => [e.name, e.addedAt])).toEqual([
      ["Zucchini Bread", "2026-09-01T08:00:00.000Z"],
      ["Éclair", "2026-09-10T08:00:00.000Z"],
      ["Apple Pie", "2026-09-20T08:00:00.000Z"],
    ]);
  });

  it("orders recipes added through the API by the server's time of each request", async () => {
    const { app, repository, clock } = await recipeApp();
    const later = await seed(repository, content("A later"));
    const first = await seed(repository, content("B first"));
    clock.set("2026-10-01T10:00:00.000Z");
    await change(app, "POST", `/recipes/${first.id.value}/add-to-plan`);
    clock.set("2026-10-01T11:00:00.000Z");
    await change(app, "POST", `/recipes/${later.id.value}/add-to-plan`);

    expect((await toMakeList(app)).map((e) => e.name)).toEqual(["B first", "A later"]);
  });

  it("returns an empty list when nothing is on it", async () => {
    const { app, repository } = await recipeApp();
    await seed(repository, content("Pad Thai"));
    expect(await toMakeList(app)).toEqual([]);
  });
});

describe("PLAN-4 remove", () => {
  it('remove "Pad Thai" from the list: recipe and its history unchanged', async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai", { tags: ["dinner"] }), {
      cookedAt: ["2026-08-01T18:00:00.000Z", "2026-09-01T18:00:00.000Z"],
      toMakeAt: "2026-09-20T08:00:00.000Z",
    });
    const before = (await repository.get(recipe.id))?.toSnapshot();

    const res = await change(app, "POST", `/recipes/${recipe.id.value}/remove-from-plan`);

    expect(res.statusCode, res.body).toBe(200);
    const removed = EditorRecipe.parse(res.json());
    expect(removed.toMake).toBeUndefined();
    expect(removed).toMatchObject({
      name: "Pad Thai",
      tags: ["dinner"],
      cookedAt: ["2026-09-01T18:00:00.000Z", "2026-08-01T18:00:00.000Z"],
      lastCookedAt: "2026-09-01T18:00:00.000Z",
      timesCooked: 2,
    });
    const { toMake: _removed, ...unchanged } = before ?? {};
    expect((await repository.get(recipe.id))?.toSnapshot()).toEqual(unchanged);
    expect(await toMakeList(app)).toEqual([]);
  });

  it("removing a recipe that isn't on the list changes nothing and is not an error", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    const before = await storedSnapshots(repository);
    const res = await change(app, "POST", `/recipes/${recipe.id.value}/remove-from-plan`);
    expect(res.statusCode, res.body).toBe(200);
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it.each([
    ["an unknown id", UNKNOWN_ID],
    ["a malformed id", MALFORMED_ID],
  ])("answers %s with 404", async (_name, id) => {
    const { app } = await recipeApp();
    expectErrors(await change(app, "POST", `/recipes/${id}/remove-from-plan`), 404, ["recipe.notFound"]);
  });
});

describe("PLAN-5 cooked recipes leave the list", () => {
  it('"Pad Thai" on the list, mark it cooked: removed from the list; cooked date recorded', async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { toMakeAt: "2026-09-20T08:00:00.000Z" });
    await seed(repository, content("Curry"), { toMakeAt: "2026-09-21T08:00:00.000Z" });
    clock.set("2026-10-03T19:00:00.000Z");

    const res = await change(app, "POST", `/recipes/${recipe.id.value}/cookings`);

    expect(res.statusCode, res.body).toBe(200);
    const cooked = EditorRecipe.parse(res.json());
    expect(cooked.toMake).toBeUndefined();
    expect(cooked.cookedAt).toEqual(["2026-10-03T19:00:00.000Z"]);
    expect((await toMakeList(app)).map((e) => e.name)).toEqual(["Curry"]);
  });
});

describe("PLAN-6 deleted recipes leave the list", () => {
  it("takes a deleted recipe off the list, and restoring it doesn't put it back", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { toMakeAt: "2026-09-20T08:00:00.000Z" });

    await change(app, "DELETE", `/recipes/${recipe.id.value}`);
    expect(await toMakeList(app)).toEqual([]);

    await change(app, "POST", `/trash/${recipe.id.value}/restore`);
    expect(await toMakeList(app)).toEqual([]);

    expect((await change(app, "POST", `/recipes/${recipe.id.value}/add-to-plan`)).statusCode).toBe(200);
    expect((await toMakeList(app)).map((e) => e.name)).toEqual(["Pad Thai"]);
  });
});

describe("PLAN-7 indicator", () => {
  it("shows on the editor's recipe list once added, and goes when removed", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    const onList = async (): Promise<boolean | undefined> =>
      EditorRecipeSummary.array().parse((await get(app, "/recipes", AS_EDITOR)).json())[0]?.onToMakeList;

    expect(await onList()).toBe(false);
    await change(app, "POST", `/recipes/${recipe.id.value}/add-to-plan`);
    expect(await onList()).toBe(true);
    await change(app, "POST", `/recipes/${recipe.id.value}/remove-from-plan`);
    expect(await onList()).toBe(false);
  });
});

describe("REC-17 trashed recipes can't be changed: the to-make list", () => {
  for (const action of ["add-to-plan", "remove-from-plan"] as const) {
    it(`answers an editor's ${action} for a recipe in the trash with 409 recipe.inTrash, and changes nothing`, async () => {
      const { app, repository } = await recipeApp();
      const recipe = await seed(repository, content("Pad Thai"), { deletedAt: "2026-09-30T10:00:00.000Z" });
      const before = await storedSnapshots(repository);
      expectErrors(await change(app, "POST", `/recipes/${recipe.id.value}/${action}`), 409, ["recipe.inTrash"]);
      expect(await storedSnapshots(repository)).toEqual(before);
      expect(await toMakeList(app)).toEqual([]);
    });
  }
});
