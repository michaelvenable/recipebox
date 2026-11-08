// The Rotate button, as the server sees it (IMP-1; docs/api.md, "Import from a photo"; docs/architecture.md, "Recipe import"):
// an optional `rotations` text part before the files turns each stored page photo clockwise, after the camera's rotation.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DecodeQueue } from "../../src/photos/photo-processing.js";
import { type FilePart, multipartBody, type TextPart, UPLOAD_HEADERS } from "../photos/photo-route-helpers.js";
import { colorAt, expectColor, expectStrippedJpeg, jpeg, phoneHeic, phoneJpeg } from "../photos/test-images.js";
import { AS_EDITOR, AS_VISITOR, expectErrors } from "../recipes/recipe-route-helpers.js";
import {
  AS_EDITOR_UPLOADING,
  FIRST_IMPORT_ID,
  importApp,
  type ImportTestApp,
  NOTHING_STORED,
  startImportBody,
  storedState,
} from "./import-route-helpers.js";

const START = "2026-11-07T09:00:00.000Z";

type Part = FilePart | TextPart;

function startParts(setup: ImportTestApp, parts: readonly Part[], headers: Record<string, string> = AS_EDITOR_UPLOADING) {
  const { payload, contentType } = multipartBody(parts);
  return startImportBody(setup.app, payload, contentType, headers);
}

/** POST /imports with `rotations` (when given) first, then the files, as the client sends them. */
function startRotated(
  setup: ImportTestApp,
  rotations: string | undefined,
  files: readonly Buffer[],
  headers: Record<string, string> = AS_EDITOR_UPLOADING,
) {
  const parts: Part[] = files.map((bytes) => ({ bytes }));
  if (rotations !== undefined) parts.unshift({ field: "rotations", value: rotations });
  return startParts(setup, parts, headers);
}

async function stored(setup: ImportTestApp, n: number): Promise<Buffer> {
  const image = await setup.photos.get(`imports/${FIRST_IMPORT_ID}/${n}.jpg`);
  if (image === undefined) throw new Error(`Page ${n} wasn't stored`);
  return image.bytes;
}

async function sizeOf(bytes: Buffer): Promise<[number | undefined, number | undefined]> {
  const { width, height } = await sharp(bytes).metadata();
  return [width, height];
}

/** An app whose decode queue is full: any photo processed would be refused as busy (503), so a 400 shows none was. */
async function appWithFullQueue(): Promise<{ setup: ImportTestApp; release: () => Promise<void> }> {
  const queue = new DecodeQueue(1, 0);
  const setup = await importApp(START, { queue });
  let free = (): void => undefined;
  const occupied = queue.run(() => new Promise<void>((resolve) => (free = resolve)));
  return {
    setup,
    release: async () => {
      free();
      await occupied;
    },
  };
}

describe("IMP-1 Rotate: POST /imports stores each page photo turned as the editor showed it", () => {
  it("'A card photographed upside down; Rotate pressed twice': a page sent with rotation 180 is stored turned 180°", async () => {
    const setup = await importApp(START);
    // jpeg(): 60 x 40, left half red, right half blue. Turned 180°, blue is on the left.
    const res = await startRotated(setup, "[180]", [await jpeg()]);

    expect(res.statusCode, res.body).toBe(202);
    const page = await stored(setup, 1);
    expect(await sizeOf(page)).toEqual([60, 40]);
    expectColor(await colorAt(page, 5, 20), "blue");
    expectColor(await colorAt(page, 54, 20), "red");
    await expectStrippedJpeg(page);
  });

  it("turns each photo by its own rotation, in order; 90 and 270 swap the stored page's width and height", async () => {
    const setup = await importApp(START);
    const res = await startRotated(setup, "[0,90,180,270]", [await jpeg(), await jpeg(), await jpeg(), await jpeg()]);

    expect(res.statusCode, res.body).toBe(202);
    const pages = await Promise.all([1, 2, 3, 4].map((n) => stored(setup, n)));
    expect(await Promise.all(pages.map(sizeOf))).toEqual([
      [60, 40],
      [40, 60],
      [60, 40],
      [40, 60],
    ]);
    // Where the red half ends up: on the left as sent, then at the top, on the right and at the bottom.
    expectColor(await colorAt(pages[0]!, 5, 20), "red");
    expectColor(await colorAt(pages[1]!, 20, 5), "red");
    expectColor(await colorAt(pages[2]!, 54, 20), "red");
    expectColor(await colorAt(pages[3]!, 20, 54), "red");
  });

  it("scales a turned page to at most 2048 px on its long side", async () => {
    const setup = await importApp(START);
    expect((await startRotated(setup, "[90]", [await jpeg(4096, 3072)])).statusCode).toBe(202);
    expect(await sizeOf(await stored(setup, 1))).toEqual([1536, 2048]);
  });

  it("applies the camera's EXIF rotation before the turn, and still removes all metadata", async () => {
    const setup = await importApp(START);
    // phoneJpeg(): shown by the camera as 40 x 60 with red on top; a quarter turn clockwise puts red on the right.
    expect((await startRotated(setup, "[90]", [await phoneJpeg()])).statusCode).toBe(202);
    const page = await stored(setup, 1);
    expect(await sizeOf(page)).toEqual([60, 40]);
    expectColor(await colorAt(page, 54, 20), "red");
    expectColor(await colorAt(page, 5, 20), "blue");
    await expectStrippedJpeg(page);
  });

  it("turns no photo without a rotations part", async () => {
    const setup = await importApp(START);
    expect((await startRotated(setup, undefined, [await jpeg(), await phoneJpeg()])).statusCode).toBe(202);
    expect(await sizeOf(await stored(setup, 1))).toEqual([60, 40]);
    expectColor(await colorAt(await stored(setup, 1), 5, 20), "red");
    // Only the camera's rotation.
    expect(await sizeOf(await stored(setup, 2))).toEqual([40, 60]);
    expectColor(await colorAt(await stored(setup, 2), 20, 5), "red");
  });

  it("accepts all zeros, as the client sends when no photo was turned", async () => {
    const setup = await importApp(START);
    expect((await startRotated(setup, "[0,0]", [await jpeg(), await jpeg()])).statusCode).toBe(202);
    expectColor(await colorAt(await stored(setup, 2), 5, 20), "red");
  });

  it("still names a refused photo as photos[i] when a rotations part is sent; nothing is stored", async () => {
    const setup = await importApp(START);
    const res = await startParts(setup, [
      { field: "rotations", value: "[90,180]" },
      { bytes: await jpeg() },
      { bytes: phoneHeic(), filename: "back.heic" },
    ]);
    const body = expectErrors(res, 400, ["photo.unsupportedType"]);
    expect(body.errors[0]?.field).toBe("photos[1]");
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });
});

describe("IMP-1 a rotations part that isn't one of 0, 90, 180 or 270 per photo: 400 photo.rotations, nothing stored", () => {
  it.each([
    ["not JSON", "upside down", 1],
    ["not a list", "180", 1],
    ["an object", '{"0":180}', 1],
    ["null", "null", 1],
    ["empty", "", 1],
    ["a turn of 45", "[45]", 1],
    ["a turn of 360", "[360]", 1],
    ["a turn of -90", "[-90]", 1],
    ["a turn as text", '["90"]', 1],
    ["a turn of 90.5", "[90.5]", 1],
    ["too short: one turn for two photos", "[0]", 2],
    ["too long: two turns for one photo", "[0,180]", 1],
    ["an empty list for one photo", "[]", 1],
    ["over 256 bytes, though a list of one 0", `[0${" ".repeat(300)}]`, 1],
  ])("refuses %s, before any photo is processed", async (_case, rotations, count) => {
    const { setup, release } = await appWithFullQueue();
    const files = await Promise.all(Array.from({ length: count }, () => jpeg()));

    const body = expectErrors(await startRotated(setup, rotations, files), 400, ["photo.rotations"]);

    expect(body.errors[0]?.field).toBe("rotations");
    expect(storedState(setup)).toEqual(NOTHING_STORED);
    await release();
  });

  it.each([
    ["isn't JSON", "[45"],
    ["is over 256 bytes", `[0${" ".repeat(300)}]`],
  ])("refuses a rotations part sent as application/json that %s, before any photo is processed", async (_case, value) => {
    const { setup, release } = await appWithFullQueue();
    const res = await startParts(setup, [
      { field: "rotations", value, contentType: "application/json" },
      { bytes: await jpeg() },
    ]);

    const body = expectErrors(res, 400, ["photo.rotations"]);

    expect(body.errors[0]?.field).toBe("rotations");
    expect(storedState(setup)).toEqual(NOTHING_STORED);
    await release();
  });

  it("accepts a good rotations part sent as application/json", async () => {
    const setup = await importApp(START);
    const res = await startParts(setup, [
      { field: "rotations", value: "[180]", contentType: "application/json" },
      { bytes: await jpeg() },
    ]);
    expect(res.statusCode, res.body).toBe(202);
    expectColor(await colorAt(await stored(setup, 1), 5, 20), "blue");
  });

  it("refuses a rotations part sent after the photos: it must come before them", async () => {
    const setup = await importApp(START);
    const res = await startParts(setup, [{ bytes: await jpeg() }, { field: "rotations", value: "[180]" }]);
    expectErrors(res, 400, ["photo.rotations"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it("refuses a second rotations part like any other extra part", async () => {
    const setup = await importApp(START);
    const res = await startParts(setup, [
      { field: "rotations", value: "[0]" },
      { field: "rotations", value: "[180]" },
      { bytes: await jpeg() },
    ]);
    expectErrors(res, 400, ["photo.required"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it("X-12: still refuses any other text part, next to a good rotations part", async () => {
    const setup = await importApp(START);
    const res = await startParts(setup, [
      { field: "rotations", value: "[0]" },
      { field: "startedAt", value: "2020-01-01T00:00:00Z" },
      { bytes: await jpeg() },
    ]);
    expectErrors(res, 400, ["photo.required"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it("refuses a rotations part with no photo as photo.required", async () => {
    const setup = await importApp(START);
    expectErrors(await startParts(setup, [{ field: "rotations", value: "[]" }]), 400, ["photo.required"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });
});

describe("IMP-2 more than 4 photos is refused as photo.tooMany first, whatever the rotations part says", () => {
  it.each([
    ["five good turns", "[0,90,180,270,0]"],
    ["four turns", "[0,90,180,270]"],
    ["a bad turn", "[45]"],
  ])("with %s", async (_case, rotations) => {
    const { setup, release } = await appWithFullQueue();
    const five = await Promise.all([1, 2, 3, 4, 5].map(() => jpeg()));

    const body = expectErrors(await startRotated(setup, rotations, five), 400, ["photo.tooMany"]);

    expect(body.errors[0]?.field).toBe("photos");
    expect(storedState(setup)).toEqual(NOTHING_STORED);
    await release();
  });
});

describe("X-6, CSRF: a rotations part changes nothing about who may upload, or how", () => {
  it("refuses a visitor before reading anything", async () => {
    const setup = await importApp(START);
    const res = await startRotated(setup, "[180]", [await jpeg()], { ...AS_VISITOR, ...UPLOAD_HEADERS });
    expectErrors(res, 401, ["auth.signInRequired"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it("refuses an upload without X-Requested-By with 403 request.headerMissing", async () => {
    const setup = await importApp(START);
    expectErrors(await startRotated(setup, "[180]", [await jpeg()], AS_EDITOR), 403, ["request.headerMissing"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });
});
