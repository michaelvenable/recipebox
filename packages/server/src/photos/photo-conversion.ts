// Decodes an upload and makes the two stored images (REC-7; docs/architecture.md, "Photos"). Runs only inside a photo worker
// (photo-worker.ts); photo-processing.ts starts the worker and holds the rest of the upload checks.
import sharp, { type Sharp } from "sharp";
import type { PhotoRotation } from "@recipebox/shared";

/**
 * Images with more pixels than this are refused before any pixels are decoded, so a small file that expands to a huge image (a
 * "decompression bomb") can't exhaust the server's memory. 48-megapixel phone photos (8064 x 6048) fit
 * (docs/architecture.md, "Photos").
 */
export const MAX_INPUT_PIXELS = 50_000_000;

/** The longest side of the stored display image and of the thumbnail; smaller images are not enlarged. */
export const PHOTO_MAX_SIDE = 2000;
export const THUMBNAIL_MAX_SIDE = 400;

/**
 * The longest side of a stored import page photo (docs/architecture.md, "Recipe import"): enough to read a recipe card, small
 * enough to keep the call to the reading service small. Smaller images are not enlarged.
 */
export const IMPORT_PAGE_MAX_SIDE = 2048;

/**
 * Both stored images are JPEG, whatever was uploaded: every browser can show it (docs/architecture.md, "Photos").
 * Transparent areas of PNG and WebP uploads become white.
 */
export const STORED_CONTENT_TYPE = "image/jpeg";
const JPEG_QUALITY = 82;

/** REC-7: the accepted types. */
export type ImageType = "jpeg" | "png" | "webp";

/**
 * What the image is for: a recipe photo, stored as a display image and a thumbnail (REC-7), or the page photo of an import,
 * stored as one image for the reading service (IMP-1, IMP-12).
 */
export type ConversionPurpose = "recipe" | "importPage";

/** An area of an image in pixels, from its top-left corner as displayed. */
export interface PixelArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * What a worker is given. Without `purpose`, a recipe photo. With `crop`, a recipe photo is made from that area of the image
 * only: the dish picture on an import's page photo (IMP-9). With `rotation`, an import's page photo is turned that far
 * clockwise after the camera's rotation, as the editor turned it (IMP-1); a recipe photo is never turned.
 */
export interface ConversionRequest {
  bytes: Uint8Array;
  type: ImageType;
  purpose?: ConversionPurpose;
  crop?: PixelArea;
  rotation?: PhotoRotation;
}

/**
 * What a worker answers. `detail` says why the image was refused, for the log. A recipe photo has a thumbnail; an import page
 * photo has none.
 */
export type ConversionResult = { ok: true; photo: Uint8Array; thumbnail?: Uint8Array } | { ok: false; detail: string };

/**
 * Decodes the upload once and makes both stored images from that one decode:
 * - the camera's rotation is applied (EXIF orientation);
 * - all metadata is dropped: EXIF (including GPS location), XMP, IPTC, comments and ICC profiles. Recipes are public (X-1) and
 *   phone photos record where they were taken. Colors are converted to sRGB first, so dropping the profile doesn't shift them.
 */
export async function convertPhoto({
  bytes,
  type,
  purpose = "recipe",
  crop,
  rotation = 0,
}: ConversionRequest): Promise<ConversionResult> {
  try {
    const source = await decode(bytes, type);
    if (!source.ok) return source;
    if (purpose === "importPage") return await convertImportPage(source.image, rotation);
    // IMP-9: the area is cut from the oriented image first, so the rest is exactly as for an uploaded photo.
    const image = crop === undefined ? source.image : source.image.extract(crop);
    // The one decode: the source at display size, flattened onto white and in sRGB, as raw pixels without any metadata. JPEG
    // sources are shrunk while they are decoded, so a large photo never exists at full size here.
    const { data, info } = await image
      .resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const display = (): Sharp => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    // sharp writes no metadata unless asked to (keepMetadata, withExif, ...); none is asked for here.
    const [photo, thumbnail] = await Promise.all([
      display().jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer(),
      display()
        .resize({ width: THUMBNAIL_MAX_SIDE, height: THUMBNAIL_MAX_SIDE, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer(),
    ]);
    return { ok: true, photo, thumbnail };
  } catch (error) {
    // sharp throws for corrupt or truncated files; the file was the problem, not the server.
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The page photo of an import (docs/architecture.md, "Recipe import"): oriented by the camera's rotation, then turned
 * `rotation` degrees clockwise as the editor showed it (IMP-1), so the reading service gets the page upright; at most
 * IMPORT_PAGE_MAX_SIDE on its longer side, flattened onto white, in sRGB and without any metadata, the same way as a recipe
 * photo, so no location reaches the reading service.
 */
async function convertImportPage(image: Sharp, rotation: PhotoRotation): Promise<ConversionResult> {
  // The source is read with autoOrient (decode), so this turn comes on top of the camera's rotation instead of replacing it.
  const turned = rotation === 0 ? image : image.rotate(rotation);
  const photo = await turned
    .resize({ width: IMPORT_PAGE_MAX_SIDE, height: IMPORT_PAGE_MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return { ok: true, photo };
}

/** A sharp pipeline reading the upload, already in display orientation, or why it can't be read as `type`. */
async function decode(bytes: Uint8Array, type: ImageType): Promise<{ ok: true; image: Sharp } | { ok: false; detail: string }> {
  // failOn "error": phone photos often carry small defects that decoders warn about but read fine. limitInputPixels is checked
  // against the size in the file's header, before decoding.
  const source = sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true });
  // sharp detects the format itself; make sure it reads the file as the type its signature names, and nothing else (such as
  // SVG or TIFF).
  const { format } = await source.metadata();
  return format === type ? { ok: true, image: source } : { ok: false, detail: `read as ${format}, not ${type}` };
}
