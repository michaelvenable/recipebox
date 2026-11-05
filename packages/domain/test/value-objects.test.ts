import { describe, expect, it } from "vitest";
import { Minutes, PhotoRef, RecipeId, RecipeName, Tag, TextEntry } from "../src/index.js";
import { errorKeys, valueOf } from "./helpers.js";

describe("RecipeId", () => {
  it("keeps a lowercase UUID unchanged", () => {
    const id = valueOf(RecipeId.create("3f2c9a8e-0b1d-4c55-9f7a-1e2d3c4b5a69"));
    expect(id.value).toBe("3f2c9a8e-0b1d-4c55-9f7a-1e2d3c4b5a69");
    expect(id.equals(valueOf(RecipeId.create("3f2c9a8e-0b1d-4c55-9f7a-1e2d3c4b5a69")))).toBe(true);
  });

  it.each(["", "   "])("rejects %j", (raw) => {
    expect(errorKeys(RecipeId.create(raw))).toEqual([{ code: "id.required", field: "id" }]);
  });

  it("accepts a UUID in upper case and stores it in lowercase", () => {
    const id = valueOf(RecipeId.create("3F2C9A8E-0B1D-4C55-9F7A-1E2D3C4B5A69"));
    expect(id.value).toBe("3f2c9a8e-0b1d-4c55-9f7a-1e2d3c4b5a69");
    expect(id.equals(valueOf(RecipeId.create("3f2c9a8e-0b1d-4c55-9f7a-1e2d3c4b5a69")))).toBe(true);
  });

  it.each([
    " a/b?c ",
    "a#b",
    "back\\slash",
    "not-a-uuid",
    " 3f2c9a8e-0b1d-4c55-9f7a-1e2d3c4b5a69 ", // surrounding whitespace
    "3f2c9a8e0b1d4c559f7a1e2d3c4b5a69", // no hyphens
    "{3f2c9a8e-0b1d-4c55-9f7a-1e2d3c4b5a69}",
    "3f2c9a8e-0b1d-4c55-9f7a-1e2d3c4b5a6", // one digit short
    "3f2c9a8e-0b1d-4c55-9f7a-1e2d3c4b5a69a", // one digit too many
    "3f2c9a8g-0b1d-4c55-9f7a-1e2d3c4b5a69", // not hex
    "3f2c9a8e-0b1d-4c55-9f7a-1e2d3c4b5a69\n",
  ])("rejects non-UUID %j", (raw) => {
    expect(errorKeys(RecipeId.create(raw))).toEqual([{ code: "id.invalid", field: "id" }]);
  });
});

describe("X-13 text", () => {
  describe("characters are counted as a person sees them", () => {
    it("a flag emoji counts as 1 character", () => {
      expect(Tag.create("🇫🇷".repeat(30)).ok).toBe(true);
      expect(Tag.create("🇫🇷".repeat(31)).ok).toBe(false);
    });

    it("a family emoji counts as 1 character", () => {
      expect(Tag.create("👨‍👩‍👧‍👦".repeat(30)).ok).toBe(true);
      expect(Tag.create("👨‍👩‍👧‍👦".repeat(31)).ok).toBe(false);
    });

    it("a name of 200 emoji is accepted and 201 rejected", () => {
      expect(RecipeName.create("🍜".repeat(200)).ok).toBe(true);
      expect(RecipeName.create("🇮🇹".repeat(200)).ok).toBe(true);
      expect(RecipeName.create("👍🏽".repeat(200)).ok).toBe(true);
      expect(errorKeys(RecipeName.create("🇮🇹".repeat(201)))).toEqual([{ code: "name.tooLong", field: "name" }]);
    });

    it("an accented letter written as letter + combining accent counts as 1 character", () => {
      expect(RecipeName.create("é".repeat(200)).ok).toBe(true);
      expect(RecipeName.create("é".repeat(201)).ok).toBe(false);
    });

    it("an entry of 1,000 emoji is accepted and 1,001 rejected", () => {
      expect(TextEntry.create("🇫🇷".repeat(1000)).ok).toBe(true);
      expect(TextEntry.create("🇫🇷".repeat(1001)).ok).toBe(false);
    });
  });

  describe("sorting and matching ignore case and accents", () => {
    it("names that differ only in accents order deterministically", () => {
      const [a, b] = ["Creme", "Crème"].map((r) => valueOf(RecipeName.create(r))) as [RecipeName, RecipeName];
      expect(RecipeName.compare(a, b)).not.toBe(0);
      expect(Math.sign(RecipeName.compare(a, b))).toBe(-Math.sign(RecipeName.compare(b, a)));
    });

    it("an accented term matches an unaccented name", () => {
      expect(valueOf(RecipeName.create("Creme Brulee")).matches("CRÈME")).toBe(true);
    });
  });

  describe("all stored text is normalized to NFC", () => {
    const precomposed = "café";
    const decomposed = "café";

    it("stores a name given in decomposed form in NFC", () => {
      expect(valueOf(RecipeName.create(`  ${decomposed} au lait `)).value).toBe(`${precomposed} au lait`);
      expect(valueOf(RecipeName.create(decomposed)).equals(valueOf(RecipeName.create(precomposed)))).toBe(true);
    });

    it("stores an ingredient or step given in decomposed form in NFC", () => {
      expect(valueOf(TextEntry.create(` 1 cup ${decomposed} `)).value).toBe(`1 cup ${precomposed}`);
    });

    it("stores a tag given in decomposed form in NFC", () => {
      expect(valueOf(Tag.create(decomposed)).value).toBe(precomposed);
      expect(valueOf(Tag.create(decomposed)).equals(valueOf(Tag.create(precomposed)))).toBe(true);
    });
  });
});

describe("REC-1 ingredient and step length", () => {
  it("accepts 1,000 characters and rejects 1,001", () => {
    expect(valueOf(TextEntry.create("a".repeat(1000))).value).toHaveLength(1000);
    expect(errorKeys(TextEntry.create("a".repeat(1001)))).toEqual([{ code: "entry.tooLong", field: undefined }]);
  });

  it("measures length after trimming", () => {
    expect(TextEntry.create(`  ${"a".repeat(1000)}  `).ok).toBe(true);
  });
});

describe("REC-1 name rules", () => {
  it("accepts 1 character", () => {
    expect(valueOf(RecipeName.create("A")).value).toBe("A");
  });

  it("accepts 200 characters and rejects 201", () => {
    expect(valueOf(RecipeName.create("a".repeat(200))).value).toHaveLength(200);
    expect(errorKeys(RecipeName.create("a".repeat(201)))).toEqual([{ code: "name.tooLong", field: "name" }]);
  });

  it("measures length after trimming", () => {
    expect(RecipeName.create(`  ${"a".repeat(200)}  `).ok).toBe(true);
  });

  it("counts characters, not UTF-16 code units", () => {
    expect(RecipeName.create("🍜".repeat(200)).ok).toBe(true);
    expect(RecipeName.create("🍜".repeat(201)).ok).toBe(false);
  });

  it.each(["", "    ", "\t\n"])("rejects empty name %j", (raw) => {
    expect(errorKeys(RecipeName.create(raw))).toEqual([{ code: "name.required", field: "name" }]);
  });
});

describe("REC-2 entry cleanup", () => {
  it('saves name "  Pad Thai " as "Pad Thai"', () => {
    expect(valueOf(RecipeName.create("  Pad Thai ")).value).toBe("Pad Thai");
  });

  it("trims a text entry", () => {
    expect(valueOf(TextEntry.create("  2 eggs\t")).value).toBe("2 eggs");
  });

  it.each(["", "   ", "\n"])("rejects blank text entry %j", (raw) => {
    expect(errorKeys(TextEntry.create(raw))).toEqual([{ code: "entry.required", field: undefined }]);
  });
});

describe("REC-8 name sorting", () => {
  const names = (...raw: string[]) => raw.map((r) => valueOf(RecipeName.create(r)));

  it("sorts case-insensitively", () => {
    const sorted = names("banana bread", "Apple Pie", "carrot cake", "Beef Stew").sort(RecipeName.compare);
    expect(sorted.map((n) => n.value)).toEqual(["Apple Pie", "banana bread", "Beef Stew", "carrot cake"]);
  });

  it("orders names that differ only in case deterministically", () => {
    const [a, b] = names("Pad Thai", "pad thai") as [RecipeName, RecipeName];
    expect(Math.sign(RecipeName.compare(a, b))).toBe(-Math.sign(RecipeName.compare(b, a)));
    expect(RecipeName.compare(a, b)).not.toBe(0);
    expect(RecipeName.compare(a, a)).toBe(0);
  });

  it('lists "Zucchini Bread", "Éclair", "apple pie" as apple pie, Éclair, Zucchini Bread (X-13)', () => {
    const sorted = names("Zucchini Bread", "Éclair", "apple pie").sort(RecipeName.compare);
    expect(sorted.map((n) => n.value)).toEqual(["apple pie", "Éclair", "Zucchini Bread"]);
  });

  it("sorts accented names among the unaccented ones (X-13)", () => {
    const sorted = names("Eggs Benedict", "Éclair", "Dal", "Fudge", "eclairs").sort(RecipeName.compare);
    expect(sorted.map((n) => n.value)).toEqual(["Dal", "Éclair", "eclairs", "Eggs Benedict", "Fudge"]);
  });

  it("gives the same order whatever the input order", () => {
    const input = ["Crème", "creme", "Creme", "crème", "CRÈME"];
    const forward = names(...input).sort(RecipeName.compare).map((n) => n.value);
    const backward = names(...[...input].reverse()).sort(RecipeName.compare).map((n) => n.value);
    expect(backward).toEqual(forward);
  });
});

describe("REC-9 search by name", () => {
  const recipes = ["Chicken Tikka", "Chickpea Curry", "Beef Stew"].map((r) => valueOf(RecipeName.create(r)));
  const search = (term: string) => recipes.filter((n) => n.matches(term)).map((n) => n.value);

  it('"chick" finds Chicken Tikka and Chickpea Curry', () => {
    expect(search("chick")).toEqual(["Chicken Tikka", "Chickpea Curry"]);
  });

  it('"TIKKA " finds Chicken Tikka (case-insensitive, term trimmed)', () => {
    expect(search("TIKKA ")).toEqual(["Chicken Tikka"]);
  });

  it("finds the term anywhere in the name", () => {
    expect(search("stew")).toEqual(["Beef Stew"]);
    expect(search("pea cu")).toEqual(["Chickpea Curry"]);
  });

  it.each(["", "   "])("empty term %j matches everything", (term) => {
    expect(search(term)).toEqual(["Chicken Tikka", "Chickpea Curry", "Beef Stew"]);
  });

  it("no match returns nothing", () => {
    expect(search("lasagne")).toEqual([]);
  });

  it('"creme" finds "Crème Brûlée" (X-13)', () => {
    const name = valueOf(RecipeName.create("Crème Brûlée"));
    expect(name.matches("creme")).toBe(true);
    expect(name.matches("BRULEE")).toBe(true);
    expect(name.matches("me bru")).toBe(true);
    expect(name.matches("cremes")).toBe(false);
  });

  it.each([
    ["smorrebrod", "Smørrebrød"],
    ["lodz", "Łódź dumplings"],
    ["duvec", "Đuveč"],
    ["aebleskiver", "Æbleskiver"],
    ["fish", "ﬁsh"], // "ﬁ" ligature
    ["STRASSE", "Straße"],
    ["creme", "Crème Brûlée"],
  ])("%j finds %j: letters fold the same way sorting treats them (X-13)", (term, name) => {
    expect(valueOf(RecipeName.create(name)).matches(term)).toBe(true);
  });

  it("matches a name whose accent is a separate combining character", () => {
    expect(valueOf(RecipeName.create("Crème")).matches("crème")).toBe(true);
  });
});

describe("REC-1 total time rules", () => {
  it.each([1, 45, 1440])("accepts %d minutes", (n) => {
    expect(valueOf(Minutes.create(n)).value).toBe(n);
  });

  it.each([0, -5, 1441])("rejects %d minutes as out of range", (n) => {
    expect(errorKeys(Minutes.create(n))).toEqual([{ code: "totalTime.outOfRange", field: "totalTimeMinutes" }]);
  });

  it.each([2.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects %d as not a whole number", (n) => {
    expect(errorKeys(Minutes.create(n))).toEqual([{ code: "totalTime.notWhole", field: "totalTimeMinutes" }]);
  });
});

describe("REC-11 tag rules", () => {
  it("trims and lowercases", () => {
    expect(valueOf(Tag.create(" Quick ")).value).toBe("quick");
    expect(valueOf(Tag.create("Dinner")).equals(valueOf(Tag.create("dinner")))).toBe(true);
  });

  it("accepts 30 characters and rejects 31, measured after trimming", () => {
    expect(Tag.create("a".repeat(30)).ok).toBe(true);
    expect(Tag.create(`  ${"a".repeat(30)}  `).ok).toBe(true);
    expect(errorKeys(Tag.create("a".repeat(31)))).toEqual([{ code: "tag.tooLong", field: "tag" }]);
  });

  it.each(["dinner, quick", "salt,pepper", ","])("rejects a tag with a comma, %j", (raw) => {
    expect(errorKeys(Tag.create(raw))).toEqual([{ code: "tag.comma", field: "tag" }]);
  });

  it.each(["", "   "])("rejects empty tag %j", (raw) => {
    expect(errorKeys(Tag.create(raw))).toEqual([{ code: "tag.required", field: "tag" }]);
  });

  it("compares alphabetically", () => {
    const tags = ["vegetarian", "Dinner", "quick"].map((t) => valueOf(Tag.create(t)));
    expect(tags.sort(Tag.compare).map((t) => t.value)).toEqual(["dinner", "quick", "vegetarian"]);
  });

  it('orders "zucchini", "épicé", "apple" as apple, épicé, zucchini (X-13)', () => {
    const tags = ["zucchini", "épicé", "apple"].map((t) => valueOf(Tag.create(t)));
    expect(tags.sort(Tag.compare).map((t) => t.value)).toEqual(["apple", "épicé", "zucchini"]);
  });

  it("measures the length of the stored tag, after trimming and lowercasing", () => {
    // "İ" lowercases to "i" + a combining dot: two code points, but still one character (X-13).
    expect(valueOf(Tag.create(`  ${"İ".repeat(30)} `)).value).toBe("i̇".repeat(30));
    expect(errorKeys(Tag.create("İ".repeat(31)))).toEqual([{ code: "tag.tooLong", field: "tag" }]);
    expect(valueOf(Tag.create(` ${"A".repeat(30)} `)).value).toBe("a".repeat(30));
  });
});

describe("REC-7 photo reference", () => {
  it("holds a blob name and content type", () => {
    const photo = valueOf(PhotoRef.create({ blobName: "recipes/abc.jpg", contentType: "image/jpeg" }));
    expect(photo.blobName).toBe("recipes/abc.jpg");
    expect(photo.contentType).toBe("image/jpeg");
  });

  it("rejects an empty blob name and content type, reporting both", () => {
    expect(errorKeys(PhotoRef.create({ blobName: "", contentType: " " }))).toEqual([
      { code: "photo.blobNameRequired", field: "photo.blobName" },
      { code: "photo.contentTypeRequired", field: "photo.contentType" },
    ]);
  });
});

describe("value objects are immutable", () => {
  it("cannot be modified after creation", () => {
    const name = valueOf(RecipeName.create("Pad Thai"));
    expect(Object.isFrozen(name)).toBe(true);
    expect(() => {
      (name as unknown as { text: string }).text = "changed";
    }).toThrow();
    expect(name.value).toBe("Pad Thai");
  });
});
