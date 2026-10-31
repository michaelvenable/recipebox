// Decodes an upload and makes the two stored images (REC-7; docs/architecture.md, "Photos"). Runs only inside a photo worker
// (photo-worker.ts); photo-processing.ts starts the worker and holds the rest of the upload checks.
import sharp, { type Sharp } from "sharp";
import { decodeHeic } from "./heic.js";

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
 * Both stored images are JPEG, whatever was uploaded: every browser can show it, unlike HEIC (docs/architecture.md, "Photos").
 * Transparent areas of PNG and WebP uploads become white.
 */
export const STORED_CONTENT_TYPE = "image/jpeg";
const JPEG_QUALITY = 82;

/** REC-7: the accepted types. */
export type ImageType = "jpeg" | "png" | "webp" | "heic";

/** What a worker is given. */
export interface ConversionRequest {
  bytes: Uint8Array;
  type: ImageType;
}

/** What a worker answers. `detail` says why the image was refused, for the log. */
export type ConversionResult = { ok: true; photo: Uint8Array; thumbnail: Uint8Array } | { ok: false; detail: string };

/**
 * Decodes the upload once and makes both stored images from that one decode:
 * - the camera's rotation is applied (EXIF orientation; for HEIC, the file's rotation, applied by the decoder);
 * - all metadata is dropped: EXIF (including GPS location), XMP, IPTC, comments and ICC profiles. Recipes are public (X-1) and
 *   phone photos record where they were taken. Colors are converted to sRGB first, so dropping the profile doesn't shift them.
 */
export async function convertPhoto({ bytes, type }: ConversionRequest): Promise<ConversionResult> {
  try {
    const source = await decode(bytes, type);
    if (!source.ok) return source;
    // The one decode: the source at display size, flattened onto white and in sRGB, as raw pixels without any metadata. JPEG
    // sources are shrunk while they are decoded, so a large photo never exists at full size here.
    const { data, info } = await source.image
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

/** A sharp pipeline reading the upload, already in display orientation, or why it can't be read as `type`. */
async function decode(bytes: Uint8Array, type: ImageType): Promise<{ ok: true; image: Sharp } | { ok: false; detail: string }> {
  if (type === "heic") {
    const decoded = decodeHeic(bytes, MAX_INPUT_PIXELS);
    if (!decoded.ok) return { ok: false, detail: `HEIC ${decoded.reason}` };
    const { width, height, data } = decoded.image;
    // Raw pixels carry no metadata at all; the decoder has already applied the rotation.
    return { ok: true, image: sharp(data, { raw: { width, height, channels: 4 } }) };
  }
  // failOn "error": phone photos often carry small defects that decoders warn about but read fine. limitInputPixels is checked
  // against the size in the file's header, before decoding.
  const source = sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true });
  // sharp detects the format itself; make sure it reads the file as the type its signature names, and nothing else (such as
  // SVG or TIFF).
  const { format } = await source.metadata();
  return format === type ? { ok: true, image: source } : { ok: false, detail: `read as ${format}, not ${type}` };
}
