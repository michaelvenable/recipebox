// Core recipe endpoints (docs/api.md) against the in-memory repository. Rules themselves are tested in packages/domain; these
// tests show each endpoint applies them, using the examples table in docs/specs/recipes.md.
import { describe, expect, it } from "vitest";
import {
  EditorRecipe,
  EditorRecipeSummary,
  PublicRecipe,
  RecipeSummary,
  TagCount,
  TrashEntry,
} from "@recipebox/shared";
import {
  AS_EDITOR,
  AS_NON_EDITOR,
  AS_VISITOR,
  change,
  content,
  createRecipe,
  expectErrors,
  get,
  recipeApp,
  seed,
  storedSnapshots,
} from "./recipe-route-helpers.js";

const UNKNOWN_ID = "bbbbbbbb-0000-4000-8000-000000000000";
const MALFORMED_ID = "not-a-uuid";

async function listNames(app: Awaited<ReturnType<typeof recipeApp>>["app"], query = ""): Promise<string[]> {
  const res = await get(app, `/recipes${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return RecipeSummary.array().parse(res.json()).map((r) => r.name);
}

describe("REC-1 create", () => {
  it("saves a valid recipe with a server-made id and returns 201 with an EditorRecipe", async () => {
    const { app, repository } = await recipeApp();
    const created = await createRecipe(app, {
      name: "Pad Thai",
      ingredients: ["rice noodles"],
      prep: [" Soak the noodles. ", ""],
      steps: ["Soak.", "Fry."],
      totalTimeMinutes: 30,
      tags: ["dinner"],
    });

    expect(created).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Pad Thai",
      ingredients: ["rice noodles"],
      prep: ["Soak the noodles."],
      steps: ["Soak.", "Fry."],
      totalTimeMinutes: 30,
      tags: ["dinner"],
      hasPhoto: false,
      cookedAt: [],
      timesCooked: 0,
    });
    expect(Object.keys(await storedSnapshots(repository))).toEqual([created.id]);
  });

  it('saves name "  Pad Thai " as "Pad Thai"', async () => {
    const { app } = await recipeApp();
    const created = await createRecipe(app, content("  Pad Thai "));
    expect(created.name).toBe("Pad Thai");
    expect(PublicRecipe.parse((await get(app, `/recipes/${created.id}`)).json()).name).toBe("Pad Thai");
  });

  it("returns every invalid field at once with 400, and saves nothing", async () => {
    const { app, repository } = await recipeApp();
    const res = await change(app, "POST", "/recipes", {
      name: "   ",
      ingredients: ["   "],
      steps: [],
      totalTimeMinutes: 0,
      tags: ["x".repeat(31)],
    });

    const body = expectErrors(res, 400, [
      "name.required",
      "ingredients.required",
      "steps.required",
      "totalTime.outOfRange",
      "tag.tooLong",
    ]);
    expect(body.errors.map((e) => e.field)).toEqual(["name", "ingredients", "steps", "totalTimeMinutes", "tags[0]"]);
    expect(body.errors.every((e) => e.message.length > 0)).toBe(true);
    expect(await repository.list()).toEqual([]);
  });

  it.each([
    ["total time 0", { totalTimeMinutes: 0 }, "totalTimeMinutes"],
    ["total time 2.5", { totalTimeMinutes: 2.5 }, "totalTimeMinutes"],
    ["an ingredient of 1,001 characters", { ingredients: ["x".repeat(1001)] }, "ingredients[0]"],
  ])("rejects %s", async (_name, extra, field) => {
    const { app, repository } = await recipeApp();
    const res = await change(app, "POST", "/recipes", content("Pad Thai", extra));
    expect(res.statusCode).toBe(400);
    expect(expectErrorsAt(res.json())).toEqual([field]);
    expect(await repository.list()).toEqual([]);
  });

  it("refuses a malformed body with 400 ErrorResponse naming each problem, and saves nothing", async () => {
    const { app, repository } = await recipeApp();
    const res = await change(app, "POST", "/recipes", { name: 5, ingredients: "2 eggs" });
    const body = expectErrors(res, 400, ["request.invalid", "request.invalid", "request.invalid"]);
    expect(body.errors.map((e) => e.field)).toEqual(["name", "ingredients", "steps"]);
    expect(await repository.list()).toEqual([]);
  });

  it("refuses a body that is not an object with 400", async () => {
    const { app } = await recipeApp();
    expectErrors(await change(app, "POST", "/recipes", null), 400, ["request.invalid"]);
    expectErrors(await change(app, "POST", "/recipes", ["Pad Thai"]), 400, ["request.invalid"]);
  });

  it("refuses a field the shape doesn't list, such as a misspelling", async () => {
    const { app, repository } = await recipeApp();
    const res = await change(app, "POST", "/recipes", { ...content("Pad Thai"), totalTime: 20 });
    const body = expectErrors(res, 400, ["request.unknownField"]);
    expect(body.errors[0]?.field).toBe("totalTime");
    expect(await repository.list()).toEqual([]);
  });
});

function expectErrorsAt(body: unknown): (string | undefined)[] {
  return (body as { errors: { field?: string }[] }).errors.map((e) => e.field);
}

describe("REC-2 entry cleanup", () => {
  it('saves ingredients ["2 eggs", "  ", ""] as ["2 eggs"] and trims steps', async () => {
    const { app } = await recipeApp();
    const created = await createRecipe(app, content("Omelette", { ingredients: ["2 eggs", "  ", ""], steps: ["  Beat. "] }));
    expect(created.ingredients).toEqual(["2 eggs"]);
    expect(created.steps).toEqual(["Beat."]);
  });

  it('rejects ingredients ["   "]: at least 1 ingredient required', async () => {
    const { app } = await recipeApp();
    const res = await change(app, "POST", "/recipes", content("Omelette", { ingredients: ["   "] }));
    expectErrors(res, 400, ["ingredients.required"]);
  });

  it("applies to edits too (REC-5)", async () => {
    const { app } = await recipeApp();
    const created = await createRecipe(app, content("Omelette"));
    const res = await change(
      app,
      "PUT",
      `/recipes/${created.id}/content`,
      content("  Omelette ", { ingredients: ["", " 3 eggs "] }),
    );
    expect(res.statusCode, res.body).toBe(200);
    const edited = EditorRecipe.parse(res.json());
    expect(edited.name).toBe("Omelette");
    expect(edited.ingredients).toEqual(["3 eggs"]);
  });
});

describe("REC-3 order is preserved", () => {
  it("returns ingredients and steps in the order entered, after create and after an edit that reorders them", async () => {
    const { app } = await recipeApp();
    const created = await createRecipe(app, content("Soup", { ingredients: ["water", "salt", "carrots"], steps: ["B", "A"] }));
    expect(created.ingredients).toEqual(["water", "salt", "carrots"]);
    expect(created.steps).toEqual(["B", "A"]);

    const reordered = content("Soup", { ingredients: ["carrots", "water"], steps: ["A", "B"] });
    await change(app, "PUT", `/recipes/${created.id}/content`, reordered);
    const viewed = PublicRecipe.parse((await get(app, `/recipes/${created.id}`)).json());
    expect(viewed.ingredients).toEqual(["carrots", "water"]);
    expect(viewed.steps).toEqual(["A", "B"]);
  });
});

describe("REC-4 view", () => {
  it("returns all of a recipe's contents", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai", { totalTimeMinutes: 30, tags: ["dinner"] }));
    const res = await get(app, `/recipes/${recipe.id.value}`);
    expect(res.statusCode).toBe(200);
    expect(PublicRecipe.parse(res.json())).toEqual({
      id: recipe.id.value,
      name: "Pad Thai",
      ingredients: ["1 thing"],
      steps: ["Do it."],
      totalTimeMinutes: 30,
      tags: ["dinner"],
      hasPhoto: false,
    });
  });

  it("finds a recipe by its id in upper case too", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    expect((await get(app, `/recipes/${recipe.id.value.toUpperCase()}`)).statusCode).toBe(200);
  });

  it.each([
    ["an unknown id", UNKNOWN_ID],
    ["a malformed id", MALFORMED_ID],
  ])("answers %s with 404 ErrorResponse", async (_name, id) => {
    const { app } = await recipeApp();
    expectErrors(await get(app, `/recipes/${id}`), 404, ["recipe.notFound"]);
    expectErrors(await get(app, `/recipes/${id}`, AS_EDITOR), 404, ["recipe.notFound"]);
  });
});

describe("REC-21 one entry per line", () => {
  it('saves steps sent as "Boil water", two blank lines, "Add pasta" as ["Boil water", "Add pasta"]', async () => {
    const { app } = await recipeApp();
    const created = await createRecipe(app, content("Pasta", { steps: ["Boil water", "", "", "Add pasta"] }));
    expect(created.steps).toEqual(["Boil water", "Add pasta"]);
  });
});

describe("REC-11 tags typed as a comma-separated list", () => {
  it('saves tags sent as "Dinner" and "quick", from "Dinner, quick,, " in the form, as "dinner" and "quick"', async () => {
    const { app } = await recipeApp();
    const created = await createRecipe(app, content("Pasta", { tags: ["Dinner", "quick"] }));
    expect(created.tags).toEqual(["dinner", "quick"]);
  });
});

describe("REC-20 prep", () => {
  it("saves prep trimmed, without blank entries, in order, and shows it to visitors like steps", async () => {
    const { app } = await recipeApp();
    const created = await createRecipe(app, content("Curry", { prep: [" Chop the onions. ", "", "  ", "Grind spices."] }));
    expect(created.prep).toEqual(["Chop the onions.", "Grind spices."]);
    const viewed = PublicRecipe.parse((await get(app, `/recipes/${created.id}`)).json());
    expect(viewed.prep).toEqual(["Chop the onions.", "Grind spices."]);
  });

  it("accepts content without prep, from clients that don't send it, as no prep", async () => {
    const { app, repository } = await recipeApp();
    const created = await createRecipe(app, content("Curry"));
    expect(created.prep).toBeUndefined();
    expect((await storedSnapshots(repository))[created.id]).not.toHaveProperty("prep");

    const recipe = await seed(repository, content("Dal", { prep: ["Rinse the lentils."] }));
    const res = await change(app, "PUT", `/recipes/${recipe.id.value}/content`, content("Dal"));
    expect(res.json()).not.toHaveProperty("prep");
  });

  it("sends a recipe without prep with no prep key, to visitors and editors, so older clients can read it", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Toast"));
    for (const as of [AS_VISITOR, AS_EDITOR]) {
      const res = await get(app, `/recipes/${recipe.id.value}`, as);
      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty("prep");
    }
  });

  it("refuses a prep entry of 1,001 characters with its position, and saves nothing", async () => {
    const { app, repository } = await recipeApp();
    const res = await change(app, "POST", "/recipes", content("Curry", { prep: ["Chop.", "x".repeat(1001)] }));
    const body = expectErrors(res, 400, ["entry.tooLong"]);
    expect(body.errors[0]?.field).toBe("prep[1]");
    expect(await storedSnapshots(repository)).toEqual({});
  });
});

describe("REC-5 edit", () => {
  it("replaces the content and keeps to-make status and cooking history", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai", { tags: ["dinner"] }), {
      cookedAt: ["2026-09-01T18:00:00.000Z"],
      toMakeAt: "2026-09-20T08:00:00.000Z",
    });
    const res = await change(
      app,
      "PUT",
      `/recipes/${recipe.id.value}/content`,
      { name: "Pad See Ew", ingredients: ["wide noodles"], steps: ["Fry."], totalTimeMinutes: 25, tags: ["Quick"] },
    );

    expect(res.statusCode, res.body).toBe(200);
    expect(EditorRecipe.parse(res.json())).toEqual({
      id: recipe.id.value,
      name: "Pad See Ew",
      ingredients: ["wide noodles"],
      steps: ["Fry."],
      totalTimeMinutes: 25,
      tags: ["quick"],
      hasPhoto: false,
      toMake: { addedAt: "2026-09-20T08:00:00.000Z" },
      cookedAt: ["2026-09-01T18:00:00.000Z"],
      lastCookedAt: "2026-09-01T18:00:00.000Z",
      timesCooked: 1,
    });
    expect((await repository.get(recipe.id))?.content.name.value).toBe("Pad See Ew");
  });

  it("removes the total time and tags when they are left out", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai", { totalTimeMinutes: 30, tags: ["dinner"] }));
    const res = await change(app, "PUT", `/recipes/${recipe.id.value}/content`, content("Pad Thai"));
    const edited = EditorRecipe.parse(res.json());
    expect(edited.totalTimeMinutes).toBeUndefined();
    expect(edited.tags).toEqual([]);
  });

  it("returns every invalid field with 400 and changes nothing", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    const before = await storedSnapshots(repository);
    const res = await change(app, "PUT", `/recipes/${recipe.id.value}/content`, {
      name: "",
      ingredients: [],
      steps: ["ok"],
      totalTimeMinutes: 1441,
    });
    expectErrors(res, 400, ["name.required", "ingredients.required", "totalTime.outOfRange"]);
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it("refuses a malformed body with 400 and changes nothing", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    const before = await storedSnapshots(repository);
    expectErrors(await change(app, "PUT", `/recipes/${recipe.id.value}/content`, { name: "Pad Thai" }), 400, [
      "request.invalid",
      "request.invalid",
    ]);
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it.each([
    ["an unknown id", UNKNOWN_ID],
    ["a malformed id", MALFORMED_ID],
  ])("answers %s with 404", async (_name, id) => {
    const { app, repository } = await recipeApp();
    expectErrors(await change(app, "PUT", `/recipes/${id}/content`, content("Pad Thai")), 404, ["recipe.notFound"]);
    expect(await repository.list()).toEqual([]);
  });
});

describe("REC-6 delete to trash", () => {
  it("answers 204 and records the server's time as deletedAt", async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    clock.set("2026-10-05T12:34:56.789Z");

    const res = await change(app, "DELETE", `/recipes/${recipe.id.value}`);

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect((await repository.get(recipe.id))?.toSnapshot().deletedAt).toBe("2026-10-05T12:34:56.789Z");
  });

  it("makes the recipe vanish from the list, search, tag filter, counts and view, and return on restore (REC-15)", async () => {
    const { app, repository } = await recipeApp();
    const padThai = await seed(repository, content("Pad Thai", { tags: ["dinner", "thai"] }));
    await seed(repository, content("Pancakes", { tags: ["dinner"] }));

    expect(await listNames(app)).toEqual(["Pad Thai", "Pancakes"]);
    expect((await change(app, "DELETE", `/recipes/${padThai.id.value}`)).statusCode).toBe(204);

    for (const as of [{}, AS_EDITOR]) {
      expect((await get(app, "/recipes", as)).json().map((r: { name: string }) => r.name)).toEqual(["Pancakes"]);
      expect((await get(app, "/recipes?name=pad", as)).json()).toEqual([]);
      expect((await get(app, "/recipes?tags=thai", as)).json()).toEqual([]);
      expect(TagCount.array().parse((await get(app, "/tags", as)).json())).toEqual([{ tag: "dinner", count: 1 }]);
      expectErrors(await get(app, `/recipes/${padThai.id.value}`, as), 404, ["recipe.notFound"]);
    }

    expect((await change(app, "POST", `/trash/${padThai.id.value}/restore`)).statusCode).toBe(200);

    expect(await listNames(app)).toEqual(["Pad Thai", "Pancakes"]);
    expect(await listNames(app, "?name=pad")).toEqual(["Pad Thai"]);
    expect(await listNames(app, "?tags=thai")).toEqual(["Pad Thai"]);
    expect(TagCount.array().parse((await get(app, "/tags")).json())).toEqual([
      { tag: "dinner", count: 2 },
      { tag: "thai", count: 1 },
    ]);
    expect((await get(app, `/recipes/${padThai.id.value}`)).statusCode).toBe(200);
  });

  it("answers the same 404 for a recipe in the trash as for one that doesn't exist", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { deletedAt: "2026-09-30T10:00:00.000Z" });
    const trashed = await get(app, `/recipes/${recipe.id.value}`);
    const unknown = await get(app, `/recipes/${UNKNOWN_ID}`);
    expect(trashed.statusCode).toBe(404);
    expect(trashed.json()).toEqual(unknown.json());
  });

  it.each([
    ["an unknown id", UNKNOWN_ID],
    ["a malformed id", MALFORMED_ID],
  ])("answers %s with 404", async (_name, id) => {
    const { app } = await recipeApp();
    expectErrors(await change(app, "DELETE", `/recipes/${id}`), 404, ["recipe.notFound"]);
  });
});

describe("REC-8 list", () => {
  it('lists "Zucchini Bread", "Éclair", "apple pie" as apple pie, Éclair, Zucchini Bread', async () => {
    const { app, repository } = await recipeApp();
    for (const name of ["Zucchini Bread", "Éclair", "apple pie"]) await seed(repository, content(name));
    expect(await listNames(app)).toEqual(["apple pie", "Éclair", "Zucchini Bread"]);
  });

  it("returns summaries: id, name, tags, total time and whether there is a photo", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai", { totalTimeMinutes: 30, tags: ["dinner"] }));
    expect(RecipeSummary.array().parse((await get(app, "/recipes")).json())).toEqual([
      { id: recipe.id.value, name: "Pad Thai", tags: ["dinner"], totalTimeMinutes: 30, hasPhoto: false },
    ]);
  });

  it("returns an empty list when there are no recipes", async () => {
    const { app } = await recipeApp();
    expect(await listNames(app)).toEqual([]);
  });
});

describe("REC-9 search by name", () => {
  async function appWithSearchRecipes(): Promise<Awaited<ReturnType<typeof recipeApp>>> {
    const setup = await recipeApp();
    for (const name of ["Chicken Tikka", "Chickpea Curry", "Beef Stew", "Crème Brûlée"]) {
      await seed(setup.repository, content(name));
    }
    return setup;
  }

  it.each([
    ["chick", ["Chicken Tikka", "Chickpea Curry"]],
    ["TIKKA ", ["Chicken Tikka"]],
    ["creme", ["Crème Brûlée"]],
    ["", ["Beef Stew", "Chicken Tikka", "Chickpea Curry", "Crème Brûlée"]],
    ["lasagne", []],
  ])('search "%s" finds %j', async (term, expected) => {
    const { app } = await appWithSearchRecipes();
    expect(await listNames(app, `?name=${encodeURIComponent(term)}`)).toEqual(expected);
  });

  it("refuses a name given twice with 400", async () => {
    const { app } = await appWithSearchRecipes();
    expectErrors(await get(app, "/recipes?name=a&name=b"), 400, ["request.invalid"]);
  });
});

describe("REC-11 tag rules", () => {
  it('shows tags "zucchini", "épicé", "apple" on one recipe as apple, épicé, zucchini', async () => {
    const { app } = await recipeApp();
    const created = await createRecipe(app, content("Mix", { tags: ["zucchini", "épicé", "apple"] }));
    expect(created.tags).toEqual(["apple", "épicé", "zucchini"]);
    expect(PublicRecipe.parse((await get(app, `/recipes/${created.id}`)).json()).tags).toEqual(["apple", "épicé", "zucchini"]);
  });

  it('stores " Quick " and "quick" as one tag "quick"', async () => {
    const { app } = await recipeApp();
    const created = await createRecipe(app, content("Salad", { tags: ["quick", " Quick "] }));
    expect(created.tags).toEqual(["quick"]);
  });
});

describe("REC-13 filter by tags", () => {
  /** Recipes: A [dinner, quick], B [dinner], C [quick]. */
  async function appWithTaggedRecipes(): Promise<Awaited<ReturnType<typeof recipeApp>>> {
    const setup = await recipeApp();
    await seed(setup.repository, content("A", { tags: ["dinner", "quick"] }));
    await seed(setup.repository, content("B", { tags: ["dinner"] }));
    await seed(setup.repository, content("C", { tags: ["quick"] }));
    return setup;
  }

  it("lists every tag in use, alphabetically, with its count", async () => {
    const { app } = await appWithTaggedRecipes();
    const res = await get(app, "/tags");
    expect(res.statusCode).toBe(200);
    expect(TagCount.array().parse(res.json())).toEqual([
      { tag: "dinner", count: 2 },
      { tag: "quick", count: 2 },
    ]);
  });

  it.each([
    ["dinner,quick", "", ["A"]],
    ["quick,dinner", "", ["A"]],
    ["Dinner, quick", "", ["A"]],
    ["dinner", "b", ["B"]],
    ["dinner", "", ["A", "B"]],
    ["", "", ["A", "B", "C"]],
    ["breakfast", "", []],
  ])("filter %j with search %j finds %j", async (tags, name, expected) => {
    const { app } = await appWithTaggedRecipes();
    const query = `?tags=${encodeURIComponent(tags)}&name=${encodeURIComponent(name)}`;
    expect(await listNames(app, query)).toEqual(expected);
  });

  it('stops offering "quick" once it is removed from A and C', async () => {
    const { app, repository } = await appWithTaggedRecipes();
    const byName = Object.fromEntries((await repository.list()).map((r) => [r.content.name.value, r.id.value]));
    await change(app, "PUT", `/recipes/${byName.A}/content`, content("A", { tags: ["dinner"] }));
    await change(app, "PUT", `/recipes/${byName.C}/content`, content("C", { tags: [] }));

    expect(TagCount.array().parse((await get(app, "/tags")).json())).toEqual([{ tag: "dinner", count: 2 }]);
  });

  it("is public: a visitor can filter and see the tag counts (X-1)", async () => {
    const { app } = await appWithTaggedRecipes();
    expect((await get(app, "/tags")).statusCode).toBe(200);
    expect(await listNames(app, "?tags=quick")).toEqual(["A", "C"]);
  });
});

describe("REC-14 trash", () => {
  it("lists deleted recipes most recently deleted first, with deletedAt and removalDueAt", async () => {
    const { app, repository, clock } = await recipeApp();
    const older = await seed(repository, content("Older"), { deletedAt: "2026-09-25T08:00:00.000Z" });
    const newer = await seed(repository, content("Newer", { tags: ["dinner"] }), { deletedAt: "2026-09-28T08:00:00.000Z" });
    await seed(repository, content("Not deleted"));
    clock.set("2026-10-01T09:00:00.000Z");

    const res = await get(app, "/trash", AS_EDITOR);

    expect(res.statusCode).toBe(200);
    expect(TrashEntry.array().parse(res.json())).toEqual([
      {
        id: newer.id.value,
        name: "Newer",
        tags: ["dinner"],
        hasPhoto: false,
        deletedAt: "2026-09-28T08:00:00.000Z",
        removalDueAt: "2026-10-28T08:00:00.000Z",
      },
      {
        id: older.id.value,
        name: "Older",
        tags: [],
        hasPhoto: false,
        deletedAt: "2026-09-25T08:00:00.000Z",
        removalDueAt: "2026-10-25T08:00:00.000Z",
      },
    ]);
  });

  it("recipe deleted 2026-10-01, viewed 2026-10-21: removalDueAt is 30 days after deletion (10 days left)", async () => {
    const { app, repository, clock } = await recipeApp("2026-10-01T15:00:00.000Z");
    const recipe = await seed(repository, content("Pad Thai"));
    await change(app, "DELETE", `/recipes/${recipe.id.value}`);
    clock.set("2026-10-21T15:00:00.000Z");

    const [entry] = TrashEntry.array().parse((await get(app, "/trash", AS_EDITOR)).json());

    expect(entry?.deletedAt).toBe("2026-10-01T15:00:00.000Z");
    expect(entry?.removalDueAt).toBe("2026-10-31T15:00:00.000Z");
  });

  it("returns an empty list when the trash is empty", async () => {
    const { app, repository } = await recipeApp();
    await seed(repository, content("Pad Thai"));
    expect((await get(app, "/trash", AS_EDITOR)).json()).toEqual([]);
  });
});

describe("REC-15 restore", () => {
  it("returns the recipe with content, tags and history unchanged, not on the to-make list", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai", { totalTimeMinutes: 30, tags: ["dinner"] }), {
      cookedAt: ["2026-08-01T18:00:00.000Z", "2026-09-01T18:00:00.000Z"],
    });

    expect((await change(app, "DELETE", `/recipes/${recipe.id.value}`)).statusCode).toBe(204);
    const res = await change(app, "POST", `/trash/${recipe.id.value}/restore`);

    expect(res.statusCode, res.body).toBe(200);
    expect(EditorRecipe.parse(res.json())).toEqual({
      id: recipe.id.value,
      name: "Pad Thai",
      ingredients: ["1 thing"],
      steps: ["Do it."],
      totalTimeMinutes: 30,
      tags: ["dinner"],
      hasPhoto: false,
      cookedAt: ["2026-09-01T18:00:00.000Z", "2026-08-01T18:00:00.000Z"],
      lastCookedAt: "2026-09-01T18:00:00.000Z",
      timesCooked: 2,
    });
    expect((await repository.get(recipe.id))?.isDeleted).toBe(false);
    expect((await get(app, "/trash", AS_EDITOR)).json()).toEqual([]);
  });

  it('delete "Pad Thai" (on the to-make list), then restore it: restored, but not on the to-make list (PLAN-6)', async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { toMakeAt: "2026-09-30T08:00:00.000Z" });
    const before = EditorRecipeSummary.array().parse((await get(app, "/recipes", AS_EDITOR)).json());
    expect(before[0]?.onToMakeList).toBe(true);

    await change(app, "DELETE", `/recipes/${recipe.id.value}`);
    const restored = EditorRecipe.parse((await change(app, "POST", `/trash/${recipe.id.value}/restore`)).json());

    expect(restored.toMake).toBeUndefined();
    const after = EditorRecipeSummary.array().parse((await get(app, "/recipes", AS_EDITOR)).json());
    expect(after[0]?.onToMakeList).toBe(false);
  });

  it("restoring a live recipe changes nothing and returns it, still on the to-make list (docs/api.md)", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai", { tags: ["dinner"] }), {
      cookedAt: ["2026-08-01T18:00:00.000Z", "2026-09-01T18:00:00.000Z"],
      toMakeAt: "2026-09-30T08:00:00.000Z",
    });
    const before = await storedSnapshots(repository);

    const res = await change(app, "POST", `/trash/${recipe.id.value}/restore`);

    expect(res.statusCode, res.body).toBe(200);
    const restored = EditorRecipe.parse(res.json());
    expect(restored.id).toBe(recipe.id.value);
    expect(restored.toMake).toEqual({ addedAt: "2026-09-30T08:00:00.000Z" });
    expect(restored.timesCooked).toBe(2);
    expect(await storedSnapshots(repository)).toEqual(before);
    const listed = EditorRecipeSummary.array().parse((await get(app, "/recipes", AS_EDITOR)).json());
    expect(listed.map((r) => [r.id, r.onToMakeList])).toEqual([[recipe.id.value, true]]);
  });

  it.each([
    ["an unknown id", UNKNOWN_ID],
    ["a malformed id", MALFORMED_ID],
  ])("answers %s with 404", async (_name, id) => {
    const { app } = await recipeApp();
    expectErrors(await change(app, "POST", `/trash/${id}/restore`), 404, ["recipe.notFound"]);
  });
});

describe("REC-16 permanent removal", () => {
  it("refuses to restore a recipe deleted 30 days and 2 hours ago, not yet removed, with 409 trash.expired", async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { deletedAt: "2026-09-01T10:00:00.000Z" });
    clock.set("2026-10-01T12:00:00.000Z");
    const before = await storedSnapshots(repository);

    const res = await change(app, "POST", `/trash/${recipe.id.value}/restore`);

    expectErrors(res, 409, ["trash.expired"]);
    expect(await storedSnapshots(repository)).toEqual(before);
    expect(TrashEntry.array().parse((await get(app, "/trash", AS_EDITOR)).json()).map((e) => e.id)).toEqual([
      recipe.id.value,
    ]);
  });

  it("still restores a moment before the 30 days are up, measured by the server's clock", async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { deletedAt: "2026-09-01T10:00:00.000Z" });
    clock.set("2026-10-01T09:59:59.999Z");
    expect((await change(app, "POST", `/trash/${recipe.id.value}/restore`)).statusCode).toBe(200);
  });
});

describe("REC-17 trashed recipes can't be changed", () => {
  it("answers an editor's edit of a recipe in the trash with 409 recipe.inTrash, and changes nothing (docs/api.md)", async () => {
    const { app, repository } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { deletedAt: "2026-09-30T10:00:00.000Z" });
    const before = await storedSnapshots(repository);
    expectErrors(await change(app, "PUT", `/recipes/${recipe.id.value}/content`, content("Changed")), 409, [
      "recipe.inTrash",
    ]);
    expect(await storedSnapshots(repository)).toEqual(before);
    expectErrors(await get(app, `/recipes/${recipe.id.value}`, AS_EDITOR), 404, ["recipe.notFound"]);
  });

  for (const [who, as] of [
    ["a visitor", AS_VISITOR],
    ["a signed-in non-editor", AS_NON_EDITOR],
  ] as const) {
    it(`gives ${who} the same answer for an edit of a trashed recipe as of an unknown one (X-1)`, async () => {
      const { app, repository } = await recipeApp();
      const recipe = await seed(repository, content("Pad Thai"), { deletedAt: "2026-09-30T10:00:00.000Z" });
      const before = await storedSnapshots(repository);

      const trashed = await change(app, "PUT", `/recipes/${recipe.id.value}/content`, content("Changed"), as);
      const unknown = await change(app, "PUT", `/recipes/${UNKNOWN_ID}/content`, content("Changed"), as);

      expect(trashed.statusCode).toBe(unknown.statusCode);
      expect(trashed.json()).toEqual(unknown.json());
      expect([401, 403]).toContain(trashed.statusCode);
      expect(await storedSnapshots(repository)).toEqual(before);
    });
  }

  it("deleting a recipe already in the trash changes nothing and is not an error", async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { deletedAt: "2026-09-30T10:00:00.000Z" });
    const before = await storedSnapshots(repository);
    clock.set("2026-10-10T10:00:00.000Z");

    const res = await change(app, "DELETE", `/recipes/${recipe.id.value}`);

    expect(res.statusCode).toBe(204);
    expect(await storedSnapshots(repository)).toEqual(before);
  });
});
