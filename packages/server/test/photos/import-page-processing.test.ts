// The page photo of an import (IMP-2; docs/architecture.md, "Recipe import"): the same checks and decode worker as a recipe
// photo, all metadata removed, scaled to at most 2048 px on its longer side, one image and no thumbnail.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  DecodeQueue,
  IMPORT_PAGE_MAX_SIDE,
  MAX_PHOTO_BYTES,
  processImportPage,
  processPhoto,
} from "../../src/photos/photo-processing.js";
import {
  CAMERA_MAKE,
  colorAt,
  exifOf,
  expectColor,
  expectStrippedJpeg,
  gif,
  jpeg,
  paddedJpeg,
  phoneHeic,
  phoneJpeg,
  png,
  TEXT_FILE,
  webp,
} from "./test-images.js";

function workerFixture(name: string): URL {
  return new URL(`./workers/${name}.mjs`, import.meta.url);
}

async function page(bytes: Buffer): Promise<Buffer> {
  const result = await processImportPage(bytes);
  if (!result.ok) throw new Error(`Expected the page photo to be accepted, got ${result.reason}`);
  expect(result.value.contentType).toBe("image/jpeg");
  return result.value.image;
}

describe("IMP-2 accepted photos: the same rules as a recipe photo (REC-7)", () => {
  it.each([
    ["JPEG", jpeg],
    ["PNG", png],
    ["WebP", webp],
  ] as const)("accepts a %s and makes one JPEG", async (_name, make) => {
    expect((await sharp(await page(await make())).metadata()).format).toBe("jpeg");
  });

  it.each([
    ["a HEIC file", async () => phoneHeic()],
    ["a GIF", gif],
    ["a text file", async () => TEXT_FILE],
  ] as const)("refuses %s as an unsupported type", async (_name, make) => {
    expect(await processImportPage(await make())).toEqual({ ok: false, reason: "unsupportedType" });
  });

  it("refuses a file with an accepted signature that can't be decoded", async () => {
    const broken = Buffer.concat([(await jpeg()).subarray(0, 40)]);
    expect(await processImportPage(broken)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("accepts a JPEG of exactly 15 MB, dropping its padding", async () => {
    const image = await page(paddedJpeg(await jpeg(), MAX_PHOTO_BYTES));
    expect(image.length).toBeLessThan(100_000);
  });
});

describe('IMP-1 page photo: no metadata reaches the reading service (architecture "Recipe import")', () => {
  it.each([
    ["JPEG", phoneJpeg],
    ["PNG", png],
    ["WebP", webp],
  ] as const)("drops EXIF, GPS location and all other metadata from a %s", async (_name, make) => {
    const source = await make();
    const exif = await exifOf(source);
    expect(exif?.Image?.Make).toBe(CAMERA_MAKE);
    expect(exif?.GPSInfo?.GPSLatitudeRef).toBe("N");

    await expectStrippedJpeg(await page(source));
  });

  it("applies the camera's rotation, so the page reads the right way up", async () => {
    const image = await page(await phoneJpeg());
    const { width, height } = await sharp(image).metadata();
    expect([width, height]).toEqual([40, 60]);
    expectColor(await colorAt(image, 20, 5), "red");
    expectColor(await colorAt(image, 20, 55), "blue");
  });

  it("makes transparent areas white", async () => {
    const image = await page(await png());
    expectColor(await colorAt(image, 59, 39), "white");
  });
});

describe('IMP-1 page photo size (architecture "Recipe import": at most 2048 px on the long side)', () => {
  it("is 2048 px", () => {
    expect(IMPORT_PAGE_MAX_SIDE).toBe(2048);
  });

  it.each([
    [4096, 3072, 2048, 1536],
    [3000, 4000, 1536, 2048],
  ])("scales %i x %i down to %i x %i", async (width, height, expectedWidth, expectedHeight) => {
    const { width: w, height: h } = await sharp(await page(await jpeg(width, height))).metadata();
    expect([w, h]).toEqual([expectedWidth, expectedHeight]);
  });

  it("does not enlarge a small image", async () => {
    const { width, height } = await sharp(await page(await jpeg(300, 200))).metadata();
    expect([width, height]).toEqual([300, 200]);
  });
});

describe('IMP-2 the page photo goes through the same isolated decode (architecture "Photos")', () => {
  it("refuses a page photo whose decoder doesn't answer in time", async () => {
    const result = await processImportPage(await jpeg(), { workerUrl: workerFixture("hang"), timeoutMs: 300 });
    expect(result).toEqual({ ok: false, reason: "unreadable" });
  });

  it.each(["exit", "throw", "reject", "malformed"])("refuses a page photo whose decoder fails (%s)", async (worker) => {
    expect(await processImportPage(await jpeg(), { workerUrl: workerFixture(worker) })).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("refuses a recipe photo whose decoder answers without a thumbnail, and accepts that answer for a page photo", async () => {
    const options = { workerUrl: workerFixture("photo-only") };
    expect(await processPhoto(await jpeg(), options)).toEqual({ ok: false, reason: "unreadable" });
    expect((await processImportPage(await jpeg(), options)).ok).toBe(true);
  });

  it("shares the decode queue with recipe photos: busy when it is full", async () => {
    const queue = new DecodeQueue(1, 0);
    const hanging = processPhoto(await jpeg(), { workerUrl: workerFixture("hang"), timeoutMs: 300, queue });
    expect(await processImportPage(await jpeg(), { queue })).toEqual({ ok: false, reason: "busy" });
    expect(await hanging).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("IMP-1 Rotate: the page photo is turned clockwise as the editor showed it, after the camera's rotation", () => {
  // jpeg(): 60 x 40, left half red and right half blue, no EXIF orientation.
  it.each([
    [0, [60, 40], { left: "red", right: "blue" }],
    [90, [40, 60], { top: "red", bottom: "blue" }],
    [180, [60, 40], { left: "blue", right: "red" }],
    [270, [40, 60], { top: "blue", bottom: "red" }],
  ] as const)("turns a page %i° clockwise", async (rotation, size, colors) => {
    const result = await processImportPage(await jpeg(), {}, rotation);
    if (!result.ok) throw new Error(result.reason);
    const image = result.value.image;
    const { width, height } = await sharp(image).metadata();
    expect([width, height]).toEqual(size);
    const [w, h] = size;
    const at = { left: [5, h / 2], right: [w - 6, h / 2], top: [w / 2, 5], bottom: [w / 2, h - 6] } as const;
    for (const [side, color] of Object.entries(colors)) {
      const [x, y] = at[side as keyof typeof at];
      expectColor(await colorAt(image, x, y), color);
    }
  });

  it("'A card photographed upside down; Rotate pressed twice': 180° reads the right way up", async () => {
    // The card, red at the top of its writing and blue at the bottom, as photographed upside down: blue on top.
    const upsideDown = await sharp(await jpeg(40, 60)).rotate(270).jpeg().toBuffer();
    expectColor(await colorAt(upsideDown, 30, 5), "blue");
    const result = await processImportPage(upsideDown, {}, 180);
    if (!result.ok) throw new Error(result.reason);
    expectColor(await colorAt(result.value.image, 30, 5), "red");
    expectColor(await colorAt(result.value.image, 30, 34), "blue");
  });

  it.each([
    // phoneJpeg(): stored 60 x 40 with EXIF orientation 6, so the camera shows it 40 x 60 with red on top.
    [0, [40, 60], [20, 5], [20, 54]],
    [90, [60, 40], [54, 20], [5, 20]],
    [180, [40, 60], [20, 54], [20, 5]],
    [270, [60, 40], [5, 20], [54, 20]],
  ] as const)("applies the camera's rotation first, then turns %i°: red, the photo's top as shown, ends up as turned", async (rotation, size, red, blue) => {
    const result = await processImportPage(await phoneJpeg(), {}, rotation);
    if (!result.ok) throw new Error(result.reason);
    const image = result.value.image;
    const { width, height } = await sharp(image).metadata();
    expect([width, height]).toEqual(size);
    expectColor(await colorAt(image, red[0], red[1]), "red");
    expectColor(await colorAt(image, blue[0], blue[1]), "blue");
    await expectStrippedJpeg(image);
  });

  it.each([90, 270] as const)("swaps width and height at %i°, scaling to at most 2048 px on the long side", async (rotation) => {
    const result = await processImportPage(await jpeg(4096, 3072), {}, rotation);
    if (!result.ok) throw new Error(result.reason);
    const { width, height } = await sharp(result.value.image).metadata();
    expect([width, height]).toEqual([1536, 2048]);
  });

  it("never turns a recipe photo (REC-7 is unchanged): processPhoto has no turn", async () => {
    const result = await processPhoto(await jpeg());
    if (!result.ok) throw new Error(result.reason);
    expectColor(await colorAt(result.value.photo, 5, 20), "red");
  });
});
