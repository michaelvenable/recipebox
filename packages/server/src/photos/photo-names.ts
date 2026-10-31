import { randomUUID } from "node:crypto";
import { type PhotoRef, RecipeId } from "@recipebox/domain";

/**
 * A fresh, unique name for a new upload's display image: `photos/{recipeId}/{uuid}.jpg`. Every upload gets a new name, so the
 * images a recipe currently refers to are never overwritten: if saving the recipe fails, the old images are still there (REC-7).
 */
export function newPhotoName(recipeId: RecipeId): string {
  return `photos/${recipeId.value}/${randomUUID()}.jpg`;
}

/**
 * The naming rule for thumbnails. A recipe has one `PhotoRef`, which names its display image; the thumbnail is stored next to it
 * under a name derived from that one, with `.thumbnail` inserted before the extension:
 *
 *   photos/{recipeId}/{uuid}.jpg  ->  photos/{recipeId}/{uuid}.thumbnail.jpg
 *
 * (`.thumbnail` is appended when the name has no extension.) Both images have the `PhotoRef`'s content type. Everything that
 * serves or deletes a recipe's images, including the trash cleanup (REC-16), finds the thumbnail with this rule.
 */
export function thumbnailNameOf(photoName: string): string {
  const slash = photoName.lastIndexOf("/");
  const dot = photoName.lastIndexOf(".");
  if (dot <= slash + 1) return `${photoName}.thumbnail`;
  return `${photoName.slice(0, dot)}.thumbnail${photoName.slice(dot)}`;
}

/** Both stored images of a photo: the display image and its thumbnail. */
export function imageNamesOf(photo: PhotoRef): [photo: string, thumbnail: string] {
  return [photo.blobName, thumbnailNameOf(photo.blobName)];
}

/**
 * Whether `name` has the form every recipe image name has, `photos/{recipeId}/{file}` (`newPhotoName` and its thumbnail): a
 * recipe ID exactly as `RecipeId` writes it, and one more non-empty segment. The trash cleanup's orphan sweep never deletes
 * anything else in the store (docs/architecture.md, "Trash cleanup").
 */
export function isRecipeImageName(name: string): boolean {
  const match = /^photos\/([^/]+)\/[^/]+$/.exec(name);
  if (match === null) return false;
  const id = RecipeId.create(match[1]!);
  return id.ok && id.value.value === match[1];
}
