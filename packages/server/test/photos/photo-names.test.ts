import { describe, expect, it } from "vitest";
import { PhotoRef } from "@recipebox/domain";
import { imageNamesOf, newPhotoName, thumbnailNameOf } from "../../src/photos/photo-names.js";
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
