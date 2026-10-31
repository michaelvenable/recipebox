import { describe, expect, it } from "vitest";
import { PhotoRef } from "@recipebox/domain";
import { imageNamesOf, isRecipeImageName, newPhotoName, thumbnailNameOf } from "../../src/photos/photo-names.js";
import { recipeId } from "../recipes/recipe-route-helpers.js";

const ID = "00000000-0000-4000-8000-000000000001";

describe("REC-7 photo image names", () => {
  it("gives every upload a fresh name under the recipe's id", () => {
    const first = newPhotoName(recipeId(ID));
    const second = newPhotoName(recipeId(ID));
    expect(first).toMatch(new RegExp(`^photos/${ID}/[0-9a-f-]{36}\.jpg$`));
    expect(second).not.toBe(first);
  });

  it.each([
    ["photos/r/abc.jpg", "photos/r/abc.thumbnail.jpg"],
    ["photos/r/abc", "photos/r/abc.thumbnail"],
    ["photos/r.d/abc", "photos/r.d/abc.thumbnail"],
    ["photos/r/.jpg", "photos/r/.jpg.thumbnail"],
  ])("derives the thumbnail's name from the photo's: %s -> %s", (photo, thumbnail) => {
    expect(thumbnailNameOf(photo)).toBe(thumbnail);
  });

  it("finds both images from the one PhotoRef", () => {
    const ref = PhotoRef.create({ blobName: `photos/${ID}/a.jpg`, contentType: "image/jpeg" });
    if (!ref.ok) throw new Error("invalid ref");
    expect(imageNamesOf(ref.value)).toEqual([`photos/${ID}/a.jpg`, `photos/${ID}/a.thumbnail.jpg`]);
  });
});

describe("Recipe image names (architecture.md, Trash cleanup)", () => {
  it("recognizes the names an upload produces, display image and thumbnail", () => {
    const photo = newPhotoName(recipeId(ID));
    expect(isRecipeImageName(photo)).toBe(true);
    expect(isRecipeImageName(thumbnailNameOf(photo))).toBe(true);
  });

  it.each([
    "exports/backup.json",
    "backup.jpg",
    `photos/${ID}`,
    `photos/${ID}/`,
    `photos/${ID}/nested/a.jpg`,
    "photos/not-a-recipe-id/a.jpg",
    // Not as RecipeId writes it, so no upload produced it.
    "photos/ABCDEF00-0000-4000-8000-000000000001/a.jpg",
    `Photos/${ID}/a.jpg`,
    `archive/photos/${ID}/a.jpg`,
    `photos//${ID}/a.jpg`,
  ])("rejects anything else: %s", (name) => {
    expect(isRecipeImageName(name)).toBe(false);
  });
});
