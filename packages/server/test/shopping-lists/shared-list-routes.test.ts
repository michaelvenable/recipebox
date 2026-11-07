// Sending the shopping list as a link (PLAN-9; docs/api.md) against the in-memory repositories, with the spec's example. The
// rules themselves (7 days, the copy) are tested in packages/domain; these tests show the endpoints apply them, and check
// who may send (X-6), what a visitor sees (X-1) and whose clock counts (X-12).
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ShareToken } from "@recipebox/domain";
import { ErrorResponse, SharedShoppingList, ShoppingListLink } from "@recipebox/shared";
import { SHARE_TOKEN_BYTES, randomShareToken } from "../../src/clock.js";
import { redactedUrl } from "../../src/http/request-log.js";
import { InMemoryRecipeRepository } from "../../src/recipes/in-memory-recipe-repository.js";
import { InMemorySharedListRepository } from "../../src/shopping-lists/in-memory-shared-list-repository.js";
import { appWith } from "../app-helpers.js";
import {
  AS_EDITOR,
  AS_NON_EDITOR,
  AS_VISITOR,
  JSON_HEADERS,
  PRIVATE_FIELDS,
  TestClock,
  change,
  content,
  expectErrors,
  get,
  seed,
  sequentialIds,
  storedSnapshots,
} from "../recipes/recipe-route-helpers.js";

const SENT_AT = "2026-11-07T09:00:00.000Z";
const BASE64URL_TOKEN = /^[A-Za-z0-9_-]{22,}$/;

interface SharedListTestApp {
  app: FastifyInstance;
  recipes: InMemoryRecipeRepository;
  sharedLists: InMemorySharedListRepository;
  clock: TestClock;
  newShareToken: ReturnType<typeof vi.fn<() => ShareToken>>;
}

async function sharedListApp(logger: Parameters<typeof appWith>[1] = false): Promise<SharedListTestApp> {
  const recipes = new InMemoryRecipeRepository();
  const sharedLists = new InMemorySharedListRepository();
  const clock = new TestClock(SENT_AT);
  const newShareToken = vi.fn(randomShareToken);
  const app = await appWith({}, logger, { recipes, sharedLists, clock: clock.now, newRecipeId: sequentialIds(), newShareToken });
  return { app, recipes, sharedLists, clock, newShareToken };
}

/** The PLAN-8 spec example on the plan: Shakshuka and Chili, with to-make dates that must never reach a visitor. */
async function seedSpecExample(recipes: InMemoryRecipeRepository) {
  const shakshuka = await seed(recipes, content("Shakshuka", { ingredients: ["6 eggs", "1 can tomatoes"] }), {
    toMakeAt: "2026-09-01T08:00:00.000Z",
  });
  const chili = await seed(recipes, content("Chili", { ingredients: ["1 can tomatoes", "500 g beef mince"] }), {
    toMakeAt: "2026-09-02T08:00:00.000Z",
    cookedAt: ["2026-08-15T18:00:00.000Z"],
  });
  await seed(recipes, content("Not planned", { ingredients: ["2 limes"] }));
  return { shakshuka, chili };
}

function send(app: FastifyInstance, as: Record<string, string> = AS_EDITOR, payload: unknown = {}): Promise<LightMyRequestResponse> {
  return change(app, "POST", "/plan/shopping-list/shares", payload, as);
}

async function sendLink(app: FastifyInstance): Promise<ShoppingListLink> {
  const res = await send(app);
  expect(res.statusCode, res.body).toBe(201);
  return ShoppingListLink.parse(res.json());
}

function open(app: FastifyInstance, token: string, as: Record<string, string> = AS_VISITOR): Promise<LightMyRequestResponse> {
  return get(app, `/shopping-lists/${token}`, as);
}

async function opened(app: FastifyInstance, token: string, as: Record<string, string> = AS_VISITOR): Promise<SharedShoppingList> {
  const res = await open(app, token, as);
  expect(res.statusCode, res.body).toBe(200);
  return SharedShoppingList.parse(res.json());
}

const rows = (list: SharedShoppingList) => list.items.map((i) => [i.text, i.recipeName]);

const SPEC_ROWS = [
  ["1 can tomatoes", "Chili"],
  ["1 can tomatoes", "Shakshuka"],
  ["500 g beef mince", "Chili"],
  ["6 eggs", "Shakshuka"],
];

describe("PLAN-9 sending the shopping list", () => {
  it("makes a link from the stored plan: its code, the app's path for it and when it stops working (server time, X-12)", async () => {
    const { app, recipes, sharedLists } = await sharedListApp();
    await seedSpecExample(recipes);

    const res = await send(app);

    expect(res.statusCode, res.body).toBe(201);
    const link = ShoppingListLink.parse(res.json());
    expect(link.token).toMatch(BASE64URL_TOKEN);
    expect(link.path).toBe(`/list/${link.token}`);
    expect(link.expiresAt).toBe("2026-11-14T09:00:00.000Z");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    const [stored] = sharedLists.snapshots();
    expect(stored?.id).toBe(link.token);
    expect(stored?.createdAt).toBe(SENT_AT);
  });

  it("spec example: anyone with the link sees the same items in the same order, each with its recipe's name", async () => {
    const { app, recipes } = await sharedListApp();
    const { shakshuka, chili } = await seedSpecExample(recipes);
    const link = await sendLink(app);

    const list = await opened(app, link.token);

    expect(list).toEqual({
      items: [
        { text: "1 can tomatoes", recipeId: chili.id.value, recipeName: "Chili" },
        { text: "1 can tomatoes", recipeId: shakshuka.id.value, recipeName: "Shakshuka" },
        { text: "500 g beef mince", recipeId: chili.id.value, recipeName: "Chili" },
        { text: "6 eggs", recipeId: shakshuka.id.value, recipeName: "Shakshuka" },
      ],
      expiresAt: "2026-11-14T09:00:00.000Z",
    });
  });

  it("is the list as it was when sent: later changes to the plan and the recipes don't change it", async () => {
    const { app, recipes, clock } = await sharedListApp();
    const { shakshuka, chili } = await seedSpecExample(recipes);
    const link = await sendLink(app);
    const before = await opened(app, link.token);

    clock.set("2026-11-08T10:00:00.000Z");
    await change(app, "PUT", `/recipes/${chili.id.value}/content`, { name: "Texas Chili", ingredients: ["2 kg beef"], steps: ["Cook."] });
    await change(app, "POST", `/recipes/${shakshuka.id.value}/cookings`);
    await change(app, "DELETE", `/recipes/${chili.id.value}`);
    const stew = await seed(recipes, content("Stew", { ingredients: ["beef"] }));
    await change(app, "POST", `/recipes/${stew.id.value}/add-to-plan`);

    expect(await opened(app, link.token)).toEqual(before);
    expect(rows(before)).toEqual(SPEC_ROWS);
  });

  it("makes a new link on each Send; an earlier link keeps working with the list it was sent with", async () => {
    const { app, recipes, clock } = await sharedListApp();
    const { chili } = await seedSpecExample(recipes);
    const first = await sendLink(app);
    clock.set("2026-11-08T09:00:00.000Z");
    await change(app, "POST", `/recipes/${chili.id.value}/remove-from-plan`);

    const second = await sendLink(app);

    expect(second.token).not.toBe(first.token);
    expect(second.expiresAt).toBe("2026-11-15T09:00:00.000Z");
    expect(rows(await opened(app, first.token))).toEqual(SPEC_ROWS);
    expect(rows(await opened(app, second.token))).toEqual([
      ["1 can tomatoes", "Shakshuka"],
      ["6 eggs", "Shakshuka"],
    ]);
  });

  it("refuses when the plan is empty, since there is nothing to send, and stores nothing", async () => {
    const { app, recipes, sharedLists } = await sharedListApp();
    await seed(recipes, content("Not planned"));
    await seed(recipes, content("Trashed"), { toMakeAt: "2026-09-01T08:00:00.000Z", deletedAt: "2026-09-02T08:00:00.000Z" });

    expectErrors(await send(app), 409, ["shoppingList.empty"]);
    expect(sharedLists.snapshots()).toEqual([]);
  });

  it.each([
    ["a list of its own", { items: [{ text: "caviar", recipeId: "x", recipeName: "x" }] }],
    ["a token of its own", { token: "AAAAAAAAAAAAAAAAAAAAAAAA" }],
    ["a time (X-12)", { createdAt: "2030-01-01T00:00:00.000Z" }],
  ])("never stores anything sent by the client: a body with %s is refused", async (_what, payload) => {
    const { app, recipes, sharedLists } = await sharedListApp();
    await seedSpecExample(recipes);
    const res = await send(app, AS_EDITOR, payload);
    expect(res.statusCode, res.body).toBe(400);
    expect(sharedLists.snapshots()).toEqual([]);
  });

  it("is refused without a JSON body (CSRF, docs/architecture.md)", async () => {
    const { app, recipes, sharedLists } = await sharedListApp();
    await seedSpecExample(recipes);
    const res = await app.inject({
      method: "POST",
      url: "/plan/shopping-list/shares",
      headers: { ...AS_EDITOR, "content-type": "application/x-www-form-urlencoded" },
      payload: "",
    });
    expect(res.statusCode).toBe(415);
    expect(sharedLists.snapshots()).toEqual([]);
  });

  it("changes no recipe", async () => {
    const { app, recipes } = await sharedListApp();
    await seedSpecExample(recipes);
    const before = await storedSnapshots(recipes);
    await sendLink(app);
    expect(await storedSnapshots(recipes)).toEqual(before);
  });
});

describe("X-6 only editors can send the shopping list (PLAN-9)", () => {
  it.each([
    ["a visitor", AS_VISITOR, 401, "auth.signInRequired"],
    ["a signed-in non-editor", AS_NON_EDITOR, 403, "auth.notEditor"],
  ] as const)("refuses %s, stores nothing and makes no link", async (_who, as, status, code) => {
    const { app, recipes, sharedLists, newShareToken } = await sharedListApp();
    await seedSpecExample(recipes);

    const res = await send(app, as);

    expectErrors(res, status, [code]);
    expect(res.body).not.toContain("tomatoes");
    expect(sharedLists.snapshots()).toEqual([]);
    expect(newShareToken).not.toHaveBeenCalled();
  });
});

describe("PLAN-9 opening a link", () => {
  it("works without signing in, and is the same for visitors, non-editors and editors", async () => {
    const { app, recipes } = await sharedListApp();
    await seedSpecExample(recipes);
    const link = await sendLink(app);

    const asVisitor = await open(app, link.token, AS_VISITOR);
    expect(asVisitor.statusCode, asVisitor.body).toBe(200);
    expect((await open(app, link.token, AS_NON_EDITOR)).body).toBe(asVisitor.body);
    expect((await open(app, link.token, AS_EDITOR)).body).toBe(asVisitor.body);
  });

  it("shows nothing else that is private (X-1): no to-make or cooking dates, no creation time, no code", async () => {
    const { app, recipes } = await sharedListApp();
    await seedSpecExample(recipes);
    const link = await sendLink(app);

    const res = await open(app, link.token);
    const body = res.json() as Record<string, unknown> & { items: Record<string, unknown>[] };

    expect(Object.keys(body).sort()).toEqual(["expiresAt", "items"]);
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(["recipeId", "recipeName", "text"]);
    for (const field of [...PRIVATE_FIELDS, "addedAt", "createdAt", "token"]) expect(res.body).not.toContain(`"${field}"`);
    for (const date of ["2026-09-01", "2026-09-02", "2026-08-15", "2026-11-07"]) expect(res.body).not.toContain(date);
    expect(res.body).not.toContain(link.token);
    expect(res.body).not.toContain("2 limes");
  });

  it("spec example: a link made 2026-11-07 at 09:00 works at 2026-11-14 08:59, by the server's clock (X-12)", async () => {
    const { app, recipes, clock } = await sharedListApp();
    await seedSpecExample(recipes);
    const link = await sendLink(app);

    clock.set("2026-11-14T08:59:59.999Z");
    expect(rows(await opened(app, link.token))).toEqual(SPEC_ROWS);
  });

  describe("one and the same 404 for an expired, unknown or malformed link", () => {
    async function answers() {
      const { app, recipes, clock } = await sharedListApp();
      await seedSpecExample(recipes);
      const link = await sendLink(app);
      const unknown = randomShareToken().value;
      const answer = async (token: string) => {
        const res = await open(app, token);
        return { status: res.statusCode, body: res.body, type: res.headers["content-type"], cache: res.headers["cache-control"] };
      };
      return { link, clock, unknown, answer };
    }

    it("spec example: expired at 2026-11-14 09:00 and at 09:01, exactly as for a link that never existed", async () => {
      const { link, clock, unknown, answer } = await answers();
      const neverExisted = await answer(unknown);
      expect(neverExisted.status).toBe(404);
      expect(ErrorResponse.parse(JSON.parse(neverExisted.body)).errors.map((e) => e.code)).toEqual(["sharedList.notFound"]);

      for (const now of ["2026-11-14T09:00:00.000Z", "2026-11-14T09:01:00.000Z", "2027-02-01T00:00:00.000Z"]) {
        clock.set(now);
        expect(await answer(link.token), now).toEqual(neverExisted);
      }
    });

    it.each([
      ["too short", "abc"],
      ["with a character outside base64url", "abcdefghijklmnopqrstu%2B"],
      ["with a dot", "abcdefghij.klmnopqrstuvwxyz"],
      ["too long", "a".repeat(65)],
      ["an encoded slash", "abcdefghijk%2Flmnopqrstuvw"],
    ])("for a malformed link (%s), exactly as for one that never existed", async (_what, token) => {
      const { unknown, answer } = await answers();
      expect(await answer(token)).toEqual(await answer(unknown));
    });

    it("for a link with different letter case, since codes are case-sensitive", async () => {
      const { link, unknown, answer } = await answers();
      const swapped = [...link.token].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join("");
      expect(await answer(swapped)).toEqual(await answer(unknown));
    });
  });

  it("is never cached, and the page it leads to never passes the address on (no-store, no-referrer)", async () => {
    const { app, recipes, clock } = await sharedListApp();
    await seedSpecExample(recipes);
    const link = await sendLink(app);

    const ok = await open(app, link.token);
    const unknown = await open(app, randomShareToken().value);
    const malformed = await open(app, "x");
    clock.set("2026-12-01T00:00:00.000Z");
    const expired = await open(app, link.token);

    for (const [res, status] of [[ok, 200], [unknown, 404], [malformed, 404], [expired, 404]] as const) {
      expect(res.statusCode).toBe(status);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
    }
  });

  it("changes nothing that is stored", async () => {
    const { app, recipes, sharedLists } = await sharedListApp();
    await seedSpecExample(recipes);
    const link = await sendLink(app);
    const recipesBefore = await storedSnapshots(recipes);
    const listsBefore = sharedLists.snapshots();
    await open(app, link.token);
    expect(await storedSnapshots(recipes)).toEqual(recipesBefore);
    expect(sharedLists.snapshots()).toEqual(listsBefore);
  });
});

describe("PLAN-9 link codes can't be guessed", () => {
  it(`are ${SHARE_TOKEN_BYTES * 8} random bits, base64url, from the secure random source`, () => {
    expect(SHARE_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(128);
    const tokens = Array.from({ length: 2000 }, () => randomShareToken().value);
    for (const token of tokens) {
      expect(token).toMatch(BASE64URL_TOKEN);
      expect(Buffer.from(token, "base64url")).toHaveLength(SHARE_TOKEN_BYTES);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("are new on every Send, made by the server", async () => {
    const { app, recipes, newShareToken } = await sharedListApp();
    await seedSpecExample(recipes);
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i++) tokens.add((await sendLink(app)).token);
    expect(tokens.size).toBe(20);
    expect(newShareToken).toHaveBeenCalledTimes(20);
  });
});

describe("PLAN-9 link codes never reach the logs", () => {
  it("redacts the code from the request log, whether the link works or not", async () => {
    const lines: string[] = [];
    const { app, recipes } = await sharedListApp({ stream: { write: (line: string) => void lines.push(line) } });
    await seedSpecExample(recipes);
    const link = await sendLink(app);
    const unknown = randomShareToken().value;

    expect((await open(app, link.token)).statusCode).toBe(200);
    expect((await open(app, `${unknown}?a=b`)).statusCode).toBe(404);

    const all = lines.join("\n");
    expect(all).not.toContain(link.token);
    expect(all).not.toContain(unknown);
    const urls = lines.map((line) => (JSON.parse(line) as { req?: { url?: string } }).req?.url).filter((url) => url !== undefined);
    expect(urls).toContain("/shopping-lists/[redacted]");
    expect(urls).toContain("/plan/shopping-list/shares");
  });

  it.each([
    ["/shopping-lists/abc", "/shopping-lists/[redacted]"],
    ["/shopping-lists/abc?x=1#y", "/shopping-lists/[redacted]"],
    ["/shopping-lists/abc/def", "/shopping-lists/[redacted]"],
    ["/plan/shopping-list", "/plan/shopping-list"],
    ["/recipes?name=shopping-lists", "/recipes?name=shopping-lists"],
  ])("logs %s as %s", (url, logged) => {
    expect(redactedUrl(url)).toBe(logged);
  });

  it("keeps the other request details the default log has, but no headers", async () => {
    const lines: string[] = [];
    const { app } = await sharedListApp({ stream: { write: (line: string) => void lines.push(line) } });
    await app.inject({ method: "GET", url: "/health", headers: { ...JSON_HEADERS, cookie: "AppServiceAuthSession=secret" } });
    const req = lines.map((line) => (JSON.parse(line) as { req?: Record<string, unknown> }).req).find((r) => r !== undefined);
    expect(req).toMatchObject({ method: "GET", url: "/health" });
    expect(lines.join("\n")).not.toContain("secret");
  });
});
