import { describe, expect, it } from "vitest";
import { Instant, orderForRediscovery, Recipe, RecipeId } from "../src/index.js";
import { valueOf } from "./helpers.js";

let nextId = 0;
const at = (iso: string) => valueOf(Instant.fromIso(iso));
function recipe(name: string, ...cooked: string[]): Recipe {
  nextId += 1;
  const id = valueOf(RecipeId.create(`00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`));
  const r = valueOf(Recipe.create(id, { name, ingredients: ["Something"], steps: ["Cook it."] }));
  for (const iso of cooked) valueOf(r.markCooked(at(iso)));
  return r;
}
const names = (recipes: readonly Recipe[]) => recipes.map((r) => r.content.name.value);

describe("COOK-6 haven't made in a while", () => {
  it("A (never), B (last 2026-01-10), C (last 2026-08-02) gives A, B, C", () => {
    const a = recipe("A");
    const b = recipe("B", "2026-01-10T18:00:00Z");
    const c = recipe("C", "2026-08-02T18:00:00Z");
    expect(names(orderForRediscovery([c, b, a]))).toEqual(["A", "B", "C"]);
  });

  it("orders by the last cooking, not the first", () => {
    const often = recipe("Often", "2025-01-01T18:00:00Z", "2026-10-01T18:00:00Z");
    const once = recipe("Once", "2026-03-01T18:00:00Z");
    expect(names(orderForRediscovery([often, once]))).toEqual(["Once", "Often"]);
  });

  it("puts never-cooked recipes first, sorted by name ignoring case and accents (X-13)", () => {
    const cooked = recipe("Apple Pie", "2020-01-01T18:00:00Z");
    const list = [recipe("Zucchini Bread"), cooked, recipe("Éclair"), recipe("apple crumble")];
    expect(names(orderForRediscovery(list))).toEqual(["apple crumble", "Éclair", "Zucchini Bread", "Apple Pie"]);
  });

  it("sorts recipes last cooked at the same time by name (domain-model.md, proposed tie rule)", () => {
    const same = "2026-05-01T18:00:00Z";
    const list = [recipe("Zucchini Bread", same), recipe("Éclair", same), recipe("apple pie", same)];
    expect(names(orderForRediscovery(list))).toEqual(["apple pie", "Éclair", "Zucchini Bread"]);
  });

  it("compares times, not dates: earlier on the same day comes first", () => {
    const evening = recipe("Evening", "2026-05-01T19:00:00Z");
    const morning = recipe("Morning", "2026-05-01T08:00:00Z");
    expect(names(orderForRediscovery([evening, morning]))).toEqual(["Morning", "Evening"]);
  });
});

describe("REC-6 deleted recipes are not in the rediscovery view", () => {
  it("skips deleted recipes, cooked or not", () => {
    const kept = recipe("Kept", "2026-01-01T18:00:00Z");
    const neverCooked = recipe("Never");
    const cooked = recipe("Cooked", "2025-01-01T18:00:00Z");
    neverCooked.delete(at("2026-10-01T12:00:00Z"));
    cooked.delete(at("2026-10-01T12:00:00Z"));
    expect(names(orderForRediscovery([neverCooked, kept, cooked]))).toEqual(["Kept"]);
  });
});

describe("orderForRediscovery doesn't change its input", () => {
  it("leaves the input array as it was and returns a new one", () => {
    const list = [recipe("C", "2026-08-02T18:00:00Z"), recipe("B", "2026-01-10T18:00:00Z"), recipe("A")];
    const before = [...list];
    const ordered = orderForRediscovery(list);
    expect(ordered).not.toBe(list);
    expect(list.every((r, i) => r === before[i])).toBe(true);
  });
});
