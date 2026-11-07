import { describe, expect, it } from "vitest";
import {
  Instant,
  Recipe,
  RecipeId,
  ShareToken,
  ShoppingListLink,
  type ShoppingListLinkSnapshot,
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
function specExample(): Recipe[] {
  return [
    planned("Shakshuka", { ingredients: ["6 eggs", "1 can tomatoes"] }, "2026-09-01T12:00:00Z"),
    planned("Chili", { ingredients: ["1 can tomatoes", "500 g beef mince"] }, "2026-10-01T12:00:00Z"),
  ];
}

function made(iso = "2026-11-07T09:00:00Z"): ShoppingListLink {
  return valueOf(ShoppingListLink.create(token(), shoppingList(specExample()), at(iso)));
}

describe("PLAN-9 a shopping list link works for 7 days", () => {
  it("spec example: made 2026-11-07 at 09:00, it works until 2026-11-14 at 09:00", () => {
    const link = made("2026-11-07T09:00:00Z");
    expect(link.createdAt.toIso()).toBe("2026-11-07T09:00:00.000Z");
    expect(link.expiresAt.toIso()).toBe("2026-11-14T09:00:00.000Z");
    expect(link.isAvailable(at("2026-11-07T09:00:00Z"))).toBe(true);
    expect(link.isAvailable(at("2026-11-14T08:59:00Z"))).toBe(true);
    expect(link.isAvailable(at("2026-11-14T08:59:59.999Z"))).toBe(true);
  });

  it("spec example: at 09:00 and 09:01 on 2026-11-14 it has expired", () => {
    const link = made("2026-11-07T09:00:00Z");
    expect(link.isAvailable(at("2026-11-14T09:00:00Z"))).toBe(false);
    expect(link.isAvailable(at("2026-11-14T09:01:00Z"))).toBe(false);
    expect(link.isAvailable(at("2027-01-01T00:00:00Z"))).toBe(false);
  });

  it("counts 7 × 24 hours of the server's clock, whatever daylight saving does locally (X-12)", () => {
    // 2026-11-01 is the end of daylight saving in the US; UTC has none.
    expect(made("2026-10-30T09:00:00Z").expiresAt.toIso()).toBe("2026-11-06T09:00:00.000Z");
  });
});

describe("PLAN-9 a link is live: it keeps only its code and when it was made", () => {
  it("is refused when the plan is empty: there is nothing to send", () => {
    expect(errorKeys(ShoppingListLink.create(token(), [], at("2026-11-07T09:00:00Z")))).toEqual([
      { code: "shoppingList.empty", field: undefined },
    ]);
  });

  it("keeps none of the list: no lines, recipe names or ids, and nothing private (X-1)", () => {
    const recipes = specExample();
    const snapshot = valueOf(ShoppingListLink.create(token(), shoppingList(recipes), at("2026-11-07T09:00:00Z"))).toSnapshot();
    expect(snapshot).toEqual({ id: TOKEN, createdAt: "2026-11-07T09:00:00.000Z" });
    const stored = JSON.stringify(snapshot);
    for (const r of recipes) {
      expect(stored).not.toContain(r.id.value);
      expect(stored).not.toContain(r.content.name.value);
    }
    expect(stored).not.toContain("tomatoes");
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

describe("PLAN-9 shopping list link snapshot", () => {
  it("has the documented shape: only the code and when it was made, not the expiry", () => {
    expect(made().toSnapshot()).toEqual({ id: TOKEN, createdAt: "2026-11-07T09:00:00.000Z" });
  });

  it("round-trips, keeping the 7 days", () => {
    const link = made("2026-11-07T09:00:00Z");
    const restored = ShoppingListLink.fromSnapshot(link.toSnapshot());
    expect(restored.toSnapshot()).toEqual(link.toSnapshot());
    expect(restored.token.value).toBe(TOKEN);
    expect(restored.expiresAt.toIso()).toBe("2026-11-14T09:00:00.000Z");
    expect(restored.isAvailable(at("2026-11-14T08:59:00Z"))).toBe(true);
    expect(restored.isAvailable(at("2026-11-14T09:00:00Z"))).toBe(false);
  });

  describe("fromSnapshot throws on invalid stored data", () => {
    const cases: [string, (s: ShoppingListLinkSnapshot) => void][] = [
      ["an invalid token", (s) => (s.id = "short")],
      ["an invalid createdAt", (s) => (s.createdAt = "yesterday")],
      ["a createdAt not in canonical form", (s) => (s.createdAt = "2026-11-07T09:00:00Z")],
      ["a stored list", (s) => Object.assign(s, { items: [] })],
      ["a stored expiry", (s) => Object.assign(s, { expiresAt: "2026-11-14T09:00:00.000Z" })],
    ];
    it.each(cases)("%s", (_why, spoil) => {
      const snapshot = made().toSnapshot();
      spoil(snapshot);
      expect(() => ShoppingListLink.fromSnapshot(snapshot)).toThrow();
    });

    it("never puts the token in the error, since errors are logged", () => {
      const snapshot = made().toSnapshot();
      snapshot.createdAt = "yesterday";
      expect(() => ShoppingListLink.fromSnapshot(snapshot)).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining(TOKEN) }),
      );
    });
  });
});
