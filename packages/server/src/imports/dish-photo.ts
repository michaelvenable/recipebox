import { type PixelArea, THUMBNAIL_MAX_SIDE } from "../photos/photo-processing.js";
import type { DishPhotoBox } from "./reading-answer.js";

/**
 * The page photo the dish picture is on (IMP-9), or undefined for no photo. The reading service numbers the photos from 1 in
 * the order given; it is untrusted, so a number that names no photo means no photo (docs/architecture.md, "Recipe import").
 */
export function dishPhotoPage<T>(box: DishPhotoBox | undefined, pages: readonly T[]): T | undefined {
  if (box === undefined || !Number.isInteger(box.photo) || box.photo < 1 || box.photo > pages.length) return undefined;
  return pages[box.photo - 1];
}

/**
 * The area of the page photo to cut out as the recipe's photo (IMP-9), in pixels, or undefined for no photo. The reading
 * service gives the box as fractions of the image's width and height (reading-prompt.ts); it is untrusted, so it is clamped to
 * the image. What is left must be big enough for a thumbnail: its longer side at least THUMBNAIL_MAX_SIDE, the size every
 * thumbnail is made at, since images are never enlarged (docs/architecture.md, "Recipe import": "A box that is missing, names
 * a photo that doesn't exist, or is too small for a thumbnail means no photo").
 */
export function dishPhotoArea(
  box: Omit<DishPhotoBox, "photo"> | undefined,
  image: { width: number; height: number },
): PixelArea | undefined {
  if (box === undefined) return undefined;
  const left = Math.round(clamp(box.left) * image.width);
  const top = Math.round(clamp(box.top) * image.height);
  const right = Math.round(clamp(box.left + box.width) * image.width);
  const bottom = Math.round(clamp(box.top + box.height) * image.height);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0 || Math.max(width, height) < THUMBNAIL_MAX_SIDE) return undefined;
  return { left, top, width, height };
}

function clamp(fraction: number): number {
  return Math.min(1, Math.max(0, fraction));
}
