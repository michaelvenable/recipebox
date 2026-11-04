import { describe, expect, it } from "vitest";
import {
  Instant,
  PhotoRef,
  Recipe,
  RecipeId,
  type RecipeContentInput,
  type RecipeSnapshot,
  type Result,
} from "../src/index.js";
import { errorKeys, valueOf } from "./helpers.js";

const ID = "3f2a1c9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const padThai: RecipeContentInput = {
  name: "Pad Thai",
  ingredients: ["200 g rice noodles", "2 eggs"],
  steps: ["Soak the noodles.", "Fry everything."],
};

const at = (iso: string) => valueOf(Instant.fromIso(iso));
const photo = (blobName: string) => valueOf(PhotoRef.create({ blobName, contentType: "image/jpeg" }));
const recipe = (content: Partial<RecipeContentInput> = {}) =>
  valueOf(Recipe.create(valueOf(RecipeId.create(ID)), { ...padThai, ...content }));
const tagNames = (r: Recipe) => r.tags.map((t) => t.value);
const isoList = (instants: readonly Instant[]) => instants.map((i) => i.toIso());
const twentyTags = Array.from({ length: 20 }, (_, i) => `tag${String(i).padStart(2, "0")}`);

/** A recipe with everything set, to check what changes leave alone. */
function fullRecipe(): Recipe {
  const r = recipe({ tags: ["dinner", "quick"], totalTimeMinutes: 30 });
  valueOf(r.setPhoto(photo("pad-thai.jpg")));
  valueOf(r.markCooked(at("2026-09-01T18:00:00Z")));
  valueOf(r.markCooked(at("2026-10-15T18:00:00Z")));
  valueOf(r.addToMakeList(at("2026-10-20T08:00:00Z")));
  return r;
}

describe("Recipe.create", () => {
  it("creates a recipe with validated content and nothing else", () => {
    const r = recipe({ name: "  Pad Thai " });
    expect(r.id.value).toBe(ID);
    expect(r.content.name.value).toBe("Pad Thai");
    expect(r.photo).toBeUndefined();
    expect(r.isOnMakeList).toBe(false);
    expect(r.cookedAt).toEqual([]);
    expect(r.isDeleted).toBe(false);
  });

  it("returns every content error and creates nothing", () => {
    const result = Recipe.create(valueOf(RecipeId.create(ID)), { name: " ", ingredients: ["   "], steps: ["Boil."] });
    expect(errorKeys(result)).toEqual([
      { code: "name.required", field: "name" },
      { code: "ingredients.required", field: "ingredients" },
    ]);
  });
});

describe("REC-5 edit", () => {
  it("replaces all content, including reordering and tags", () => {
    const r = fullRecipe();
    valueOf(
      r.revise({
        name: "Pad See Ew",
        ingredients: ["2 eggs", "  ", "wide noodles"],
        steps: ["Fry.", "Serve."],
        tags: ["Noodles"],
      }),
    );
    expect(r.content.name.value).toBe("Pad See Ew");
    expect(r.content.ingredients.map((e) => e.value)).toEqual(["2 eggs", "wide noodles"]);
    expect(r.content.steps.map((e) => e.value)).toEqual(["Fry.", "Serve."]);
    expect(r.content.totalTime).toBeUndefined();
    expect(tagNames(r)).toEqual(["noodles"]);
  });

  it("never touches photo, to-make status or history", () => {
    const r = fullRecipe();
    valueOf(r.revise({ ...padThai, name: "Pad See Ew" }));
    expect(r.photo?.blobName).toBe("pad-thai.jpg");
    expect(r.addedToMakeListAt?.toIso()).toBe("2026-10-20T08:00:00.000Z");
    expect(r.timesCooked).toBe(2);
  });

  it("applies the REC-1 rules and leaves the recipe unchanged when invalid", () => {
    const r = fullRecipe();
    const before = r.toSnapshot();
    const result = r.revise({ ...padThai, ingredients: ["   "], totalTimeMinutes: 0 });
    expect(errorKeys(result).map((e) => e.code)).toEqual(["ingredients.required", "totalTime.outOfRange"]);
    expect(r.toSnapshot()).toEqual(before);
  });
});

describe("REC-6 delete to trash", () => {
  it("marks the recipe deleted and records when", () => {
    const r = recipe();
    r.delete(at("2026-10-01T09:00:00Z"));
    expect(r.isDeleted).toBe(true);
    expect(r.deletedAt?.toIso()).toBe("2026-10-01T09:00:00.000Z");
  });

  it("clears to-make status but nothing else (PLAN-6)", () => {
    const r = fullRecipe();
    r.delete(at("2026-10-21T09:00:00Z"));
    expect(r.isOnMakeList).toBe(false);
    expect(r.addedToMakeListAt).toBeUndefined();
    expect(r.photo?.blobName).toBe("pad-thai.jpg");
    expect(tagNames(r)).toEqual(["dinner", "quick"]);
    expect(r.timesCooked).toBe(2);
    expect(r.content.totalTime?.value).toBe(30);
  });

  it("does nothing when already deleted, keeping the first deletion time", () => {
    const r = recipe();
    r.delete(at("2026-10-01T09:00:00Z"));
    r.delete(at("2026-10-05T09:00:00Z"));
    expect(r.deletedAt?.toIso()).toBe("2026-10-01T09:00:00.000Z");
  });
});

describe("REC-7 photo", () => {
  it("adding a photo replaces nothing", () => {
    const r = recipe();
    expect(valueOf(r.setPhoto(photo("a.jpg")))).toEqual({});
    expect(r.photo?.blobName).toBe("a.jpg");
  });

  it("replacing a photo returns the previous one so its blob can be deleted", () => {
    const r = recipe();
    valueOf(r.setPhoto(photo("a.jpg")));
    const { replaced } = valueOf(r.setPhoto(photo("b.jpg")));
    expect(replaced?.blobName).toBe("a.jpg");
    expect(r.photo?.blobName).toBe("b.jpg");
  });

  it("setting the same photo again reports nothing replaced, so the current blob isn't deleted", () => {
    const r = recipe();
    valueOf(r.setPhoto(photo("a.jpg")));
    expect(valueOf(r.setPhoto(photo("a.jpg")))).toEqual({});
    expect(r.photo?.blobName).toBe("a.jpg");
  });

  it("removing a photo returns the removed one", () => {
    const r = recipe();
    valueOf(r.setPhoto(photo("a.jpg")));
    const { removed } = valueOf(r.removePhoto());
    expect(removed?.blobName).toBe("a.jpg");
    expect(r.photo).toBeUndefined();
  });

  it("removing when there is no photo removes nothing", () => {
    expect(valueOf(recipe().removePhoto())).toEqual({});
  });
});

describe("REC-10 tags", () => {
  it("attaches a new tag", () => {
    const r = recipe();
    valueOf(r.attachTag("dinner"));
    expect(tagNames(r)).toEqual(["dinner"]);
  });

  it("removes an attached tag, whatever its case", () => {
    const r = recipe({ tags: ["dinner", "quick"] });
    valueOf(r.removeTag(" Quick "));
    expect(tagNames(r)).toEqual(["dinner"]);
  });

  it("removing a tag that isn't attached does nothing", () => {
    const r = recipe({ tags: ["dinner"] });
    const before = r.toSnapshot();
    expect(r.removeTag("quick").ok).toBe(true);
    expect(r.removeTag("   ").ok).toBe(true);
    expect(r.toSnapshot()).toEqual(before);
  });

  it("changing tags keeps the rest of the content", () => {
    const r = recipe({ totalTimeMinutes: 30 });
    valueOf(r.attachTag("dinner"));
    valueOf(r.removeTag("dinner"));
    expect(r.content.name.value).toBe("Pad Thai");
    expect(r.content.ingredients.map((e) => e.value)).toEqual(padThai.ingredients);
    expect(r.content.steps.map((e) => e.value)).toEqual(padThai.steps);
    expect(r.content.totalTime?.value).toBe(30);
  });
});

describe("REC-11 tag rules", () => {
  it('attaching " Quick " to a recipe tagged "quick" changes nothing', () => {
    const r = recipe({ tags: ["quick"] });
    expect(r.attachTag(" Quick ").ok).toBe(true);
    expect(tagNames(r)).toEqual(["quick"]);
  });

  it('attaching "quick" to a recipe that has 20 tags including "quick": no change, no error', () => {
    const tags = [...twentyTags.slice(0, 19), "quick"];
    const r = recipe({ tags });
    const before = r.toSnapshot();
    expect(r.attachTag("quick").ok).toBe(true);
    expect(r.toSnapshot()).toEqual(before);
  });

  it("refuses a 21st tag and leaves the recipe unchanged", () => {
    const r = recipe({ tags: twentyTags });
    const before = r.toSnapshot();
    expect(errorKeys(r.attachTag("dinner"))).toEqual([{ code: "tags.tooMany", field: "tags" }]);
    expect(r.toSnapshot()).toEqual(before);
  });

  it("accepts a 20th tag", () => {
    const r = recipe({ tags: twentyTags.slice(0, 19) });
    valueOf(r.attachTag("dinner"));
    expect(r.tags).toHaveLength(20);
  });

  it("refuses invalid tags", () => {
    const r = recipe();
    expect(errorKeys(r.attachTag("   "))).toEqual([{ code: "tag.required", field: "tag" }]);
    expect(errorKeys(r.attachTag("x".repeat(31)))).toEqual([{ code: "tag.tooLong", field: "tag" }]);
    expect(r.tags).toEqual([]);
  });

  it("stores tags lowercased", () => {
    const r = recipe();
    valueOf(r.attachTag("Dinner"));
    expect(tagNames(r)).toEqual(["dinner"]);
  });

  it('tags "zucchini", "épicé", "apple" are shown as apple, épicé, zucchini', () => {
    const r = recipe();
    for (const t of ["zucchini", "épicé", "apple"]) valueOf(r.attachTag(t));
    expect(tagNames(r)).toEqual(["apple", "épicé", "zucchini"]);
  });
});

describe("REC-14 trash", () => {
  it("is not deleted and has no deletion time or removal date until deleted", () => {
    const r = recipe();
    expect(r.deletedAt).toBeUndefined();
    expect(r.removalDueAt()).toBeUndefined();
  });

  it("removal is due 30 days after deletion (deleted 2026-10-01: 10 days left on 2026-10-21)", () => {
    const r = recipe();
    r.delete(at("2026-10-01T09:00:00Z"));
    expect(r.removalDueAt()?.toIso()).toBe("2026-10-31T09:00:00.000Z");
    const today = at("2026-10-21T09:00:00Z");
    const msLeft = r.removalDueAt()!.epochMillis - today.epochMillis;
    expect(msLeft / (24 * 60 * 60 * 1000)).toBe(10);
  });
});

describe("REC-15 restore", () => {
  it('delete "Pad Thai" (on the to-make list), then restore it: restored, but not on the list', () => {
    const r = recipe();
    valueOf(r.addToMakeList(at("2026-10-20T08:00:00Z")));
    r.delete(at("2026-10-21T09:00:00Z"));
    valueOf(r.restore(at("2026-10-21T09:00:05Z")));
    expect(r.isDeleted).toBe(false);
    expect(r.deletedAt).toBeUndefined();
    expect(r.removalDueAt()).toBeUndefined();
    expect(r.isOnMakeList).toBe(false);
  });

  it("returns with content, photo, tags and history unchanged", () => {
    const r = fullRecipe();
    const before = r.toSnapshot();
    r.delete(at("2026-10-21T09:00:00Z"));
    valueOf(r.restore(at("2026-10-25T09:00:00Z")));
    const { toMake, ...rest } = before;
    expect(toMake).toBeDefined();
    expect(r.toSnapshot()).toEqual(rest);
  });

  it("can be added to the list again after restoring (PLAN-6)", () => {
    const r = recipe();
    r.delete(at("2026-10-21T09:00:00Z"));
    valueOf(r.restore(at("2026-10-22T09:00:00Z")));
    valueOf(r.addToMakeList(at("2026-10-22T10:00:00Z")));
    expect(r.isOnMakeList).toBe(true);
  });

  it("does nothing when the recipe isn't deleted", () => {
    const r = fullRecipe();
    const before = r.toSnapshot();
    expect(r.restore(at("2026-10-25T09:00:00Z")).ok).toBe(true);
    expect(r.toSnapshot()).toEqual(before);
  });
});

describe("REC-16 permanent removal", () => {
  const deleted = () => {
    const r = recipe();
    r.delete(at("2026-10-01T09:00:00Z"));
    return r;
  };

  it("a recipe deleted 30 days and 2 hours ago can no longer be restored", () => {
    const r = deleted();
    expect(errorKeys(r.restore(at("2026-10-31T11:00:00Z")))).toEqual([{ code: "trash.expired", field: undefined }]);
    expect(r.isDeleted).toBe(true);
    expect(r.deletedAt?.toIso()).toBe("2026-10-01T09:00:00.000Z");
  });

  it("refuses restoring exactly at the removal time", () => {
    expect(errorKeys(deleted().restore(at("2026-10-31T09:00:00Z")))).toEqual([
      { code: "trash.expired", field: undefined },
    ]);
  });

  it("allows restoring one millisecond before the removal time", () => {
    const r = deleted();
    valueOf(r.restore(at("2026-10-31T08:59:59.999Z")));
    expect(r.isDeleted).toBe(false);
  });
});

describe("REC-17 trashed recipes can't be changed", () => {
  const changes: [string, (r: Recipe) => Result<unknown>][] = [
    ["revise", (r) => r.revise({ ...padThai, name: "Pad See Ew" })],
    ["setPhoto", (r) => r.setPhoto(photo("new.jpg"))],
    ["removePhoto", (r) => r.removePhoto()],
    ["attachTag (new)", (r) => r.attachTag("vegetarian")],
    ["attachTag (already attached)", (r) => r.attachTag("dinner")],
    ["removeTag (attached)", (r) => r.removeTag("dinner")],
    ["removeTag (not attached)", (r) => r.removeTag("vegetarian")],
    ["addToMakeList", (r) => r.addToMakeList(at("2026-10-22T09:00:00Z"))],
    ["removeFromMakeList", (r) => r.removeFromMakeList()],
    ["markCooked", (r) => r.markCooked(at("2026-10-22T09:00:00Z"))],
  ];

  it.each(changes)("%s fails with recipe.inTrash and changes nothing", (_, change) => {
    const r = fullRecipe();
    r.delete(at("2026-10-21T09:00:00Z"));
    const before = r.toSnapshot();
    const result = change(r);
    expect(errorKeys(result)).toEqual([{ code: "recipe.inTrash", field: undefined }]);
    expect(r.toSnapshot()).toEqual(before);
  });

  it("restore still works on a trashed recipe", () => {
    const r = fullRecipe();
    r.delete(at("2026-10-21T09:00:00Z"));
    expect(r.restore(at("2026-10-22T09:00:00Z")).ok).toBe(true);
  });
});

describe("PLAN-1 add", () => {
  it("adds the recipe to the to-make list with the time it was added", () => {
    const r = recipe();
    expect(r.isOnMakeList).toBe(false);
    valueOf(r.addToMakeList(at("2026-10-20T08:00:00Z")));
    expect(r.isOnMakeList).toBe(true);
    expect(r.addedToMakeListAt?.toIso()).toBe("2026-10-20T08:00:00.000Z");
  });
});

describe("PLAN-2 no duplicates", () => {
  it('add "Pad Thai" twice: appears once, keeping the original added time', () => {
    const r = recipe();
    valueOf(r.addToMakeList(at("2026-10-20T08:00:00Z")));
    expect(r.addToMakeList(at("2026-10-21T08:00:00Z")).ok).toBe(true);
    expect(r.isOnMakeList).toBe(true);
    expect(r.addedToMakeListAt?.toIso()).toBe("2026-10-20T08:00:00.000Z");
  });
});

describe("PLAN-4 remove", () => {
  it('remove "Pad Thai" from the list: recipe and its history unchanged', () => {
    const r = fullRecipe();
    const { toMake, ...rest } = r.toSnapshot();
    expect(toMake).toBeDefined();
    valueOf(r.removeFromMakeList());
    expect(r.isOnMakeList).toBe(false);
    expect(r.addedToMakeListAt).toBeUndefined();
    expect(r.toSnapshot()).toEqual(rest);
  });

  it("does nothing when the recipe isn't on the list", () => {
    const r = recipe();
    expect(r.removeFromMakeList().ok).toBe(true);
    expect(r.isOnMakeList).toBe(false);
  });
});

describe("PLAN-5 cooked recipes leave the list", () => {
  it('"Pad Thai" on the list, mark it cooked: removed from the list; cooked date recorded', () => {
    const r = recipe();
    valueOf(r.addToMakeList(at("2026-10-20T08:00:00Z")));
    valueOf(r.markCooked(at("2026-10-21T18:00:00Z")));
    expect(r.isOnMakeList).toBe(false);
    expect(isoList(r.cookedAt)).toEqual(["2026-10-21T18:00:00.000Z"]);
  });
});

describe("PLAN-6 deleted recipes leave the list", () => {
  it("deleting takes the recipe off the list and restoring doesn't put it back", () => {
    const r = recipe();
    valueOf(r.addToMakeList(at("2026-10-20T08:00:00Z")));
    r.delete(at("2026-10-21T09:00:00Z"));
    expect(r.isOnMakeList).toBe(false);
    valueOf(r.restore(at("2026-10-21T09:01:00Z")));
    expect(r.isOnMakeList).toBe(false);
  });
});

describe("COOK-1 mark as cooked", () => {
  it("records an entry at the given time", () => {
    const r = recipe();
    valueOf(r.markCooked(at("2026-10-21T18:00:00Z")));
    expect(isoList(r.cookedAt)).toEqual(["2026-10-21T18:00:00.000Z"]);
  });

  it("two devices mark the same recipe cooked at the same moment: two entries (COOK-4 withdrawn)", () => {
    const r = recipe();
    valueOf(r.markCooked(at("2026-10-21T18:00:00Z")));
    valueOf(r.markCooked(at("2026-10-21T18:00:00Z")));
    expect(r.timesCooked).toBe(2);
  });

  it("doesn't change content, photo or tags", () => {
    const r = fullRecipe();
    const before = r.toSnapshot();
    valueOf(r.markCooked(at("2026-10-22T18:00:00Z")));
    const after = r.toSnapshot();
    expect({ ...after, cookedAt: before.cookedAt, toMake: before.toMake }).toEqual(before);
  });
});

describe("COOK-5 history on the recipe", () => {
  it("never cooked: no last-cooked time and a count of 0", () => {
    const r = recipe();
    expect(r.lastCookedAt).toBeUndefined();
    expect(r.timesCooked).toBe(0);
  });

  it("lists entries newest first, whatever order they were recorded in", () => {
    const r = recipe();
    valueOf(r.markCooked(at("2026-09-01T18:00:00Z")));
    valueOf(r.markCooked(at("2026-10-15T18:00:00Z")));
    valueOf(r.markCooked(at("2026-08-01T18:00:00Z")));
    expect(isoList(r.cookedAt)).toEqual([
      "2026-10-15T18:00:00.000Z",
      "2026-09-01T18:00:00.000Z",
      "2026-08-01T18:00:00.000Z",
    ]);
    expect(r.lastCookedAt?.toIso()).toBe("2026-10-15T18:00:00.000Z");
    expect(r.timesCooked).toBe(3);
  });

  it("the returned history can't be used to change the recipe", () => {
    const r = fullRecipe();
    expect(() => (r.cookedAt as Instant[]).pop()).toThrow();
    expect(r.timesCooked).toBe(2);
  });

  it("last-cooked time and count are derived from the entries, not stored", () => {
    const snapshot = fullRecipe().toSnapshot() as unknown as Record<string, unknown>;
    expect(Object.keys(snapshot)).not.toContain("lastCookedAt");
    expect(Object.keys(snapshot)).not.toContain("timesCooked");
  });
});

describe("snapshot", () => {
  it("has the documented shape", () => {
    const r = fullRecipe();
    r.delete(at("2026-10-21T09:00:00Z"));
    expect(r.toSnapshot()).toEqual({
      id: ID,
      name: "Pad Thai",
      ingredients: ["200 g rice noodles", "2 eggs"],
      steps: ["Soak the noodles.", "Fry everything."],
      totalTimeMinutes: 30,
      tags: ["dinner", "quick"],
      photo: { blobName: "pad-thai.jpg", contentType: "image/jpeg" },
      cookedAt: ["2026-10-15T18:00:00.000Z", "2026-09-01T18:00:00.000Z"],
      deletedAt: "2026-10-21T09:00:00.000Z",
      schemaVersion: 1,
    });
  });

  it("omits optional fields that aren't set", () => {
    expect(Object.keys(recipe().toSnapshot()).sort()).toEqual(
      ["cookedAt", "id", "ingredients", "name", "schemaVersion", "steps", "tags"].sort(),
    );
  });

  it("round-trips a recipe with everything set", () => {
    const r = fullRecipe();
    valueOf(r.markCooked(at("2026-10-15T18:00:00Z"))); // a duplicate entry
    valueOf(r.addToMakeList(at("2026-10-22T08:00:00Z")));
    const snapshot = r.toSnapshot();
    const restored = Recipe.fromSnapshot(snapshot);
    expect(restored.toSnapshot()).toEqual(snapshot);
    expect(restored.timesCooked).toBe(3);
    expect(restored.addedToMakeListAt?.toIso()).toBe("2026-10-22T08:00:00.000Z");
  });

  it("round-trips a deleted recipe, which keeps its trash rules", () => {
    const r = fullRecipe();
    r.delete(at("2026-10-01T09:00:00Z"));
    const restored = Recipe.fromSnapshot(r.toSnapshot());
    expect(restored.toSnapshot()).toEqual(r.toSnapshot());
    expect(restored.removalDueAt()?.toIso()).toBe("2026-10-31T09:00:00.000Z");
    expect(errorKeys(restored.attachTag("x"))).toEqual([{ code: "recipe.inTrash", field: undefined }]);
  });

  it("round-trips a minimal recipe", () => {
    const snapshot = recipe().toSnapshot();
    expect(Recipe.fromSnapshot(snapshot).toSnapshot()).toEqual(snapshot);
  });

  it("is a copy: changing the snapshot doesn't change the recipe", () => {
    const r = fullRecipe();
    const snapshot = r.toSnapshot();
    snapshot.tags.push("hacked");
    snapshot.cookedAt.length = 0;
    expect(tagNames(r)).toEqual(["dinner", "quick"]);
    expect(r.timesCooked).toBe(2);
  });

  describe("fromSnapshot throws on invalid stored data", () => {
    const valid = (): RecipeSnapshot => {
      const r = fullRecipe();
      return r.toSnapshot();
    };
    const cases: [string, (s: RecipeSnapshot) => void][] = [
      ["an invalid id", (s) => (s.id = "not-a-uuid")],
      ["an empty name", (s) => (s.name = "  ")],
      ["an untrimmed name", (s) => (s.name = " Pad Thai ")],
      ["no ingredients", (s) => (s.ingredients = [])],
      ["a blank ingredient", (s) => s.ingredients.push("   ")],
      ["no steps", (s) => (s.steps = [])],
      ["a step of 1,001 characters", (s) => s.steps.push("x".repeat(1001))],
      ["total time 0", (s) => (s.totalTimeMinutes = 0)],
      ["an uppercase tag", (s) => (s.tags = ["Dinner"])],
      ["duplicate tags", (s) => (s.tags = ["dinner", "dinner"])],
      ["unsorted tags", (s) => (s.tags = ["quick", "dinner"])],
      ["21 tags", (s) => (s.tags = Array.from({ length: 21 }, (_, i) => `tag${String(i).padStart(2, "0")}`))],
      ["a photo without a blob name", (s) => (s.photo = { blobName: "", contentType: "image/jpeg" })],
      ["an invalid to-make time", (s) => (s.toMake = { addedAt: "yesterday" })],
      ["an invalid cooked time", (s) => s.cookedAt.push("2026-13-01T00:00:00Z")],
      ["a cooked time without an offset", (s) => s.cookedAt.push("2026-01-01T00:00:00")],
      ["cooked times oldest first", (s) => s.cookedAt.reverse()],
      ["an invalid deletion time", (s) => (s.deletedAt = "2026-02-30T00:00:00Z")],
      ["deleted but on the to-make list", (s) => (s.deletedAt = "2026-10-21T09:00:00.000Z")],
      ["an uppercase id", (s) => (s.id = "3F2A1C9E-5B7D-4E8F-9A0B-1C2D3E4F5A6B")],
      ["a non-canonical to-make time", (s) => (s.toMake = { addedAt: "2026-10-20T08:00:00Z" })],
      ["a non-canonical cooked time", (s) => (s.cookedAt = ["2026-10-15T20:00+02:00"])],
      [
        "a non-canonical deletion time",
        (s) => {
          delete s.toMake;
          s.deletedAt = "2026-10-01T09:00:00.123999Z";
        },
      ],
      ["an unknown schema version", (s) => ((s as { schemaVersion: number }).schemaVersion = 2)],
    ];

    it("accepts the unmodified snapshot", () => {
      expect(() => Recipe.fromSnapshot(valid())).not.toThrow();
    });

    it.each(cases)("%s", (_, corrupt) => {
      const s = valid();
      corrupt(s);
      expect(() => Recipe.fromSnapshot(s)).toThrow(/Invalid stored recipe/);
    });
  });
});
