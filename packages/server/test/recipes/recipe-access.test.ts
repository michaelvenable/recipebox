// Cross-cutting rules on the core recipe endpoints: private data (X-1), who may change (X-6) and whose clock counts (X-12).
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
  PRIVATE_FIELDS,
  change,
  content,
  createRecipe,
  expectErrors,
  get,
  recipeApp,
  seed,
  storedSnapshots,
} from "./recipe-route-helpers.js";

/** The added time of the recipe that isn't in the trash: public (REC-22). */
const ADDED = "2026-06-15T10:00:00.000Z";

/** A recipe on the to-make list with cooking history, plus one in the trash: every kind of private data there is. */
async function appWithPrivateData(): Promise<Awaited<ReturnType<typeof recipeApp>> & { id: string; trashedId: string }> {
  const setup = await recipeApp("2026-10-10T09:00:00.000Z");
  const recipe = await seed(setup.repository, content("Pad Thai", { tags: ["dinner"] }), {
    createdAt: ADDED,
    cookedAt: ["2026-08-01T18:00:00.000Z", "2026-09-01T18:00:00.000Z"],
    toMakeAt: "2026-09-20T08:00:00.000Z",
  });
  const trashed = await seed(setup.repository, content("Trashed Curry", { tags: ["secret"] }), {
    createdAt: "2026-06-20T10:00:00.000Z",
    cookedAt: ["2026-07-01T18:00:00.000Z"],
    deletedAt: "2026-10-01T08:00:00.000Z",
  });
  return { ...setup, id: recipe.id.value, trashedId: trashed.id.value };
}

/** Every public endpoint, with the schema a visitor's answer must match. */
function publicEndpoints(id: string): [string, { safeParse(v: unknown): { success: boolean } }][] {
  return [
    ["/recipes", RecipeSummary.array()],
    ["/recipes?name=pad", RecipeSummary.array()],
    ["/recipes?tags=dinner", RecipeSummary.array()],
    ["/tags", TagCount.array()],
    [`/recipes/${id}`, PublicRecipe],
  ];
}

function expectNoPrivateFields(body: string): void {
  for (const field of PRIVATE_FIELDS) expect(body).not.toContain(`"${field}"`);
  // The one public time is a listed recipe's added time (REC-22). Every other time here is private: history, to-make and
  // trash dates, and the added time of the recipe in the trash.
  const times = body.match(/\d{4}-\d{2}-\d{2}T[^"]*/g) ?? [];
  expect(times.filter((t) => t !== ADDED)).toEqual([]);
}

describe("X-1 recipes are public; the rest is private", () => {
  for (const [who, as] of [
    ["a visitor", AS_VISITOR],
    ["a signed-in non-editor", AS_NON_EDITOR],
  ] as const) {
    it(`gives ${who} only public shapes, without private fields, from every public endpoint`, async () => {
      const { app, id } = await appWithPrivateData();
      for (const [url, schema] of publicEndpoints(id)) {
        const res = await get(app, url, as);
        expect(res.statusCode, url).toBe(200);
        // The public shapes are strict, so any extra field fails parsing.
        expect(schema.safeParse(res.json()).success, url).toBe(true);
        expectNoPrivateFields(res.body);
      }
    });

    it(`hides recipes in the trash from ${who} everywhere, including their tags`, async () => {
      const { app, trashedId } = await appWithPrivateData();
      expect(res404Body(await get(app, `/recipes/${trashedId}`, as))).toEqual(
        res404Body(await get(app, "/recipes/bbbbbbbb-0000-4000-8000-000000000000", as)),
      );
      for (const url of ["/recipes", "/recipes?name=curry", "/tags"]) {
        const body = (await get(app, url, as)).body;
        expect(body).not.toContain("Trashed Curry");
        expect(body).not.toContain("secret");
      }
    });

    it(`refuses ${who} the trash`, async () => {
      const { app } = await appWithPrivateData();
      const res = await get(app, "/trash", as);
      if (as === AS_VISITOR) expectErrors(res, 401, ["auth.signInRequired"]);
      else expectErrors(res, 403, ["auth.notEditor"]);
      expect(res.body).not.toContain("Trashed Curry");
    });
  }

  it("gives an editor the editor shapes on the public endpoints", async () => {
    const { app, id } = await appWithPrivateData();

    const list = EditorRecipeSummary.array().parse((await get(app, "/recipes", AS_EDITOR)).json());
    expect(list).toEqual([
      { id, name: "Pad Thai", tags: ["dinner"], hasPhoto: false, createdAt: ADDED, onToMakeList: true },
    ]);

    const recipe = EditorRecipe.parse((await get(app, `/recipes/${id}`, AS_EDITOR)).json());
    expect(recipe).toMatchObject({
      toMake: { addedAt: "2026-09-20T08:00:00.000Z" },
      cookedAt: ["2026-09-01T18:00:00.000Z", "2026-08-01T18:00:00.000Z"],
      lastCookedAt: "2026-09-01T18:00:00.000Z",
      timesCooked: 2,
    });

    expect(TagCount.array().parse((await get(app, "/tags", AS_EDITOR)).json())).toEqual([{ tag: "dinner", count: 1 }]);
    expect(TrashEntry.array().parse((await get(app, "/trash", AS_EDITOR)).json()).map((e) => e.name)).toEqual([
      "Trashed Curry",
    ]);
  });

  it("marks every recipe response private and not storable, since it differs per caller", async () => {
    const { app, id } = await appWithPrivateData();
    const urls = [...publicEndpoints(id).map(([url]) => url), `/recipes/${id}`, "/trash"];
    for (const url of urls) {
      for (const as of [AS_VISITOR, AS_EDITOR]) {
        expect((await get(app, url, as)).headers["cache-control"], url).toBe("private, no-store");
      }
    }
    const created = await change(app, "POST", "/recipes", content("New"));
    expect(created.headers["cache-control"]).toBe("private, no-store");
  });
});

function res404Body(res: { statusCode: number; json(): unknown }): unknown {
  expect(res.statusCode).toBe(404);
  return res.json();
}

/** Every change endpoint of this task, against the recipes from appWithPrivateData. */
function changeEndpoints(
  id: string,
  trashedId: string,
): [string, "POST" | "PUT" | "DELETE", string, unknown][] {
  return [
    ["create", "POST", "/recipes", content("Intruder")],
    ["edit", "PUT", `/recipes/${id}/content`, content("Defaced")],
    ["delete", "DELETE", `/recipes/${id}`, {}],
    ["restore", "POST", `/trash/${trashedId}/restore`, {}],
  ];
}

describe("X-6 changes require sign-in", () => {
  for (const [who, as, status, code] of [
    ["a visitor", AS_VISITOR, 401, "auth.signInRequired"],
    ["a signed-in non-editor", AS_NON_EDITOR, 403, "auth.notEditor"],
  ] as const) {
    it(`refuses ${who} every change with ${status}, and changes nothing`, async () => {
      const { app, repository, id, trashedId } = await appWithPrivateData();
      const before = await storedSnapshots(repository);
      for (const [name, method, url, payload] of changeEndpoints(id, trashedId)) {
        const res = await change(app, method, url, payload, as);
        expect(res.statusCode, name).toBe(status);
        expectErrors(res, status, [code]);
      }
      expect(await storedSnapshots(repository)).toEqual(before);
    });
  }

  it("refuses before looking at the recipe: an unknown id still gets 401, not 404", async () => {
    const { app } = await recipeApp();
    const unknown = "bbbbbbbb-0000-4000-8000-000000000000";
    expectErrors(await change(app, "PUT", `/recipes/${unknown}/content`, content("X"), AS_VISITOR), 401, [
      "auth.signInRequired",
    ]);
    expectErrors(await change(app, "DELETE", `/recipes/${unknown}`, {}, AS_VISITOR), 401, ["auth.signInRequired"]);
  });

  it("lets an editor make every change", async () => {
    const { app, id, trashedId } = await appWithPrivateData();
    for (const [name, method, url, payload] of changeEndpoints(id, trashedId)) {
      const res = await change(app, method, url, payload, AS_EDITOR);
      expect(res.statusCode, name).toBeLessThan(300);
    }
  });
});

describe("X-12 every stored time comes from the server's clock", () => {
  it.each([
    ["create", "POST", "/recipes", { ...content("Pad Thai"), createdAt: "2020-01-01T00:00:00.000Z" }],
    ["edit", "PUT", "/recipes/ID/content", { ...content("Pad Thai"), cookedAt: ["2020-01-01T00:00:00.000Z"] }],
    ["delete", "DELETE", "/recipes/ID", { deletedAt: "2020-01-01T00:00:00.000Z" }],
    ["restore", "POST", "/trash/TRASHED/restore", { at: "2026-10-01T00:00:00.000Z" }],
  ] as const)("refuses a %s request that carries a time, and changes nothing", async (_name, method, url, payload) => {
    const { app, repository, id, trashedId } = await appWithPrivateData();
    const before = await storedSnapshots(repository);

    const res = await change(app, method, url.replace("TRASHED", trashedId).replace("ID", id), payload);

    const body = expectErrors(res, 400, ["request.unknownField"]);
    expect(body.errors[0]?.field).toBe(Object.keys(payload).at(-1));
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it("stores the injected clock's time when deleting, and uses it for the trash deadline", async () => {
    const { app, repository, clock } = await recipeApp();
    const created = await createRecipe(app, content("Pad Thai"));
    clock.set("2026-10-03T04:05:06.007Z");

    await change(app, "DELETE", `/recipes/${created.id}`);

    const stored = (await repository.list())[0]?.toSnapshot();
    expect(stored?.deletedAt).toBe("2026-10-03T04:05:06.007Z");
    const [entry] = TrashEntry.array().parse((await get(app, "/trash", AS_EDITOR)).json());
    expect(entry).toMatchObject({ deletedAt: "2026-10-03T04:05:06.007Z", removalDueAt: "2026-11-02T04:05:06.007Z" });
  });

  it("decides whether a restore is too late by the injected clock alone", async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"), { deletedAt: "2026-09-01T10:00:00.000Z" });
    clock.set("2026-10-01T10:00:00.000Z");
    expectErrors(await change(app, "POST", `/trash/${recipe.id.value}/restore`), 409, ["trash.expired"]);
    clock.set("2026-09-15T10:00:00.000Z");
    expect((await change(app, "POST", `/trash/${recipe.id.value}/restore`)).statusCode).toBe(200);
  });
});
