// Starting an import and listing the last day's imports (docs/api.md, "Import from a photo"; IMP-1 to IMP-5, IMP-10 to IMP-12,
// X-1, X-6, X-12).
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { Recipe, RecipeImport } from "@recipebox/domain";
import { ImportStatus } from "@recipebox/shared";
import { isRecipeImageName } from "../../src/photos/photo-names.js";
import { DecodeQueue, MAX_PHOTO_BYTES } from "../../src/photos/photo-processing.js";
import { instant } from "../app-helpers.js";
import { multipartBody, UPLOAD_HEADERS } from "../photos/photo-route-helpers.js";
import { expectStrippedJpeg, gif, jpeg, paddedJpeg, phoneHeic, phoneJpeg, TEXT_FILE } from "../photos/test-images.js";
import {
  AS_EDITOR,
  AS_NON_EDITOR,
  AS_VISITOR,
  content,
  expectErrors,
  get,
  recipeId,
  seed,
} from "../recipes/recipe-route-helpers.js";
import {
  AS_EDITOR_UPLOADING,
  FIRST_IMPORT_ID,
  importApp,
  importId,
  type ImportTestApp,
  NOTHING_STORED,
  SECOND_IMPORT_ID,
  startImport,
  startImportBody,
  storedState,
  THIRD_IMPORT_ID,
} from "./import-route-helpers.js";

const START = "2026-11-07T09:00:00.000Z";
const OTHER_ID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";

/** An app in which one import was started at START through the API. */
async function appReading(): Promise<ImportTestApp> {
  const setup = await importApp(START);
  const res = await startImport(setup.app, await jpeg());
  expect(res.statusCode, res.body).toBe(202);
  return setup;
}

/** Stores an ended import directly, as the import job will: done with "Banana Bread", or failed. */
async function storeEnded(setup: ImportTestApp, how: "done" | "failed", startedAt = START, id = OTHER_ID): Promise<void> {
  const recipeImport = RecipeImport.start(importId(id), instant(startedAt));
  if (how === "done") {
    const created = Recipe.create(recipeId("aaaaaaaa-0000-4000-8000-0000000000bb"), content("Banana Bread"), instant(startedAt).plusMinutes(2));
    if (!created.ok) throw new Error("invalid recipe");
    const succeeded = recipeImport.succeed(created.value, instant(startedAt).plusMinutes(2));
    if (!succeeded.ok) throw new Error("could not succeed");
  } else {
    recipeImport.fail();
  }
  await setup.imports.add(recipeImport);
}

async function listed(setup: ImportTestApp): Promise<ImportStatus[]> {
  const res = await get(setup.app, "/imports", AS_EDITOR);
  expect(res.statusCode, res.body).toBe(200);
  return ImportStatus.array().parse(res.json());
}

describe("IMP-1 start an import: POST /imports", () => {
  it("answers 202 with the import, reading", async () => {
    const setup = await importApp(START);

    const res = await startImport(setup.app, await jpeg());

    expect(res.statusCode, res.body).toBe(202);
    expect(ImportStatus.parse(res.json())).toStrictEqual({ importId: FIRST_IMPORT_ID, status: "reading" });
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("stores the import's own record, started at the server's time (X-12), with the id the server made", async () => {
    const setup = await importApp(START);
    await startImport(setup.app, await jpeg());
    expect(setup.imports.documentsStored()).toStrictEqual([{ id: FIRST_IMPORT_ID, startedAt: START, status: "reading" }]);
  });

  it("stores the page photo as imports/{importId}/1.jpg, a JPEG without metadata", async () => {
    const setup = await importApp(START);
    await startImport(setup.app, await phoneJpeg());

    expect(setup.photos.names()).toEqual([`imports/${FIRST_IMPORT_ID}/1.jpg`]);
    const image = await setup.photos.get(`imports/${FIRST_IMPORT_ID}/1.jpg`);
    expect(image?.contentType).toBe("image/jpeg");
    await expectStrippedJpeg(image!.bytes);
  });

  it("scales the page photo to at most 2048 px on its longer side", async () => {
    const setup = await importApp(START);
    await startImport(setup.app, await jpeg(4096, 3072));
    const image = await setup.photos.get(`imports/${FIRST_IMPORT_ID}/1.jpg`);
    const { width, height } = await sharp(image!.bytes).metadata();
    expect([width, height]).toEqual([2048, 1536]);
  });

  it("stores 1 to 4 photos of one recipe as imports/{importId}/{n}.jpg, n from 1 in the order sent, any field names", async () => {
    const setup = await importApp(START);
    const sizes = [
      [100, 50],
      [60, 40],
      [40, 60],
      [50, 100],
    ] as const;
    const files = await Promise.all(sizes.map(([w, h]) => jpeg(w, h)));
    const fields = ["photo", "back", "page", "photo"] as const;

    const res = await startImport(
      setup.app,
      files.map((bytes, i) => ({ bytes, field: fields[i]! })),
    );

    expect(res.statusCode, res.body).toBe(202);
    const names = [1, 2, 3, 4].map((n) => `imports/${FIRST_IMPORT_ID}/${n}.jpg`);
    expect(setup.photos.names()).toEqual(names);
    for (const [i, name] of names.entries()) {
      const stored = await setup.photos.get(name);
      const metadata = await expectStrippedJpeg(stored!.bytes);
      expect([metadata.width, metadata.height], name).toEqual(sizes[i]);
    }
    // One import: one record and one message, whatever the number of photos (IMP-3).
    expect(setup.imports.documentsStored()).toStrictEqual([{ id: FIRST_IMPORT_ID, startedAt: START, status: "reading" }]);
    expect(setup.queue.messages()).toEqual([JSON.stringify({ importId: FIRST_IMPORT_ID })]);
  });

  it("removes the metadata of every photo and scales each to at most 2048 px", async () => {
    const setup = await importApp(START);
    expect((await startImport(setup.app, [await jpeg(), await phoneJpeg(), await jpeg(4096, 3072)])).statusCode).toBe(202);
    const third = await setup.photos.get(`imports/${FIRST_IMPORT_ID}/3.jpg`);
    const { width, height } = await sharp(third!.bytes).metadata();
    expect([width, height]).toEqual([2048, 1536]);
    await expectStrippedJpeg((await setup.photos.get(`imports/${FIRST_IMPORT_ID}/2.jpg`))!.bytes);
  });

  it("queues one message with the import's id, and nothing else", async () => {
    const setup = await importApp(START);
    await startImport(setup.app, await jpeg());
    expect(setup.queue.messages().map((m) => JSON.parse(m) as unknown)).toStrictEqual([{ importId: FIRST_IMPORT_ID }]);
  });

  it("adds no recipe: the job does that later", async () => {
    const setup = await importApp(START);
    await startImport(setup.app, await jpeg());
    expect(await setup.recipes.list()).toEqual([]);
  });

  it("X-12: takes no time or anything else from the request: a field next to the file is refused", async () => {
    const setup = await importApp(START);
    const { payload, contentType } = multipartBody([{ field: "startedAt", value: "2020-01-01T00:00:00Z" }, { bytes: await jpeg() }]);
    expectErrors(await startImportBody(setup.app, payload, contentType), 400, ["photo.required"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });
});

describe("IMP-2 accepted photos: the same rules and photo.* errors as a recipe photo (REC-7)", () => {
  it.each([
    ["a HEIC file chosen from Files", async () => ({ bytes: phoneHeic(), filename: "IMG_0001.HEIC", contentType: "image/heic" })],
    ["a GIF", async () => ({ bytes: await gif(), filename: "card.gif", contentType: "image/gif" })],
    ["a text file named photo.jpg", async () => ({ bytes: TEXT_FILE, filename: "photo.jpg", contentType: "image/jpeg" })],
  ])("refuses %s at once with photo.unsupportedType; no import starts", async (_name, make) => {
    const setup = await importApp(START);

    const body = expectErrors(await startImport(setup.app, await make()), 400, ["photo.unsupportedType"]);

    expect(body.errors[0]?.message).toMatch(/JPEG, PNG or WebP/);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
    expect(await listed(setup)).toEqual([]);
  });

  it("accepts a file of exactly 15 MB", async () => {
    const setup = await importApp(START);
    expect((await startImport(setup.app, paddedJpeg(await jpeg(), MAX_PHOTO_BYTES))).statusCode).toBe(202);
  });

  it("refuses a file over 15 MB with photo.tooLarge; no import starts", async () => {
    const setup = await importApp(START);
    const body = expectErrors(await startImport(setup.app, paddedJpeg(await jpeg(), MAX_PHOTO_BYTES + 1)), 400, ["photo.tooLarge"]);
    expect(body.errors[0]?.field).toBe("photos[0]");
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it("refuses a damaged image with photo.unreadable; no import starts", async () => {
    const setup = await importApp(START);
    const damaged = Buffer.concat([(await jpeg()).subarray(0, 4), Buffer.alloc(300, 9)]);
    expectErrors(await startImport(setup.app, damaged), 400, ["photo.unreadable"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it.each([
    ["no file", async () => multipartBody([])],
    ["a text field instead of a file", async () => multipartBody([{ field: "photo", value: "hello" }])],
    ["a text field after a file", async () => multipartBody([{ bytes: await jpeg() }, { field: "note", value: "back" }])],
  ])("refuses %s with photo.required: only 1 to 4 files are expected", async (_name, make) => {
    const setup = await importApp(START);
    const { payload, contentType } = await make();
    const body = expectErrors(await startImportBody(setup.app, payload, contentType), 400, ["photo.required"]);
    expect(body.errors[0]?.field).toBe("photos");
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it("accepts 4 photos", async () => {
    const setup = await importApp(START);
    const res = await startImport(setup.app, [await jpeg(), await jpeg(), await jpeg(), await jpeg()]);
    expect(res.statusCode, res.body).toBe(202);
  });

  it("'An upload of 5 photos sent to the server': photo.tooMany before any photo is processed; no import", async () => {
    // A decode queue that is full: any photo processed would be refused as busy (503), so a 400 shows none was.
    const queue = new DecodeQueue(1, 0);
    const setup = await importApp(START, { queue });
    let release = (): void => undefined;
    const occupied = queue.run(() => new Promise<void>((resolve) => (release = resolve)));
    const five = [await jpeg(), await jpeg(), await jpeg(), await jpeg(), await jpeg()];

    const body = expectErrors(await startImport(setup.app, five), 400, ["photo.tooMany"]);

    expect(body.errors[0]?.field).toBe("photos");
    expect(storedState(setup)).toEqual(NOTHING_STORED);
    release();
    await occupied;
  });

  it("refuses 5 photos with the first over 15 MB as too many, not as too large: the number is checked first", async () => {
    const setup = await importApp(START);
    const files = [paddedJpeg(await jpeg(), MAX_PHOTO_BYTES + 1), await jpeg(), await jpeg(), await jpeg(), await jpeg()];

    const body = expectErrors(await startImport(setup.app, files), 400, ["photo.tooMany"]);

    expect(body.errors[0]?.field).toBe("photos");
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it("refuses 5 HEIC files as too many, not as unsupported: the number is checked first", async () => {
    const setup = await importApp(START);
    const heic = { bytes: phoneHeic(), filename: "IMG_0001.HEIC", contentType: "image/heic" };
    expectErrors(await startImport(setup.app, [heic, heic, heic, heic, heic]), 400, ["photo.tooMany"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  const damaged = async () => ({ bytes: Buffer.concat([(await jpeg()).subarray(0, 4), Buffer.alloc(300, 9)]) });
  const tooLarge = async () => ({ bytes: paddedJpeg(await jpeg(), MAX_PHOTO_BYTES + 1) });

  it.each([
    ["a HEIC file as the second photo", 1, "photo.unsupportedType", async () => ({ bytes: phoneHeic(), filename: "b.heic" })],
    ["a text file as the third photo", 2, "photo.unsupportedType", async () => ({ bytes: TEXT_FILE })],
    ["a damaged image as the second photo", 1, "photo.unreadable", damaged],
    ["a file over 15 MB as the fourth photo", 3, "photo.tooLarge", tooLarge],
    ["a file over 15 MB as the first photo", 0, "photo.tooLarge", tooLarge],
    ["a file over 15 MB as the second photo", 1, "photo.tooLarge", tooLarge],
  ])("names the photo refused, %s, as photos[%i]; those already stored are deleted, no import", async (_case, index, code, make) => {
    const setup = await importApp(START);
    const files = [await jpeg(), await jpeg(), await jpeg(), await jpeg()].map((bytes) => ({ bytes }));
    files[index] = await make();

    const body = expectErrors(await startImport(setup.app, files), 400, [code]);

    expect(body.errors[0]?.field).toBe(`photos[${index}]`);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it("deletes the photos already stored when a later one can't be stored (500); no import starts", async () => {
    const setup = await importApp(START);
    setup.photos.putsBeforeFailure = 2;

    expectErrors(await startImport(setup.app, [await jpeg(), await jpeg(), await jpeg()]), 500, ["server.error"]);

    expect(setup.photos.puts).toBe(3);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it("deletes the photos already stored when a later one is refused as busy (503); no import starts", async () => {
    // A queue with room for one decode only: the second photo finds it taken.
    class OneDecode extends DecodeQueue {
      private decodes = 0;
      override run<T>(task: () => Promise<T>): Promise<T> | undefined {
        return ++this.decodes > 1 ? undefined : super.run(task);
      }
    }
    const setup = await importApp(START, { queue: new OneDecode() });

    expectErrors(await startImport(setup.app, [await jpeg(), await jpeg()]), 503, ["photo.busy"]);

    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it("refuses with 503 photo.busy when too many uploads are waiting to be decoded; no import starts", async () => {
    const queue = new DecodeQueue(1, 0);
    const setup = await importApp(START, { queue });
    let release = (): void => undefined;
    const occupied = queue.run(() => new Promise<void>((resolve) => (release = resolve)));

    expectErrors(await startImport(setup.app, await jpeg()), 503, ["photo.busy"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);

    release();
    await occupied;
    expect((await startImport(setup.app, await jpeg())).statusCode).toBe(202);
  });

  it("refuses a JSON body with 415", async () => {
    const setup = await importApp(START);
    const res = await setup.app.inject({
      method: "POST",
      url: "/imports",
      headers: { ...AS_EDITOR_UPLOADING, "content-type": "application/json" },
      payload: "{}",
    });
    expectErrors(res, 415, ["request.unsupportedMediaType"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });
});

describe("IMP-3 one recipe per upload, any number at once", () => {
  it("starts a second import while the first is still reading, each with its own record, photo and message", async () => {
    const setup = await appReading();
    setup.clock.set("2026-11-07T09:00:30.000Z");

    const res = await startImport(setup.app, await jpeg());

    expect(res.statusCode, res.body).toBe(202);
    expect(ImportStatus.parse(res.json())).toStrictEqual({ importId: SECOND_IMPORT_ID, status: "reading" });
    expect(setup.imports.documentsStored()).toStrictEqual([
      { id: FIRST_IMPORT_ID, startedAt: START, status: "reading" },
      { id: SECOND_IMPORT_ID, startedAt: "2026-11-07T09:00:30.000Z", status: "reading" },
    ]);
    expect(setup.photos.names()).toEqual([`imports/${FIRST_IMPORT_ID}/1.jpg`, `imports/${SECOND_IMPORT_ID}/1.jpg`]);
    expect(setup.queue.messages()).toEqual([
      JSON.stringify({ importId: FIRST_IMPORT_ID }),
      JSON.stringify({ importId: SECOND_IMPORT_ID }),
    ]);
  });

  it("starts imports sent together, from different editors (X-2)", async () => {
    const setup = await importApp(START);
    const file = await jpeg();

    const results = await Promise.all([
      startImport(setup.app, file),
      startImport(setup.app, file, { "x-dev-identity": "aad:9f3c", ...UPLOAD_HEADERS }),
      startImport(setup.app, file),
    ]);

    expect(results.map((r) => r.statusCode)).toEqual([202, 202, 202]);
    expect(setup.imports.documentsStored()).toHaveLength(3);
    expect(setup.photos.names()).toHaveLength(3);
    expect(setup.queue.messages()).toHaveLength(3);
  });

  it("Two photos uploaded one after the other: two imports reading", async () => {
    const setup = await appReading();
    await startImport(setup.app, await jpeg());
    expect((await listed(setup)).map((s) => s.status)).toEqual(["reading", "reading"]);
  });

  it("an import that fails leaves the others in progress (IMP-11)", async () => {
    const setup = await appReading();
    await storeEnded(setup, "failed", "2026-11-07T08:59:00.000Z");
    expect(await listed(setup)).toStrictEqual([
      { importId: FIRST_IMPORT_ID, status: "reading" },
      { importId: OTHER_ID, status: "failed" },
    ]);
  });
});

describe("IMP-4 if the upload fails, no import is in progress and nothing is left stored", () => {
  it("stores no record when the photo can't be stored (500)", async () => {
    const setup = await importApp(START);
    setup.photos.failPuts = true;
    expectErrors(await startImport(setup.app, await jpeg()), 500, ["server.error"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it("deletes the photos when the record can't be stored (500)", async () => {
    const setup = await importApp(START);
    setup.imports.failAdds = true;
    expectErrors(await startImport(setup.app, [await jpeg(), await jpeg()]), 500, ["server.error"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it("ends the import as failed and deletes all its photos when it can't be queued (500)", async () => {
    const setup = await importApp(START);
    setup.queue.failSends = true;

    expectErrors(await startImport(setup.app, [await jpeg(), await jpeg(), await jpeg()]), 500, ["server.error"]);

    expect(setup.photos.names()).toEqual([]);
    expect(setup.imports.documentsStored()).toStrictEqual([{ id: FIRST_IMPORT_ID, startedAt: START, status: "failed" }]);
    expect(await listed(setup)).toStrictEqual([{ importId: FIRST_IMPORT_ID, status: "failed" }]);
  });

  it("logs a queueing failure as an ordinary error with the import id, not as recipe-import-failed", async () => {
    const lines: Record<string, unknown>[] = [];
    const { appWith } = await import("../app-helpers.js");
    const { InMemoryImportQueue } = await import("../../src/imports/in-memory-import-queue.js");
    const queue = new InMemoryImportQueue();
    queue.failSends = true;
    const app = await appWith(
      {},
      { level: "info", stream: { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) } },
      { importQueue: queue },
    );

    expect((await startImport(app, await jpeg())).statusCode).toBe(500);

    const queueing = lines.find((l) => l.msg === "could not queue an import; it is ended");
    expect(queueing?.level).toBe(50);
    expect(typeof queueing?.importId).toBe("string");
    expect(lines.some((l) => l.event === "recipe-import-failed")).toBe(false);
  });

  it("still deletes the photo when the import can't be queued and can't be ended either", async () => {
    const setup = await importApp(START);
    setup.queue.failSends = true;
    setup.imports.failSaves = true;

    expectErrors(await startImport(setup.app, await jpeg()), 500, ["server.error"]);

    expect(setup.photos.names()).toEqual([]);
    expect(setup.queue.messages()).toEqual([]);
    // Left reading, it is failed once its 10 minutes are up (IMP-11).
    setup.clock.set("2026-11-07T09:10:00.000Z");
    expect(await listed(setup)).toStrictEqual([{ importId: FIRST_IMPORT_ID, status: "failed" }]);
  });
});

describe("IMP-5 the last day's imports: GET /imports", () => {
  it("answers an empty list when there are none", async () => {
    const setup = await importApp(START);
    expect(await listed(setup)).toEqual([]);
  });

  it("lists every import, newest first, to every editor", async () => {
    const setup = await appReading();
    setup.clock.set("2026-11-07T09:02:00.000Z");
    await startImport(setup.app, await jpeg());
    setup.clock.set("2026-11-07T09:01:00.000Z");
    await startImport(setup.app, await jpeg());
    await storeEnded(setup, "done", "2026-11-07T08:30:00.000Z");

    const res = await get(setup.app, "/imports", { "x-dev-identity": "aad:9f3c" });

    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(ImportStatus.array().parse(res.json()).map((s) => s.importId)).toEqual([
      SECOND_IMPORT_ID,
      THIRD_IMPORT_ID,
      FIRST_IMPORT_ID,
      OTHER_ID,
    ]);
  });

  it("orders imports started at the same moment by id, so the order is stable", async () => {
    const setup = await appReading();
    await startImport(setup.app, await jpeg());
    expect((await listed(setup)).map((s) => s.importId)).toEqual([FIRST_IMPORT_ID, SECOND_IMPORT_ID]);
  });

  it("IMP-10: reports a done import with its recipe's id and name", async () => {
    const setup = await importApp(START);
    await storeEnded(setup, "done");
    expect(await listed(setup)).toStrictEqual([
      { importId: OTHER_ID, status: "done", recipeId: "aaaaaaaa-0000-4000-8000-0000000000bb", recipeName: "Banana Bread" },
    ]);
  });

  it("IMP-11: reports a failed import as failed, with no reason", async () => {
    const setup = await importApp(START);
    await storeEnded(setup, "failed");
    expect(await listed(setup)).toStrictEqual([{ importId: OTHER_ID, status: "failed" }]);
  });

  it.each([
    ["2026-11-07T09:09:59.999Z", "reading"],
    ["2026-11-07T09:10:00.000Z", "failed"],
  ] as const)("IMP-11, X-12: an import still reading reads at %s as %s, by the server's clock", async (now, status) => {
    const setup = await appReading();
    setup.clock.set(now);
    expect(await listed(setup)).toStrictEqual([{ importId: FIRST_IMPORT_ID, status }]);
    // The stored record is unchanged; only how it is read depends on the time.
    expect(setup.imports.documentsStored()[0]?.status).toBe("reading");
  });
});

describe("X-6 only editors start imports", () => {
  for (const [who, as, status, code] of [
    ["a visitor", AS_VISITOR, 401, "auth.signInRequired"],
    ["a signed-in non-editor", AS_NON_EDITOR, 403, "auth.notEditor"],
  ] as const) {
    it(`refuses ${who} before reading the file, and stores nothing`, async () => {
      const setup = await importApp(START);
      const answers = new Set<string>();

      for (const file of [await jpeg(), phoneHeic(), paddedJpeg(await jpeg(), 20 * 1024 * 1024)]) {
        const res = await startImport(setup.app, file, { ...as, ...UPLOAD_HEADERS });
        expectErrors(res, status, [code]);
        answers.add(res.body);
      }

      expect(answers.size).toBe(1);
      expect(storedState(setup)).toEqual(NOTHING_STORED);
    });
  }
});

describe('architecture "Sign-in": CSRF, POST /imports is an upload and needs X-Requested-By', () => {
  it.each([
    ["no X-Requested-By, as a form on another site sends it", AS_EDITOR],
    ["another X-Requested-By value", { ...AS_EDITOR, "x-requested-by": "evil" }],
  ])("refuses an upload with %s with 403 request.headerMissing, storing nothing", async (_case, headers) => {
    const setup = await importApp(START);
    expectErrors(await startImport(setup.app, await jpeg(), headers), 403, ["request.headerMissing"]);
    expect(storedState(setup)).toEqual(NOTHING_STORED);
  });

  it.each(["application/x-www-form-urlencoded", "text/plain"])(
    "refuses an upload sent as %s, which a form on another site could send",
    async (contentType) => {
      const setup = await importApp(START);
      expectErrors(await startImportBody(setup.app, await jpeg(), contentType), 415, ["request.unsupportedMediaType"]);
      expect(storedState(setup)).toEqual(NOTHING_STORED);
    },
  );
});

describe("X-1, IMP-5 imports are private", () => {
  for (const [who, as, status, code] of [
    ["a visitor", AS_VISITOR, 401, "auth.signInRequired"],
    ["a signed-in non-editor", AS_NON_EDITOR, 403, "auth.notEditor"],
  ] as const) {
    it(`refuses ${who} GET /imports the same whether or not there are imports, without reading them`, async () => {
      const none = await importApp(START);
      const reading = await appReading();
      const answers = new Set<string>();
      for (const setup of [none, reading]) {
        setup.imports.reads = 0;
        const res = await get(setup.app, "/imports", as);
        expectErrors(res, status, [code]);
        answers.add(res.body);
        expect(setup.imports.reads).toBe(0);
      }
      expect(answers.size).toBe(1);
    });
  }

  it("A visitor opens the Catalog during an import: nothing about the import in any public answer", async () => {
    const setup = await appReading();
    await seed(setup.recipes, content("Pad Thai"));
    for (const url of ["/recipes", "/tags", "/me", `/recipes/${FIRST_IMPORT_ID}`]) {
      const res = await get(setup.app, url, AS_VISITOR);
      expect(res.body, url).not.toContain(FIRST_IMPORT_ID);
      expect(res.body, url).not.toMatch(/import/i);
    }
  });
});

describe("IMP-12 the page photos are never shown", () => {
  it("is not served by the photo routes, to editors or visitors", async () => {
    const setup = await appReading();
    expect(await setup.photos.get(`imports/${FIRST_IMPORT_ID}/1.jpg`)).toBeDefined();

    for (const as of [AS_EDITOR, AS_VISITOR]) {
      for (const path of ["photo", "thumbnail"]) {
        const res = await get(setup.app, `/recipes/${FIRST_IMPORT_ID}/${path}`, as);
        expect(res.statusCode, `${path}`).toBe(404);
        expect(res.headers["content-type"]).toMatch(/^application\/json/);
      }
    }
  });

  it("is not a recipe image name, so the trash cleanup's orphan sweep never deletes it", () => {
    expect(isRecipeImageName(`imports/${FIRST_IMPORT_ID}/1.jpg`)).toBe(false);
  });

  it("is not reachable through a path that names it", async () => {
    const setup = await appReading();
    for (const url of [`/imports/${FIRST_IMPORT_ID}/1.jpg`, `/imports/${FIRST_IMPORT_ID}`, `/imports/${FIRST_IMPORT_ID}/photo`]) {
      for (const as of [AS_EDITOR, AS_VISITOR]) {
        const res = await get(setup.app, url, as);
        expect(res.statusCode, url).toBe(404);
        expect(res.headers["content-type"], url).toMatch(/^application\/json/);
      }
    }
  });
});
