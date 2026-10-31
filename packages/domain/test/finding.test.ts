import { describe, expect, it } from "vitest";
import {
  findRecipes,
  Instant,
  Recipe,
  RecipeId,
  suggestTags,
  tagsInUse,
  trashContents,
  type RecipeContentInput,
} from "../src/index.js";
import { valueOf } from "./helpers.js";

let nextId = 0;
const at = (iso: string) => valueOf(Instant.fromIso(iso));
function recipe(name: string, tags: string[] = [], content: Partial<RecipeContentInput> = {}): Recipe {
  nextId += 1;
  const id = valueOf(RecipeId.create(`00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`));
  return valueOf(Recipe.create(id, { name, ingredients: ["Something"], steps: ["Cook it."], tags, ...content }));
}
function deleted(r: Recipe, iso = "2026-10-01T12:00:00Z"): Recipe {
  r.delete(at(iso));
  return r;
}
const names = (recipes: readonly Recipe[]) => recipes.map((r) => r.content.name.value);
const tagCounts = (entries: { tag: { value: string }; count: number }[]) =>
  entries.map((e) => [e.tag.value, e.count] as const);
const values = (tags: readonly { value: string }[]) => tags.map((t) => t.value);

/** The recipes A [dinner, quick], B [dinner], C [quick] from the REC-13 examples. */
function abc() {
  return { a: recipe("A", ["dinner", "quick"]), b: recipe("B", ["dinner"]), c: recipe("C", ["quick"]) };
}

describe("REC-8 list", () => {
  it("returns every recipe sorted by name, ignoring case and accents, when nothing is picked", () => {
    const recipes = [recipe("Zucchini Bread"), recipe("Éclair"), recipe("apple pie")];
    expect(names(findRecipes(recipes, {}))).toEqual(["apple pie", "Éclair", "Zucchini Bread"]);
  });

  it("treats an empty name and an empty tag list as nothing picked", () => {
    const recipes = [recipe("Zucchini Bread"), recipe("Éclair"), recipe("apple pie")];
    expect(names(findRecipes(recipes, { name: "", tags: [] }))).toEqual(["apple pie", "Éclair", "Zucchini Bread"]);
  });
});

describe("REC-9 search by name", () => {
  const recipes = () => [recipe("Chicken Tikka"), recipe("Chickpea Curry"), recipe("Beef Stew"), recipe("Crème Brûlée")];

  it('finds "chick" anywhere in the name', () => {
    expect(names(findRecipes(recipes(), { name: "chick" }))).toEqual(["Chicken Tikka", "Chickpea Curry"]);
  });

  it('ignores case and surrounding whitespace: "TIKKA " finds Chicken Tikka', () => {
    expect(names(findRecipes(recipes(), { name: "TIKKA " }))).toEqual(["Chicken Tikka"]);
  });

  it('ignores accents: "creme" finds Crème Brûlée', () => {
    expect(names(findRecipes(recipes(), { name: "creme" }))).toEqual(["Crème Brûlée"]);
  });

  it("finds the term in the middle of the name", () => {
    expect(names(findRecipes(recipes(), { name: "stew" }))).toEqual(["Beef Stew"]);
  });

  it("shows all recipes for a blank term", () => {
    expect(names(findRecipes(recipes(), { name: "   " }))).toEqual([
      "Beef Stew",
      "Chicken Tikka",
      "Chickpea Curry",
      "Crème Brûlée",
    ]);
  });

  it("keeps the REC-8 sort order", () => {
    const list = [recipe("chickpea Curry"), recipe("Chicken Tikka"), recipe("Éclair chick")];
    expect(names(findRecipes(list, { name: "chick" }))).toEqual(["Chicken Tikka", "chickpea Curry", "Éclair chick"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(findRecipes(recipes(), { name: "pizza" })).toEqual([]);
  });
});

describe("REC-13 filter by tags", () => {
  it("dinner + quick with A [dinner, quick], B [dinner], C [quick] gives A", () => {
    const { a, b, c } = abc();
    expect(names(findRecipes([c, b, a], { tags: ["dinner", "quick"] }))).toEqual(["A"]);
  });

  it("one picked tag gives every recipe with it, in REC-8 order", () => {
    const { a, b, c } = abc();
    expect(names(findRecipes([c, b, a], { tags: ["quick"] }))).toEqual(["A", "C"]);
  });

  it('filter "dinner" and search "b" gives B: a recipe must match both', () => {
    const { a, b, c } = abc();
    expect(names(findRecipes([a, b, c], { name: "b", tags: ["dinner"] }))).toEqual(["B"]);
  });

  it("reads picked tags like tag input: trimmed, lowercased and NFC", () => {
    const { a, b, c } = abc();
    expect(names(findRecipes([a, b, c], { tags: [" Dinner "] }))).toEqual(["A", "B"]);
    const cafe = recipe("Coffee", ["café"]); // precomposed é
    expect(names(findRecipes([cafe], { tags: ["café"] }))).toEqual(["Coffee"]); // e + combining accent
  });

  it("does not ignore accents in tags: épicé and epice are different tags (domain-model.md)", () => {
    const spicy = recipe("Curry", ["épicé"]);
    expect(findRecipes([spicy], { tags: ["epice"] })).toEqual([]);
  });

  it("treats the same tag picked twice as one", () => {
    const { a, b, c } = abc();
    expect(names(findRecipes([a, b, c], { tags: ["dinner", "Dinner"] }))).toEqual(["A", "B"]);
  });

  it("gives no recipes for a tag no recipe has", () => {
    const { a, b, c } = abc();
    expect(findRecipes([a, b, c], { tags: ["dessert"] })).toEqual([]);
  });

  it("gives no recipes for a picked text that isn't a valid tag (blank or too long), since no recipe can have it", () => {
    const { a, b, c } = abc();
    expect(findRecipes([a, b, c], { tags: ["  "] })).toEqual([]);
    expect(findRecipes([a, b, c], { tags: ["dinner", "x".repeat(31)] })).toEqual([]);
  });

  it("lists every tag in use, alphabetically, with its recipe count", () => {
    const { a, b, c } = abc();
    const spicy = recipe("Curry", ["zucchini", "épicé", "apple"]);
    expect(tagCounts(tagsInUse([a, b, c, spicy]))).toEqual([
      ["apple", 1],
      ["dinner", 2],
      ["épicé", 1],
      ["quick", 2],
      ["zucchini", 1],
    ]);
  });

  it('remove "quick" from A and C: "quick" is no longer in use', () => {
    const { a, b, c } = abc();
    valueOf(a.removeTag("quick"));
    valueOf(c.removeTag("quick"));
    expect(tagCounts(tagsInUse([a, b, c]))).toEqual([["dinner", 2]]);
  });

  it("lists no tags when no recipe has any", () => {
    expect(tagsInUse([recipe("Plain")])).toEqual([]);
    expect(tagsInUse([])).toEqual([]);
  });
});

describe("REC-12 tag suggestions", () => {
  it("offers tags used on other recipes that contain the typed text, alphabetically", () => {
    const editing = recipe("New");
    const others = [recipe("Cake", ["desserts", "baking"]), recipe("Pie", ["dessert"]), recipe("Soup", ["dinner"])];
    expect(values(suggestTags([...others, editing], editing, "des"))).toEqual(["dessert", "desserts"]);
  });

  it("matches anywhere in the tag, ignoring case, accents and surrounding whitespace (X-13)", () => {
    const editing = recipe("New");
    const others = [recipe("Curry", ["épicé"]), recipe("Cake", ["gâteau"]), recipe("Soup", ["dinner"])];
    expect(values(suggestTags(others, editing, " PICE "))).toEqual(["épicé"]);
    expect(values(suggestTags(others, editing, "ATE"))).toEqual(["gâteau"]);
  });

  it("does not offer tags the recipe already has", () => {
    const editing = recipe("New", ["dessert"]);
    const others = [recipe("Cake", ["desserts", "dessert"])];
    expect(values(suggestTags([...others, editing], editing, "dess"))).toEqual(["desserts"]);
  });

  it("offers each tag once, however many recipes have it", () => {
    const editing = recipe("New");
    const others = [recipe("Cake", ["quick"]), recipe("Pie", ["quick"])];
    expect(values(suggestTags(others, editing, "qu"))).toEqual(["quick"]);
  });

  it("only offers tags from other recipes", () => {
    const editing = recipe("New", ["quick"]);
    valueOf(editing.removeTag("quick"));
    const other = recipe("Cake", ["baking"]);
    // A stale copy of the recipe being edited (same id) still carrying a tag doesn't count as another recipe.
    const staleCopy = Recipe.fromSnapshot({ ...editing.toSnapshot(), tags: ["quick"] });
    expect(values(suggestTags([staleCopy, other], editing, "q"))).toEqual([]);
  });

  it("offers nothing when no tag contains the typed text", () => {
    const editing = recipe("New");
    expect(suggestTags([recipe("Cake", ["baking"])], editing, "zz")).toEqual([]);
  });

  it("offers every tag in use on other recipes before anything is typed", () => {
    const editing = recipe("New", ["dessert"]);
    const others = [recipe("Cake", ["baking"]), recipe("Pie", ["dessert"])];
    expect(values(suggestTags([...others, editing], editing, ""))).toEqual(["baking"]);
  });

  it("treats whitespace-only input as nothing typed", () => {
    const editing = recipe("New", ["dessert"]);
    const others = [recipe("Cake", ["baking"]), recipe("Pie", ["dessert"])];
    expect(values(suggestTags([...others, editing], editing, "   "))).toEqual(["baking"]);
  });

  it("with nothing typed, still leaves out the recipe's own tags and tags only on deleted recipes (REC-6)", () => {
    const editing = recipe("New", ["dessert", "quick"]);
    const others = [
      recipe("Cake", ["baking", "dessert"]),
      deleted(recipe("Tikka", ["spicy"])),
      deleted(recipe("Stew", ["baking"])),
    ];
    expect(values(suggestTags([...others, editing], editing, ""))).toEqual(["baking"]);
  });
});

describe("REC-6 deleted recipes disappear from everywhere else", () => {
  function collection() {
    const kept = recipe("Beef Stew", ["dinner"]);
    const gone = deleted(recipe("Chicken Tikka", ["dinner", "spicy"]));
    return { kept, gone, all: [gone, kept] };
  }

  it("are not listed, searched or filtered", () => {
    const { all } = collection();
    expect(names(findRecipes(all, {}))).toEqual(["Beef Stew"]);
    expect(findRecipes(all, { name: "tikka" })).toEqual([]);
    expect(names(findRecipes(all, { tags: ["dinner"] }))).toEqual(["Beef Stew"]);
    expect(findRecipes(all, { tags: ["spicy"] })).toEqual([]);
  });

  it("don't count towards tags in use", () => {
    const { all } = collection();
    expect(tagCounts(tagsInUse(all))).toEqual([["dinner", 1]]);
  });

  it("don't supply tag suggestions", () => {
    const { all } = collection();
    expect(suggestTags(all, recipe("New"), "sp")).toEqual([]);
  });

  it("come back everywhere once restored (REC-15)", () => {
    const { gone, all } = collection();
    valueOf(gone.restore(at("2026-10-02T12:00:00Z")));
    expect(names(findRecipes(all, { tags: ["spicy"] }))).toEqual(["Chicken Tikka"]);
    expect(tagCounts(tagsInUse(all))).toEqual([
      ["dinner", 2],
      ["spicy", 1],
    ]);
  });
});

describe("REC-14 trash", () => {
  it("contains only deleted recipes, most recently deleted first", () => {
    const older = deleted(recipe("Older"), "2026-09-01T12:00:00Z");
    const newest = deleted(recipe("Newest"), "2026-10-20T12:00:00Z");
    const middle = deleted(recipe("Middle"), "2026-10-01T12:00:00Z");
    const kept = recipe("Kept");
    expect(names(trashContents([older, kept, newest, middle]))).toEqual(["Newest", "Middle", "Older"]);
  });

  it("is empty when nothing is deleted", () => {
    expect(trashContents([recipe("Kept")])).toEqual([]);
    expect(trashContents([])).toEqual([]);
  });

  it("no longer contains a restored recipe (REC-15)", () => {
    const r = deleted(recipe("Pad Thai"));
    valueOf(r.restore(at("2026-10-02T12:00:00Z")));
    expect(trashContents([r])).toEqual([]);
  });
});

describe("collection functions don't change their input", () => {
  it("leave the input array as it was", () => {
    const list = [recipe("Zebra", ["quick"]), deleted(recipe("Apple", ["quick"])), recipe("Mango", ["dinner"])];
    const before = [...list];
    findRecipes(list, {});
    findRecipes(list, { name: "a", tags: ["quick"] });
    tagsInUse(list);
    suggestTags(list, list[0]!, "d");
    trashContents(list);
    expect(list).toEqual(before);
    expect(list.every((r, i) => r === before[i])).toBe(true);
  });

  it("return a new array even when nothing is filtered out", () => {
    const list = [recipe("Apple"), recipe("Mango")];
    expect(findRecipes(list, {})).not.toBe(list);
  });
});
