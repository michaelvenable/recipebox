import { createRequire } from "node:module";

// HEIC decoding (REC-7: iPhone photos). sharp's prebuilt libvips includes libheif but only an AV1 decoder (AVIF), not HEVC, so it
// can't read HEIC. libheif-js is libheif with its HEVC decoder (libde265) compiled to WebAssembly: no native build, the same on
// Windows and Linux. It has no type declarations, so the part used here is declared below.
//
// This runs only inside a photo worker (photo-worker.ts), never on the API's main thread: a malformed file can still make the
// decoder fail in ways no try/catch here sees, and the worker contains that (docs/architecture.md, "Photos").

/** An image handle in a HEIF file (libheif-js's `HeifImage`). */
interface HeifImage {
  /** The libheif image handle, for the library's functions. */
  handle: unknown;
  /** Size in display orientation: after the file's crop, rotation and mirroring. */
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  free(): void;
}

interface HeifDecoder {
  /** The file's top-level images; empty if the file can't be parsed. */
  decode(bytes: Uint8Array): HeifImage[];
  decoder: { delete(): void } | null;
}

interface HeifChannel {
  id: unknown;
  width: number;
  height: number;
  stride: number;
  data: Uint8Array;
}

/** What `heif_js_decode_image2` returns: the decoded image, or an error with a truthy `code`. */
interface HeifDecodeResult {
  code?: unknown;
  image: unknown;
  width: number;
  height: number;
  channels: HeifChannel[];
}

interface LibHeif {
  HeifDecoder: new () => HeifDecoder;
  /**
   * Decodes synchronously, applying the file's own rotation and mirroring. libheif-js's `HeifImage.display()` wraps this in a
   * `setTimeout`, so an exception thrown while it copies the pixels (such as a RangeError when the decoded size differs from the
   * size the file declares) escapes every try/catch and its callback never runs. This call is used instead.
   */
  heif_js_decode_image2(handle: unknown, colorspace: unknown, chroma: unknown): HeifDecodeResult | null | undefined;
  heif_image_release(image: unknown): void;
  heif_colorspace: { heif_colorspace_RGB: unknown };
  heif_chroma: { heif_chroma_interleaved_RGBA: unknown };
  heif_channel: { heif_channel_interleaved: unknown };
}

let libheif: LibHeif | undefined;

/** Loaded on first use: the bundle holds the WebAssembly module (about 2 MB) and most uploads never need it. */
function load(): LibHeif {
  libheif ??= createRequire(import.meta.url)("libheif-js/wasm-bundle") as LibHeif;
  return libheif;
}

/** Decoded pixels: interleaved RGBA, 8 bits per channel, already in display orientation. */
export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** `tooLarge`: the file declares an image with more than the allowed pixels. `undecodable`: anything else that went wrong. */
export type HeicDecoding = { ok: true; image: DecodedImage } | { ok: false; reason: "tooLarge" | "undecodable" };

const UNDECODABLE = { ok: false, reason: "undecodable" } as const;
const TOO_LARGE = { ok: false, reason: "tooLarge" } as const;

interface BoxSpan {
  type: string;
  /** Where the box's contents start, after its header. */
  body: number;
  end: number;
}

/** The ISO BMFF boxes between `start` and `end`. Stops at the first box whose size doesn't fit. */
function* boxes(bytes: Uint8Array, start: number, end: number): Generator<BoxSpan> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      size = view.getUint32(at + 8) * 2 ** 32 + view.getUint32(at + 12);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return;
    yield { type, body: at + header, end: at + size };
    at += size;
  }
}

function child(bytes: Uint8Array, parent: BoxSpan, type: string, skip = 0): BoxSpan | undefined {
  for (const box of boxes(bytes, parent.body + skip, parent.end)) if (box.type === type) return box;
  return undefined;
}

/**
 * The pixel count of the largest image the file declares: the largest `ispe` (image spatial extents) property in
 * meta/iprp/ipco. That is the size libheif decodes to and allocates, before any cropping, and for a grid it is the whole image.
 * Undefined if the file declares none, which a valid HEIF file always does.
 */
function largestDeclaredPixels(bytes: Uint8Array): number | undefined {
  const file: BoxSpan = { type: "", body: 0, end: bytes.length };
  const meta = child(bytes, file, "meta");
  // meta and ispe are full boxes: a version and flags (4 bytes) come before their contents.
  const iprp = meta && child(bytes, meta, "iprp", 4);
  const ipco = iprp && child(bytes, iprp, "ipco");
  if (ipco === undefined) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let largest: number | undefined;
  for (const box of boxes(bytes, ipco.body, ipco.end)) {
    if (box.type !== "ispe" || box.body + 12 > box.end) continue;
    const pixels = view.getUint32(box.body + 4) * view.getUint32(box.body + 8);
    largest = Math.max(largest ?? 0, pixels);
  }
  return largest;
}

/**
 * Decodes the primary image of a HEIC file. Refuses it, before any pixels are allocated, if it declares more than `maxPixels`
 * pixels.
 *
 * libheif applies the file's own rotation and mirroring (the `irot`/`imir` boxes, which iPhones write). The EXIF orientation
 * inside a HEIC file only describes those and must not be applied again, so the result needs no further rotation.
 */
export function decodeHeic(bytes: Uint8Array, maxPixels: number): HeicDecoding {
  const declared = largestDeclaredPixels(bytes);
  if (declared === undefined) return UNDECODABLE;
  if (declared > maxPixels) return TOO_LARGE;

  const lib = load();
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(bytes);
  try {
    const image = images.find((i) => i.is_primary()) ?? images[0];
    if (image === undefined) return UNDECODABLE;
    const width = image.get_width();
    const height = image.get_height();
    if (width <= 0 || height <= 0) return UNDECODABLE;
    if (width * height > maxPixels) return TOO_LARGE;

    const decoded = lib.heif_js_decode_image2(
      image.handle,
      lib.heif_colorspace.heif_colorspace_RGB,
      lib.heif_chroma.heif_chroma_interleaved_RGBA,
    );
    if (!decoded || decoded.code) return UNDECODABLE;
    try {
      const channel = decoded.channels.find((c) => c.id === lib.heif_channel.heif_channel_interleaved);
      // A damaged file can decode to a size other than the one it declares; such pixels can't be trusted.
      if (channel === undefined || channel.width !== width || channel.height !== height) return UNDECODABLE;
      const row = width * 4;
      if (channel.stride < row || channel.data.length < channel.stride * (height - 1) + row) return UNDECODABLE;
      const data = new Uint8Array(row * height);
      for (let y = 0; y < height; y++) {
        data.set(channel.data.subarray(y * channel.stride, y * channel.stride + row), y * row);
      }
      return { ok: true, image: { width, height, data } };
    } finally {
      lib.heif_image_release(decoded.image);
    }
  } finally {
    for (const image of images) image.free();
    decoder.decoder?.delete();
  }
}
