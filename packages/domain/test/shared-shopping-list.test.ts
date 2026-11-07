import { describe, expect, it } from "vitest";
import {
  Instant,
  Recipe,
  RecipeId,
  SharedShoppingList,
  type SharedShoppingListSnapshot,
  ShareToken,
  shoppingList,
  type RecipeContentInput,
} from "../src/index.js";
import { errorKeys, valueOf } from "./helpers.js";

const at = (iso: string) => valueOf(Instant.fromIso(iso));
const TOKEN = "k7Qm2xV9pR4tZ8wLa1B2c3";
const token = (raw = TOKEN) => valueOf(ShareToken.create(raw));

let nextId = 0;
function planned(name: string, content: Partial<RecipeContentInput> = {}, addedAt = "2026-10-01T12:00:00Z"): Recipe {
  nextId += 1;
  const id = valueOf(RecipeId.create(`00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`));
  const r = valueOf(Recipe.create(id, { name, ingredients: ["Something"], steps: ["Cook it."], ...content }));
  valueOf(r.addToMakeList(at(addedAt)));
  return r;
}

/** The PLAN-8 spec example: Shakshuka and Chili on the plan. */
function specExample() {
  const shakshuka = planned("Shakshuka", { ingredients: ["6 eggs", "1 can tomatoes"] }, "2026-09-01T12:00:00Z");
  const chili = planned("Chili", { ingredients: ["1 can tomatoes", "500 g beef mince"] }, "2026-10-01T12:00:00Z");
  return { shakshuka, chili, recipes: [shakshuka, chili] };
}

function sent(iso = "2026-11-07T09:00:00Z"): SharedShoppingList {
  return valueOf(SharedShoppingList.create(token(), shoppingList(specExample().recipes), at(iso)));
}

const rows = (list: SharedShoppingList) => list.items.map((i) => [i.text.value, i.recipeName.value] as const);

describe("PLAN-9 a sent shopping list works for 7 days", () => {
  it("spec example: made 2026-11-07 at 09:00, it works until 2026-11-14 at 09:00", () => {
    const list = sent("2026-11-07T09:00:00Z");
    expect(list.createdAt.toIso()).toBe("2026-11-07T09:00:00.000Z");
    expect(list.expiresAt.toIso()).toBe("2026-11-14T09:00:00.000Z");
    expect(list.isAvailable(at("2026-11-07T09:00:00Z"))).toBe(true);
    expect(list.isAvailable(at("2026-11-14T08:59:00Z"))).toBe(true);
    expect(list.isAvailable(at("2026-11-14T08:59:59.999Z"))).toBe(true);
  });

  it("spec example: at 09:00 and 09:01 on 2026-11-14 it has expired", () => {
    const list = sent("2026-11-07T09:00:00Z");
    expect(list.isAvailable(at("2026-11-14T09:00:00Z"))).toBe(false);
    expect(list.isAvailable(at("2026-11-14T09:01:00Z"))).toBe(false);
    expect(list.isAvailable(at("2027-01-01T00:00:00Z"))).toBe(false);
  });

  it("counts 7 × 24 hours of the server's clock, whatever daylight saving does locally (X-12)", () => {
    // 2026-11-01 is the end of daylight saving in the US; UTC has none.
    const list = sent("2026-10-30T09:00:00Z");
    expect(list.expiresAt.toIso()).toBe("2026-11-06T09:00:00.000Z");
  });
});

describe("PLAN-9 a sent shopping list is a copy of the shopping list as it was", () => {
  it("spec example: the same items in the same order, each with its recipe's name", () => {
    expect(rows(sent())).toEqual([
      ["1 can tomatoes", "Chili"],
      ["1 can tomatoes", "Shakshuka"],
      ["500 g beef mince", "Chili"],
      ["6 eggs", "Shakshuka"],
    ]);
  });

  it("keeps each line's recipe id, so lines of two recipes with the same name stay apart", () => {
    const { shakshuka, chili, recipes } = specExample();
    const list = valueOf(SharedShoppingList.create(token(), shoppingList(recipes), at("2026-11-07T09:00:00Z")));
    expect(list.items.map((i) => i.recipeId.value)).toEqual([chili.id.value, shakshuka.id.value, chili.id.value, shakshuka.id.value]);
  });

  it("doesn't change when the recipes or the plan change afterwards", () => {
    const { shakshuka, chili, recipes } = specExample();
    const list = valueOf(SharedShoppingList.create(token(), shoppingList(recipes), at("2026-11-07T09:00:00Z")));
    const before = list.toSnapshot();

    valueOf(chili.revise({ name: "Texas Chili", ingredients: ["2 kg beef"], steps: ["Cook."] }));
    valueOf(shakshuka.markCooked(at("2026-11-08T18:00:00Z")));
    chili.delete(at("2026-11-09T09:00:00Z"));

    expect(list.toSnapshot()).toEqual(before);
    expect(rows(list)[0]).toEqual(["1 can tomatoes", "Chili"]);
  });

  it("can't be changed through the lines it returns", () => {
    const list = sent();
    expect(() => (list.items as unknown[]).pop()).toThrow();
    expect(list.items).toHaveLength(4);
  });

  it("is refused when the plan is empty: there is nothing to send", () => {
    expect(errorKeys(SharedShoppingList.create(token(), [], at("2026-11-07T09:00:00Z")))).toEqual([
      { code: "shoppingList.empty", field: undefined },
    ]);
  });

  it("holds nothing private (X-1): no to-make dates, cooking history or anything else of the recipes", () => {
    const snapshot = sent().toSnapshot();
    expect(Object.keys(snapshot).sort()).toEqual(["createdAt", "id", "items", "schemaVersion"]);
    for (const item of snapshot.items) expect(Object.keys(item).sort()).toEqual(["recipeId", "recipeName", "text"]);
    expect(JSON.stringify(snapshot)).not.toContain("2026-09-01");
    expect(JSON.stringify(snapshot)).not.toContain("2026-10-01");
  });
});

describe("PLAN-9 link token", () => {
  it("accepts base64url of at least 22 characters (128 bits or more)", () => {
    expect(token("AAAAAAAAAAAAAAAAAAAAAA").value).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    expect(token("a-_b".repeat(8)).value).toBe("a-_b".repeat(8));
  });

  it.each([
    ["empty", ""],
    ["too short to be unguessable", "abcdefghijklmnopqrstu"],
    ["with characters outside base64url", "abcdefghijklmnopqrstu+"],
    ["with padding", "abcdefghijklmnopqrstuv=="],
    ["with a slash", "abcdefghij/lmnopqrstuvw"],
    ["with a dot", "abcdefghij.lmnopqrstuvw"],
    ["with spaces", " abcdefghijklmnopqrstuv "],
    ["absurdly long", "a".repeat(65)],
  ])("refuses a token %s", (_why, raw) => {
    expect(errorKeys(ShareToken.create(raw))).toEqual([{ code: "shareToken.invalid", field: undefined }]);
  });
});

describe("PLAN-9 shared shopping list snapshot", () => {
  it("has the documented shape", () => {
    const { shakshuka, chili } = specExample();
    const list = valueOf(SharedShoppingList.create(token(), shoppingList([shakshuka, chili]), at("2026-11-07T09:00:00Z")));
    expect(list.toSnapshot()).toEqual({
      id: TOKEN,
      items: [
        { text: "1 can tomatoes", recipeId: chili.id.value, recipeName: "Chili" },
        { text: "1 can tomatoes", recipeId: shakshuka.id.value, recipeName: "Shakshuka" },
        { text: "500 g beef mince", recipeId: chili.id.value, recipeName: "Chili" },
        { text: "6 eggs", recipeId: shakshuka.id.value, recipeName: "Shakshuka" },
      ],
      createdAt: "2026-11-07T09:00:00.000Z",
      schemaVersion: 1,
    });
  });

  it("doesn't store the expiry: it is derived from createdAt", () => {
    expect(Object.keys(sent().toSnapshot())).not.toContain("expiresAt");
  });

  it("round-trips, keeping the order and the 7 days", () => {
    const list = sent("2026-11-07T09:00:00Z");
    const restored = SharedShoppingList.fromSnapshot(list.toSnapshot());
    expect(restored.toSnapshot()).toEqual(list.toSnapshot());
    expect(restored.token.value).toBe(TOKEN);
    expect(restored.expiresAt.toIso()).toBe("2026-11-14T09:00:00.000Z");
    expect(restored.isAvailable(at("2026-11-14T08:59:00Z"))).toBe(true);
    expect(restored.isAvailable(at("2026-11-14T09:00:00Z"))).toBe(false);
  });

  it("is a copy: changing the snapshot doesn't change the list", () => {
    const list = sent();
    const snapshot = list.toSnapshot();
    snapshot.items.length = 0;
    expect(list.items).toHaveLength(4);
  });

  describe("fromSnapshot throws on invalid stored data", () => {
    const cases: [string, (s: SharedShoppingListSnapshot) => void][] = [
      ["an invalid token", (s) => (s.id = "short")],
      ["no items", (s) => (s.items = [])],
      ["a blank line", (s) => (s.items[0]!.text = "  ")],
      ["an untrimmed line", (s) => (s.items[0]!.text = " 6 eggs")],
      ["an invalid recipe id", (s) => (s.items[0]!.recipeId = "not-a-uuid")],
      ["an uppercase recipe id", (s) => (s.items[0]!.recipeId = "AAAAAAAA-0000-4000-8000-000000000001")],
      ["an empty recipe name", (s) => (s.items[0]!.recipeName = "")],
      ["an invalid createdAt", (s) => (s.createdAt = "yesterday")],
      ["a createdAt not in canonical form", (s) => (s.createdAt = "2026-11-07T09:00:00Z")],
      ["an unknown schema version", (s) => ((s as { schemaVersion: number }).schemaVersion = 2)],
    ];
    it.each(cases)("%s", (_why, spoil) => {
      const snapshot = sent().toSnapshot();
      spoil(snapshot);
      expect(() => SharedShoppingList.fromSnapshot(snapshot)).toThrow();
    });

    it("never puts the token in the error, since errors are logged", () => {
      const snapshot = sent().toSnapshot();
      snapshot.createdAt = "yesterday";
      expect(() => SharedShoppingList.fromSnapshot(snapshot)).toThrow(expect.objectContaining({ message: expect.not.stringContaining(TOKEN) }));
    });
  });
});
