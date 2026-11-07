// Cross-cutting rules on the tag, to-make and cooking endpoints: private data (X-1), who may change (X-6) and whose clock
// counts (X-12). The same checks as recipe-access.test.ts, for the endpoints added after the core routes.
import { describe, expect, it } from "vitest";
import { EditorRecipe, RediscoverEntry, ShoppingItem, Tag, ToMakeEntry } from "@recipebox/shared";
import {
  AS_EDITOR,
  AS_NON_EDITOR,
  AS_VISITOR,
  change,
  content,
  expectErrors,
  get,
  recipeApp,
  seed,
  storedSnapshots,
} from "./recipe-route-helpers.js";

const UNKNOWN_ID = "bbbbbbbb-0000-4000-8000-000000000000";

/** A recipe on the to-make list with cooking history, plus one in the trash: every kind of private data there is. */
async function appWithPrivateData(): Promise<Awaited<ReturnType<typeof recipeApp>> & { id: string; trashedId: string }> {
  const setup = await recipeApp("2026-10-10T09:00:00.000Z");
  const recipe = await seed(setup.repository, content("Pad Thai", { tags: ["dinner"] }), {
    cookedAt: ["2026-08-01T18:00:00.000Z", "2026-09-01T18:00:00.000Z"],
    toMakeAt: "2026-09-20T08:00:00.000Z",
  });
  await seed(setup.repository, content("Curry", { tags: ["spicy"] }));
  const trashed = await seed(setup.repository, content("Trashed Curry", { tags: ["secret"] }), {
    cookedAt: ["2026-07-01T18:00:00.000Z"],
    deletedAt: "2026-10-01T08:00:00.000Z",
  });
  return { ...setup, id: recipe.id.value, trashedId: trashed.id.value };
}

/** Every editor-only read of this task, with the schema an editor's answer must match. */
function editorReads(id: string): [string, { parse(v: unknown): unknown }][] {
  return [
    ["/tag-suggestions?typed=", Tag.array()],
    [`/tag-suggestions?typed=s&recipeId=${id}`, Tag.array()],
    ["/plan", ToMakeEntry.array()],
    ["/plan/shopping-list", ShoppingItem.array()],
    ["/recommendations", RediscoverEntry.array()],
  ];
}

/** Every change endpoint of this task, against the recipe from appWithPrivateData, with a valid body. */
function changeEndpoints(id: string): [string, "POST" | "DELETE", string, Record<string, unknown>][] {
  return [
    ["attach a tag", "POST", `/recipes/${id}/tags`, { tag: "quick" }],
    ["remove a tag", "DELETE", `/recipes/${id}/tags`, { tag: "dinner" }],
    ["add to the list", "POST", `/recipes/${id}/add-to-plan`, {}],
    ["remove from the list", "POST", `/recipes/${id}/remove-from-plan`, {}],
    ["mark cooked", "POST", `/recipes/${id}/cookings`, {}],
  ];
}

describe("X-1 recipes are public; the rest is private", () => {
  for (const [who, as, status, code] of [
    ["a visitor", AS_VISITOR, 401, "auth.signInRequired"],
    ["a signed-in non-editor", AS_NON_EDITOR, 403, "auth.notEditor"],
  ] as const) {
    it(`refuses ${who} the to-make and shopping lists, the recommendations and tag suggestions, revealing nothing`, async () => {
      const { app, id } = await appWithPrivateData();
      for (const [url] of editorReads(id)) {
        const res = await get(app, url, as);
        expectErrors(res, status, [code]);
        for (const leak of ["Pad Thai", "Curry", "dinner", "spicy", "secret", "2026-"]) {
          expect(res.body, url).not.toContain(leak);
        }
      }
    });

    it(`gives ${who} the same refusal for suggestions on a trashed or unknown recipe as on a live one`, async () => {
      const { app, id, trashedId } = await appWithPrivateData();
      const answers = await Promise.all(
        [id, trashedId, UNKNOWN_ID].map(async (recipeId) => {
          const res = await get(app, `/tag-suggestions?recipeId=${recipeId}`, as);
          return [res.statusCode, res.json()];
        }),
      );
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
    });
  }

  it("gives an editor the editor-only views in their shared shapes, without recipes in the trash", async () => {
    const { app, id } = await appWithPrivateData();
    for (const [url, schema] of editorReads(id)) {
      const res = await get(app, url, AS_EDITOR);
      expect(res.statusCode, url).toBe(200);
      schema.parse(res.json());
      expect(res.body, url).not.toContain("Trashed Curry");
      expect(res.body, url).not.toContain("secret");
    }
    expect(ToMakeEntry.array().parse((await get(app, "/plan", AS_EDITOR)).json())).toEqual([
      { id, name: "Pad Thai", tags: ["dinner"], hasPhoto: false, addedAt: "2026-09-20T08:00:00.000Z" },
    ]);
    // PLAN-8: only the planned recipe's ingredients, never the trashed one's.
    expect(ShoppingItem.array().parse((await get(app, "/plan/shopping-list", AS_EDITOR)).json())).toEqual([
      { text: "1 thing", recipeId: id, recipeName: "Pad Thai" },
    ]);
  });

  it("marks every response of these endpoints private and not storable", async () => {
    const { app, id } = await appWithPrivateData();
    for (const [url] of editorReads(id)) {
      for (const as of [AS_VISITOR, AS_EDITOR]) {
        expect((await get(app, url, as)).headers["cache-control"], url).toBe("private, no-store");
      }
    }
    for (const [name, method, url, body] of changeEndpoints(id)) {
      for (const as of [AS_VISITOR, AS_EDITOR]) {
        expect((await change(app, method, url, body, as)).headers["cache-control"], name).toBe("private, no-store");
      }
    }
  });
});

describe("X-6 changes require sign-in", () => {
  for (const [who, as, status, code] of [
    ["a visitor", AS_VISITOR, 401, "auth.signInRequired"],
    ["a signed-in non-editor", AS_NON_EDITOR, 403, "auth.notEditor"],
  ] as const) {
    it(`refuses ${who} every change with ${status}, and changes nothing`, async () => {
      const { app, repository, id } = await appWithPrivateData();
      const before = await storedSnapshots(repository);
      for (const [name, method, url, body] of changeEndpoints(id)) {
        const res = await change(app, method, url, body, as);
        expect(res.statusCode, name).toBe(status);
        expectErrors(res, status, [code]);
      }
      expect(await storedSnapshots(repository)).toEqual(before);
    });

    it(`refuses ${who} before looking at the recipe: trashed and unknown ids get the same ${status}`, async () => {
      const { app, id, trashedId } = await appWithPrivateData();
      for (const [name, method, url, body] of changeEndpoints(id)) {
        const live = await change(app, method, url, body, as);
        const trashed = await change(app, method, url.replace(id, trashedId), body, as);
        const unknown = await change(app, method, url.replace(id, UNKNOWN_ID), body, as);
        const malformed = await change(app, method, url.replace(id, "not-a-uuid"), body, as);
        for (const res of [trashed, unknown, malformed]) {
          expect(res.statusCode, name).toBe(status);
          expect(res.json(), name).toEqual(live.json());
        }
      }
    });
  }

  it("lets an editor make every change", async () => {
    const { app, id } = await appWithPrivateData();
    for (const [name, method, url, body] of changeEndpoints(id)) {
      const res = await change(app, method, url, body, AS_EDITOR);
      expect(res.statusCode, name).toBe(200);
      EditorRecipe.parse(res.json());
    }
  });
});

describe("X-12 every stored time comes from the server's clock", () => {
  const TIME = "2020-01-01T00:00:00.000Z";

  it.each([
    ["attach a tag", { at: TIME }],
    ["remove a tag", { removedAt: TIME }],
    ["add to the list", { addedAt: TIME }],
    ["remove from the list", { at: TIME }],
    ["mark cooked", { cookedAt: TIME }],
  ])("refuses a request to %s that carries a time, and changes nothing", async (name, payload) => {
    const { app, repository, id } = await appWithPrivateData();
    const before = await storedSnapshots(repository);
    const [, method, url, valid] = changeEndpoints(id).find(([n]) => n === name) ?? [];
    if (method === undefined || url === undefined) throw new Error(`No endpoint ${name}`);

    const body = expectErrors(await change(app, method, url, { ...valid, ...payload }), 400, ["request.unknownField"]);

    expect(body.errors[0]?.field).toBe(Object.keys(payload)[0]);
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it("refuses a body that isn't an object with 400, and changes nothing", async () => {
    const { app, repository, id } = await appWithPrivateData();
    const before = await storedSnapshots(repository);
    for (const payload of [TIME, [TIME], null]) {
      expectErrors(await change(app, "POST", `/recipes/${id}/cookings`, payload), 400, ["request.invalid"]);
    }
    expect(await storedSnapshots(repository)).toEqual(before);
  });

  it("stores the injected clock's time as the cooking time", async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    clock.set("2026-10-03T04:05:06.007Z");

    await change(app, "POST", `/recipes/${recipe.id.value}/cookings`);

    expect((await repository.get(recipe.id))?.toSnapshot().cookedAt).toEqual(["2026-10-03T04:05:06.007Z"]);
  });

  it("stores the injected clock's time as the time added to the to-make list", async () => {
    const { app, repository, clock } = await recipeApp();
    const recipe = await seed(repository, content("Pad Thai"));
    clock.set("2026-10-03T04:05:06.007Z");

    await change(app, "POST", `/recipes/${recipe.id.value}/add-to-plan`);

    expect((await repository.get(recipe.id))?.toSnapshot().toMake).toEqual({ addedAt: "2026-10-03T04:05:06.007Z" });
  });
});

describe("docs/api.md retired routes", () => {
  // The plan endpoints were renamed, GET /rediscover became GET /recommendations (COOK-6), and cooking entries can no longer
  // be deleted (COOK-5; COOK-7 withdrawn). None of the old routes may still answer.
  it.each([
    ["GET", "/to-make"],
    ["PUT", "/recipes/{id}/to-make"],
    ["DELETE", "/recipes/{id}/to-make"],
    ["DELETE", `/recipes/{id}/cookings/${encodeURIComponent("2026-09-01T18:00:00.000Z")}`],
    ["GET", "/rediscover"],
  ] as const)("answers an editor's %s %s with 404 and changes nothing", async (method, path) => {
    const { app, repository, id } = await appWithPrivateData();
    const before = await storedSnapshots(repository);
    const url = path.replace("{id}", id);
    const res = method === "GET" ? await get(app, url, AS_EDITOR) : await change(app, method, url, {}, AS_EDITOR);
    expect(res.statusCode, res.body).toBe(404);
    expect(await storedSnapshots(repository)).toEqual(before);
  });
});
