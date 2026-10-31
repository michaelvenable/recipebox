import { readFileSync } from "node:fs";
import exifReader from "exif-reader";
import sharp, { type Metadata, type Sharp } from "sharp";
import { expect } from "vitest";

// Images for the photo tests (REC-7), made with sharp so every byte is ours. Most are 60 x 40 pixels as stored, left half red and
// right half blue, so a test can tell which way up an image ends up.

export const WIDTH = 60;
export const HEIGHT = 40;

/** Where a phone that recorded GPS says the photo was taken; must never reach a stored image (X-1). */
export const GPS = { latitudeRef: "N", latitude: "51/1 30/1 0/1", longitudeRef: "W", longitude: "0/1 7/1 0/1" };
export const CAMERA_MAKE = "RecipeBoxTestCam";
export const XMP_MARKER = "RecipeBoxXmpLocation";

/** 60 x 40 RGB pixels: left half red, right half blue. */
function halves(width = WIDTH, height = HEIGHT): Buffer {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if (x < width / 2) pixels[i] = 255;
      else pixels[i + 2] = 255;
    }
  }
  return pixels;
}

function image(width = WIDTH, height = HEIGHT): Sharp {
  return sharp(halves(width, height), { raw: { width, height, channels: 3 } });
}

const XMP =
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF ' +
  'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" ' +
  `xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>${XMP_MARKER}</dc:description></rdf:Description>` +
  '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>';

/**
 * A JPEG as a phone takes it: stored 60 x 40, with EXIF orientation 6 (turn 90° clockwise to display, so it shows 40 x 60 with
 * red on top), a camera make, GPS location and XMP.
 */
export function phoneJpeg(): Promise<Buffer> {
  return image()
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: CAMERA_MAKE },
      IFD3: {
        GPSLatitudeRef: GPS.latitudeRef,
        GPSLatitude: GPS.latitude,
        GPSLongitudeRef: GPS.longitudeRef,
        GPSLongitude: GPS.longitude,
      },
    })
    .withXmp(XMP)
    .toBuffer();
}

export function jpeg(width = WIDTH, height = HEIGHT): Promise<Buffer> {
  return image(width, height).jpeg().toBuffer();
}

/** A PNG with EXIF (including GPS) and a transparent bottom-right corner. */
export function png(width = WIDTH, height = HEIGHT): Promise<Buffer> {
  const rgb = halves(width, height);
  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgb.copy(rgba, p * 4, p * 3, p * 3 + 3);
    const x = p % width;
    const y = Math.floor(p / width);
    rgba[p * 4 + 3] = x >= width - 10 && y >= height - 10 ? 0 : 255;
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .withExif({ IFD0: { Make: CAMERA_MAKE }, IFD3: { GPSLatitudeRef: GPS.latitudeRef, GPSLatitude: GPS.latitude } })
    .toBuffer();
}

export function webp(): Promise<Buffer> {
  return image()
    .webp()
    .withMetadata({ orientation: 6 })
    .withExif({ IFD0: { Make: CAMERA_MAKE }, IFD3: { GPSLatitudeRef: GPS.latitudeRef, GPSLatitude: GPS.latitude } })
    .toBuffer();
}

export function gif(): Promise<Buffer> {
  return image().gif().toBuffer();
}

/**
 * A real HEIC file (HEVC-coded), 1.8 KB: phoneJpeg() converted with libheif's heif-enc and x265, laid out as an iPhone writes
 * it. Its pixels are stored 60 x 40 with a rotation box (`irot`) that turns it to 40 x 60, red on top, and it keeps the JPEG's
 * EXIF and XMP: orientation 6 (which describes the rotation box and must not be applied a second time), the camera make and GPS
 * location. Made from our own synthetic pixels, so no third-party content or license is involved. To recreate it, write
 * phoneJpeg() to phone.jpg, then:
 *   docker run --rm -v "$PWD:/w" alpine sh -c "apk add libheif-tools x265-libs && heif-enc -q 50 /w/phone.jpg -o /w/out.heic"
 */
export function phoneHeic(): Buffer {
  return readFileSync(new URL("./fixtures/rotated-with-gps.heic", import.meta.url));
}

/**
 * phoneHeic() with four bytes of its HEVC data changed, found by a reviewer: it decodes to 64 x 40 pixels instead of the 40 x 60
 * it declares. Given to libheif-js's HeifImage.display(), that threw a RangeError inside a setTimeout, where no try/catch saw
 * it: the upload never finished and the unhandled rejection ended the process.
 */
export function corruptedHeic(): Buffer {
  const bytes = Buffer.from(phoneHeic());
  for (const [offset, value] of [
    [847, 213],
    [933, 60],
    [1430, 26],
    [1646, 227],
  ] as const) {
    bytes[offset] = value;
  }
  return bytes;
}

/** phoneHeic() with the image size it declares (its `ispe` box) changed to width x height; its pixels stay 64 x 64. */
export function heicDeclaring(width: number, height: number): Buffer {
  const bytes = Buffer.from(phoneHeic());
  const ispe = bytes.indexOf("ispe", 0, "latin1");
  if (ispe < 0 || bytes.indexOf("ispe", ispe + 1, "latin1") >= 0) throw new Error("expected one ispe box in the fixture");
  // The box type, then a version and flags (4 bytes), then the width and height.
  bytes.writeUInt32BE(width, ispe + 8);
  bytes.writeUInt32BE(height, ispe + 12);
  return bytes;
}

/** A text file, which a browser would happily send as photo.jpg with type image/jpeg. */
export const TEXT_FILE = Buffer.from("This is not a photo, just text in a file named photo.jpg.\n");

/**
 * A valid JPEG of exactly `size` bytes: `source` with comment segments inserted after its first marker. Comments are metadata,
 * so none of them may reach a stored image.
 */
export function paddedJpeg(source: Buffer, size: number): Buffer {
  const head = source.subarray(0, 2);
  const rest = source.subarray(2);
  const segments: Buffer[] = [];
  let remaining = size - source.length;
  while (remaining > 0) {
    // A segment is FF FE, a two-byte length (counting itself), then the data; at most 65,537 bytes in all, at least 4.
    let total = Math.min(remaining, 65_537);
    if (remaining - total > 0 && remaining - total < 4) total -= 4;
    const length = total - 2;
    const segment = Buffer.alloc(total, 0x41);
    segment[0] = 0xff;
    segment[1] = 0xfe;
    segment.writeUInt16BE(length, 2);
    segments.push(segment);
    remaining -= total;
  }
  const padded = Buffer.concat([head, ...segments, rest]);
  if (padded.length !== size) throw new Error(`paddedJpeg made ${padded.length} bytes, not ${size}`);
  return padded;
}

/** The EXIF of an image, parsed; undefined if it has none. */
export async function exifOf(bytes: Buffer): Promise<ReturnType<typeof exifReader> | undefined> {
  const { exif } = await sharp(bytes).metadata();
  return exif === undefined ? undefined : exifReader(exif);
}

/** The RGB color of one pixel. */
export async function colorAt(bytes: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

/** Roughly red, blue or white, allowing for JPEG's color shifts. */
export function expectColor(actual: [number, number, number], expected: "red" | "blue" | "white"): void {
  const target = { red: [255, 0, 0], blue: [0, 0, 255], white: [255, 255, 255] }[expected];
  const message = `${expected}: got rgb(${actual.join(", ")})`;
  actual.forEach((value, i) => expect(Math.abs(value - target[i]!), message).toBeLessThan(40));
}

/**
 * The stored image is a JPEG that carries no metadata at all: no EXIF (so no GPS location, camera or orientation), no XMP, IPTC
 * or ICC profile, and none of the source's text anywhere in its bytes (X-1).
 */
export async function expectStrippedJpeg(bytes: Buffer): Promise<Metadata> {
  const metadata = await sharp(bytes).metadata();
  expect(metadata.format).toBe("jpeg");
  expect(metadata.exif).toBeUndefined();
  expect(metadata.xmp).toBeUndefined();
  expect(metadata.iptc).toBeUndefined();
  expect(metadata.icc).toBeUndefined();
  expect(metadata.orientation).toBeUndefined();
  for (const text of ["Exif", CAMERA_MAKE, XMP_MARKER, "AAAAAAAAAAAAAAAA"]) {
    expect(bytes.includes(Buffer.from(text)), `stored image contains ${JSON.stringify(text)}`).toBe(false);
  }
  return metadata;
}
