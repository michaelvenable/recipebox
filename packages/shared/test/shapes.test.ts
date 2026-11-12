import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  EditorRecipe,
  EditorRecipeSummary,
  EmptyRequest,
  ErrorResponse,
  HealthResponse,
  ImportStatus,
  Me,
  PublicRecipe,
  RecipeContentInput,
  RecipeSummary,
  RediscoverEntry,
  SharedShoppingList,
  ShoppingListLink,
  Tag,
  TagCount,
  TagRequest,
  ToMakeEntry,
  TrashEntry,
} from "../src/index.js";

const ID = "3f2b8c1e-0d4a-4b6e-9a51-7c2d9e0f1a23";
const T1 = "2026-10-30T22:15:03.120Z";
const T2 = "2026-09-01T18:00:00.000Z";

const summary: RecipeSummary = {
  id: ID,
  name: "Pancakes",
  tags: ["breakfast"],
  totalTimeMinutes: 20,
  hasPhoto: true,
  createdAt: T2,
};
const publicRecipe: PublicRecipe = {
  id: ID,
  name: "Pancakes",
  ingredients: ["2 eggs", "200 g flour"],
  prep: ["Sift the flour."],
  steps: ["Mix.", "Fry."],
  totalTimeMinutes: 20,
  servings: 4,
  tags: ["breakfast"],
  hasPhoto: false,
};
const editorRecipe: EditorRecipe = {
  ...publicRecipe,
  toMake: { addedAt: T1 },
  cookedAt: [T1, T2],
  lastCookedAt: T1,
  timesCooked: 2,
};

/** Removing any one of the keys must fail parsing. */
function expectRequired(schema: z.ZodType, valid: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    const { [key]: _removed, ...rest } = valid;
    expect(schema.safeParse(rest).success, `without ${key}`).toBe(false);
  }
}

/** Each key may be absent or explicitly undefined. */
function expectOptional(schema: z.ZodType, valid: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    const { [key]: _removed, ...rest } = valid;
    expect(schema.safeParse(rest).success, `${key} absent`).toBe(true);
    expect(schema.safeParse({ ...rest, [key]: undefined }).success, `${key} undefined`).toBe(true);
  }
}

describe("api.md Shapes: RecipeContentInput", () => {
  const valid = {
    name: "Pancakes",
    ingredients: ["2 eggs"],
    prep: ["Sift the flour."],
    steps: ["Mix."],
    totalTimeMinutes: 20,
    servings: 4,
    tags: ["breakfast"],
  };

  it("parses a valid body", () => {
    expect(RecipeContentInput.parse(valid)).toEqual(valid);
  });
  it("requires name, ingredients and steps", () => {
    expectRequired(RecipeContentInput, valid, ["name", "ingredients", "steps"]);
  });
  it("allows prep (REC-20), totalTimeMinutes, servings (REC-24) and tags to be absent or undefined", () => {
    expectOptional(RecipeContentInput, valid, ["prep", "totalTimeMinutes", "servings", "tags"]);
    expect(RecipeContentInput.safeParse({ ...valid, prep: "Sift." }).success).toBe(false);
  });
  it("rejects wrong types: a string where an array is expected, a string time", () => {
    expect(RecipeContentInput.safeParse({ ...valid, ingredients: "2 eggs" }).success).toBe(false);
    expect(RecipeContentInput.safeParse({ ...valid, tags: "breakfast" }).success).toBe(false);
    expect(RecipeContentInput.safeParse({ ...valid, totalTimeMinutes: "20" }).success).toBe(false);
    expect(RecipeContentInput.safeParse({ ...valid, servings: "4" }).success).toBe(false);
  });
  it("leaves business rules to the domain: empty name, no entries, 0 minutes and odd tags pass", () => {
    const breaksRules = { name: "", ingredients: [], steps: [], totalTimeMinutes: 0, servings: 2.5, tags: ["Not A Tag!"] };
    expect(RecipeContentInput.safeParse(breaksRules).success).toBe(true);
  });
  it("rejects unknown keys, so a misspelled or stored field isn't silently dropped", () => {
    expect(RecipeContentInput.safeParse({ ...valid, cookedAt: [T1] }).success).toBe(false);
    expect(RecipeContentInput.safeParse({ ...valid, totalTime: 20 }).success).toBe(false);
  });
});

describe("api.md Conventions: EmptyRequest, the body of a change with no input", () => {
  it("parses {}", () => {
    expect(EmptyRequest.parse({})).toEqual({});
  });
  it("rejects any field, such as a time (X-12)", () => {
    expect(EmptyRequest.safeParse({ deletedAt: T1 }).success).toBe(false);
  });
  it("rejects a body that isn't an object", () => {
    expect(EmptyRequest.safeParse(null).success).toBe(false);
    expect(EmptyRequest.safeParse([]).success).toBe(false);
  });
});

describe("api.md Shapes: TagRequest, the body of attaching or removing a tag", () => {
  it("parses { tag }, keeping the text as typed", () => {
    expect(TagRequest.parse({ tag: " Dinner " })).toEqual({ tag: " Dinner " });
    expect(TagRequest.parse({ tag: ".." })).toEqual({ tag: ".." });
  });
  it("requires tag to be a string", () => {
    expect(TagRequest.safeParse({}).success).toBe(false);
    expect(TagRequest.safeParse({ tag: ["dinner"] }).success).toBe(false);
    expect(TagRequest.safeParse({ tag: 3 }).success).toBe(false);
  });
  it("rejects unknown keys", () => {
    expect(TagRequest.safeParse({ tag: "dinner", tags: ["dinner"] }).success).toBe(false);
  });
  it("rejects a body that isn't an object", () => {
    expect(TagRequest.safeParse("dinner").success).toBe(false);
    expect(TagRequest.safeParse(null).success).toBe(false);
  });
});

describe("api.md Shapes: RecipeSummary and EditorRecipeSummary", () => {
  it("parses a valid summary", () => {
    expect(RecipeSummary.parse(summary)).toEqual(summary);
  });
  it("requires id, name, tags and hasPhoto; totalTimeMinutes and createdAt are optional", () => {
    expectRequired(RecipeSummary, summary, ["id", "name", "tags", "hasPhoto"]);
    expectOptional(RecipeSummary, summary, ["totalTimeMinutes", "createdAt"]);
  });
  it("EditorRecipeSummary adds a required onToMakeList", () => {
    const editor = { ...summary, onToMakeList: true };
    expect(EditorRecipeSummary.parse(editor)).toEqual(editor);
    expectRequired(EditorRecipeSummary, editor, ["id", "name", "tags", "hasPhoto", "onToMakeList"]);
  });
});

describe("api.md Shapes: PublicRecipe and EditorRecipe", () => {
  it("parses a valid public recipe", () => {
    expect(PublicRecipe.parse(publicRecipe)).toEqual(publicRecipe);
  });
  it("PublicRecipe requires everything but prep, totalTimeMinutes and servings", () => {
    expectRequired(PublicRecipe, publicRecipe, ["id", "name", "ingredients", "steps", "tags", "hasPhoto"]);
    // REC-20: left out when a recipe has none, so clients from before prep can still read the recipe.
    expectOptional(PublicRecipe, publicRecipe, ["prep", "totalTimeMinutes", "servings"]);
  });
  it("parses a valid editor recipe", () => {
    expect(EditorRecipe.parse(editorRecipe)).toEqual(editorRecipe);
  });
  it("EditorRecipe requires cookedAt and timesCooked; toMake and lastCookedAt are optional", () => {
    expectRequired(EditorRecipe, editorRecipe, [
      "id",
      "name",
      "ingredients",
      "steps",
      "tags",
      "hasPhoto",
      "cookedAt",
      "timesCooked",
    ]);
    expectOptional(EditorRecipe, editorRecipe, ["toMake", "lastCookedAt", "totalTimeMinutes", "prep", "servings"]);
  });
  it("EditorRecipe parses a never-cooked recipe that isn't on the list", () => {
    const { toMake: _t, lastCookedAt: _l, ...rest } = editorRecipe;
    expect(EditorRecipe.safeParse({ ...rest, cookedAt: [], timesCooked: 0 }).success).toBe(true);
  });
  it("EditorRecipe requires toMake.addedAt when toMake is present", () => {
    expect(EditorRecipe.safeParse({ ...editorRecipe, toMake: {} }).success).toBe(false);
  });
  it("EditorRecipe rejects unknown keys inside toMake", () => {
    expect(EditorRecipe.safeParse({ ...editorRecipe, toMake: { addedAt: T1, extra: 1 } }).success).toBe(false);
  });
  it("EditorRecipe rejects fields no response should carry (trash time, stored photo reference)", () => {
    expect(EditorRecipe.safeParse({ ...editorRecipe, deletedAt: T1 }).success).toBe(false);
    const withPhotoRef = { ...editorRecipe, photo: { blobName: "x", contentType: "image/jpeg" } };
    expect(EditorRecipe.safeParse(withPhotoRef).success).toBe(false);
  });
});

describe("api.md Shapes: TagCount and Tag", () => {
  it("parses a valid tag count and requires both fields", () => {
    const valid = { tag: "breakfast", count: 3 };
    expect(TagCount.parse(valid)).toEqual(valid);
    expectRequired(TagCount, valid, ["tag", "count"]);
  });
  it("TagCount rejects unknown keys", () => {
    expect(TagCount.safeParse({ tag: "breakfast", count: 3, timesCooked: 2 }).success).toBe(false);
  });
  it("Tag is a string", () => {
    expect(Tag.parse("breakfast")).toBe("breakfast");
    expect(Tag.safeParse(["breakfast"]).success).toBe(false);
    expect(Tag.safeParse(undefined).success).toBe(false);
  });
});

describe("api.md Shapes: ToMakeEntry, RediscoverEntry, TrashEntry", () => {
  it("ToMakeEntry is a summary plus a required addedAt", () => {
    const valid = { ...summary, addedAt: T1 };
    expect(ToMakeEntry.parse(valid)).toEqual(valid);
    expectRequired(ToMakeEntry, valid, ["id", "name", "tags", "hasPhoto", "addedAt"]);
  });
  it("RediscoverEntry is a summary plus an optional lastCookedAt", () => {
    const valid = { ...summary, lastCookedAt: T2 };
    expect(RediscoverEntry.parse(valid)).toEqual(valid);
    expectRequired(RediscoverEntry, valid, ["id", "name", "tags", "hasPhoto"]);
    expectOptional(RediscoverEntry, valid, ["lastCookedAt"]);
  });
  it("TrashEntry is a summary plus required deletedAt and removalDueAt", () => {
    const valid = { ...summary, deletedAt: T2, removalDueAt: T1 };
    expect(TrashEntry.parse(valid)).toEqual(valid);
    expectRequired(TrashEntry, valid, ["id", "name", "tags", "hasPhoto", "deletedAt", "removalDueAt"]);
  });
});

describe("api.md Shapes: Me (X-11)", () => {
  const editor = { signedIn: true, provider: "google", accountId: "1234567890", isEditor: true };

  it("parses a signed-in editor and a visitor", () => {
    expect(Me.parse(editor)).toEqual(editor);
    expect(Me.parse({ signedIn: false, isEditor: false })).toEqual({ signedIn: false, isEditor: false });
  });
  it("requires signedIn and isEditor; provider and accountId are optional", () => {
    expectRequired(Me, editor, ["signedIn", "isEditor"]);
    expectOptional(Me, editor, ["provider", "accountId"]);
  });
  it("provider is aad or google", () => {
    expect(Me.safeParse({ ...editor, provider: "aad" }).success).toBe(true);
    expect(Me.safeParse({ ...editor, provider: "github" }).success).toBe(false);
  });
  it("rejects unknown keys, such as an email (X-7)", () => {
    expect(Me.safeParse({ ...editor, email: "cook@example.com" }).success).toBe(false);
  });
});

describe("api.md Shapes: HealthResponse", () => {
  it("parses ok and rejects unknown keys", () => {
    expect(HealthResponse.parse({ status: "ok" })).toEqual({ status: "ok" });
    expect(HealthResponse.safeParse({ status: "ok", version: "1" }).success).toBe(false);
  });
});

describe("api.md Conventions: ErrorResponse", () => {
  const valid = {
    errors: [
      { code: "name.tooLong", field: "name", message: "Name is too long." },
      { code: "trash.expired", message: "Too late to restore." },
    ],
  };

  it("parses errors with and without a field, and an empty list", () => {
    expect(ErrorResponse.parse(valid)).toEqual(valid);
    expect(ErrorResponse.parse({ errors: [] })).toEqual({ errors: [] });
  });
  it("requires errors, and code and message on each item; field is optional", () => {
    expectRequired(ErrorResponse, valid, ["errors"]);
    expect(ErrorResponse.safeParse({ errors: [{ message: "x" }] }).success).toBe(false);
    expect(ErrorResponse.safeParse({ errors: [{ code: "x" }] }).success).toBe(false);
    expect(ErrorResponse.safeParse({ errors: [{ code: "x", field: undefined, message: "y" }] }).success).toBe(true);
  });
  it("errors must be an array", () => {
    expect(ErrorResponse.safeParse({ errors: { code: "x", message: "y" } }).success).toBe(false);
  });
});

const PRIVATE_FIELDS: Record<string, unknown> = {
  toMake: { addedAt: T1 },
  cookedAt: [T1],
  lastCookedAt: T1,
  timesCooked: 1,
  deletedAt: T1,
  onToMakeList: true,
};

describe("X-1 public shapes reject private fields", () => {
  for (const [field, value] of Object.entries(PRIVATE_FIELDS)) {
    it(`PublicRecipe fails to parse with ${field}`, () => {
      expect(PublicRecipe.safeParse({ ...publicRecipe, [field]: value }).success).toBe(false);
    });
    it(`RecipeSummary fails to parse with ${field}`, () => {
      expect(RecipeSummary.safeParse({ ...summary, [field]: value }).success).toBe(false);
    });
  }

  it("an editor response is not a valid public response", () => {
    expect(PublicRecipe.safeParse(editorRecipe).success).toBe(false);
    expect(RecipeSummary.safeParse({ ...summary, onToMakeList: false }).success).toBe(false);
  });
  it("REC-22: the added time is public, so a visitor's summary may carry it", () => {
    expect(RecipeSummary.parse(summary).createdAt).toBe(T2);
  });
  it("a trash entry is not a valid public summary", () => {
    expect(RecipeSummary.safeParse({ ...summary, deletedAt: T2, removalDueAt: T1 }).success).toBe(false);
  });
});

describe("api.md Shapes: ShoppingListLink and SharedShoppingList (PLAN-9)", () => {
  const item = { text: "6 eggs", recipeId: ID, recipeName: "Shakshuka" };
  const shared = { items: [item], expiresAt: T1 };
  const link = { token: "k7Qm2xV9pR4tZ8wLa1B2c3", path: "/list/k7Qm2xV9pR4tZ8wLa1B2c3", expiresAt: T1 };

  it("ShoppingListLink requires token, path and expiresAt", () => {
    expect(ShoppingListLink.parse(link)).toEqual(link);
    expectRequired(ShoppingListLink, link, ["token", "path", "expiresAt"]);
  });
  it("SharedShoppingList requires items and expiresAt", () => {
    expect(SharedShoppingList.parse(shared)).toEqual(shared);
    expectRequired(SharedShoppingList, shared, ["items", "expiresAt"]);
  });
  it("SharedShoppingList refuses anything private, on the list or on its lines (X-1)", () => {
    for (const [field, value] of Object.entries({ ...PRIVATE_FIELDS, createdAt: T2, token: "x" })) {
      expect(SharedShoppingList.safeParse({ ...shared, [field]: value }).success, field).toBe(false);
      expect(SharedShoppingList.safeParse({ ...shared, items: [{ ...item, [field]: value }] }).success, field).toBe(false);
    }
  });
});

describe("api.md Shapes: ImportStatus (IMP-5, IMP-10, IMP-11)", () => {
  const IMPORT_ID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
  const done = { importId: IMPORT_ID, status: "done", recipeId: ID, recipeName: "Banana Bread" };

  it("parses reading, failed and done", () => {
    expect(ImportStatus.parse({ importId: IMPORT_ID, status: "reading" })).toEqual({ importId: IMPORT_ID, status: "reading" });
    expect(ImportStatus.parse({ importId: IMPORT_ID, status: "failed" })).toEqual({ importId: IMPORT_ID, status: "failed" });
    expect(ImportStatus.parse(done)).toEqual(done);
  });
  it("requires importId and status, and recipeId and recipeName when done", () => {
    expectRequired(ImportStatus, done, ["importId", "status", "recipeId", "recipeName"]);
    expect(ImportStatus.safeParse({ importId: IMPORT_ID, status: "pending" }).success).toBe(false);
  });
  it("has recipeId and recipeName only when done", () => {
    for (const status of ["reading", "failed"]) {
      expect(ImportStatus.safeParse({ importId: IMPORT_ID, status, recipeId: ID }).success, status).toBe(false);
      expect(ImportStatus.safeParse({ importId: IMPORT_ID, status, recipeName: "Banana Bread" }).success, status).toBe(false);
    }
  });
  it("has no start time, failure reason or photo (IMP-11)", () => {
    for (const [field, value] of Object.entries({ startedAt: T1, reason: "timed-out", photo: "imports/x.jpg", id: "current" })) {
      expect(ImportStatus.safeParse({ ...done, [field]: value }).success, field).toBe(false);
      expect(ImportStatus.safeParse({ importId: IMPORT_ID, status: "failed", [field]: value }).success, field).toBe(false);
    }
  });
});
