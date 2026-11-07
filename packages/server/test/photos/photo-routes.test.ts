// The photo endpoints (docs/api.md): upload, replace and remove (REC-7), trashed recipes (REC-17, X-1) and serving with cache
// headers. Access and CSRF checks are in photo-access.test.ts.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { EditorRecipe, PublicRecipe, RecipeSummary } from "@recipebox/shared";
import { DecodeQueue, MAX_PHOTO_BYTES } from "../../src/photos/photo-processing.js";
import {
  AS_EDITOR,
  AS_NON_EDITOR,
  AS_VISITOR,
  change,
  content,
  expectErrors,
  get,
  recipeId,
  seed,
  storedSnapshots,
} from "../recipes/recipe-route-helpers.js";
import {
  multipartBody,
  photoApp,
  type PhotoTestApp,
  UPLOAD_HEADERS,
  uploadBody,
  uploadPhoto,
} from "./photo-route-helpers.js";
import {
  colorAt,
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

const UNKNOWN_ID = "bbbbbbbb-0000-4000-8000-000000000000";

/** An app with one recipe, "Pad Thai", without a photo. */
async function appWithRecipe(): Promise<PhotoTestApp & { id: string }> {
  const setup = await photoApp();
  const recipe = await seed(setup.repository, content("Pad Thai"));
  return { ...setup, id: recipe.id.value };
}

/** An app with one recipe that already has a photo, uploaded through the API. */
async function appWithPhoto(): Promise<PhotoTestApp & { id: string; images: string[] }> {
  const setup = await appWithRecipe();
  const res = await uploadPhoto(setup.app, setup.id, await jpeg());
  expect(res.statusCode, res.body).toBe(200);
  return { ...setup, images: setup.photos.names() };
}

async function storedPhotoName(setup: PhotoTestApp, id: string): Promise<string | undefined> {
  return (await setup.repository.get(recipeId(id)))?.photo?.blobName;
}

/** Nothing changed: the same recipe documents and the same stored images. */
async function stateOf(setup: PhotoTestApp): Promise<{ recipes: Record<string, unknown>; images: string[] }> {
  return { recipes: await storedSnapshots(setup.repository), images: setup.photos.names() };
}

async function moveToTrash(setup: PhotoTestApp, id: string): Promise<void> {
  expect((await change(setup.app, "DELETE", `/recipes/${id}`)).statusCode).toBe(204);
}

describe("REC-7 add a photo", () => {
  it("stores a display image and a thumbnail, and the recipe refers to them", async () => {
    const setup = await appWithRecipe();

    const res = await uploadPhoto(setup.app, setup.id, await jpeg());

    expect(res.statusCode, res.body).toBe(200);
    const body = EditorRecipe.parse(res.json());
    expect(body.hasPhoto).toBe(true);
    expect(body.name).toBe("Pad Thai");
    const name = await storedPhotoName(setup, setup.id);
    expect(name).toMatch(new RegExp(`^photos/${setup.id}/[0-9a-f-]{36}\\.jpg$`));
    expect(setup.photos.names()).toEqual([name, name!.replace(/\.jpg$/, ".thumbnail.jpg")].sort());
    const stored = await setup.repository.get(recipeId(setup.id));
    expect(stored?.photo?.contentType).toBe("image/jpeg");
  });

  it.each([
    ["JPEG", jpeg, "photo.jpg", "image/jpeg"],
    ["PNG", png, "photo.png", "image/png"],
    ["WebP", webp, "photo.webp", "image/webp"],
  ] as const)("accepts a %s and stores JPEG images", async (_name, make, filename, contentType) => {
    const setup = await appWithRecipe();

    const res = await uploadPhoto(setup.app, setup.id, { bytes: await make(), filename, contentType });

    expect(res.statusCode, res.body).toBe(200);
    for (const name of setup.photos.names()) {
      const image = await setup.photos.get(name);
      expect(image?.contentType).toBe("image/jpeg");
      expect((await sharp(image!.bytes).metadata()).format).toBe("jpeg");
    }
  });

  it("goes by the file's bytes, not its name or the type the browser claims", async () => {
    const setup = await appWithRecipe();
    const res = await uploadPhoto(setup.app, setup.id, {
      bytes: await png(),
      filename: "notes.txt",
      contentType: "text/plain",
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it("accepts a file of exactly 15 MB", async () => {
    const setup = await appWithRecipe();
    const res = await uploadPhoto(setup.app, setup.id, paddedJpeg(await jpeg(), MAX_PHOTO_BYTES));
    expect(res.statusCode, res.body).toBe(200);
  });

  it("shows hasPhoto in the editor's and the visitor's views of the recipe and the list", async () => {
    const setup = await appWithRecipe();
    await uploadPhoto(setup.app, setup.id, await jpeg());

    expect(EditorRecipe.parse((await get(setup.app, `/recipes/${setup.id}`, AS_EDITOR)).json()).hasPhoto).toBe(true);
    expect(PublicRecipe.parse((await get(setup.app, `/recipes/${setup.id}`)).json()).hasPhoto).toBe(true);
    expect(RecipeSummary.array().parse((await get(setup.app, "/recipes")).json())[0]?.hasPhoto).toBe(true);
  });

  it("answers 404 for an unknown or malformed id, storing nothing", async () => {
    const setup = await appWithRecipe();
    const before = await stateOf(setup);
    for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
      expectErrors(await uploadPhoto(setup.app, id, await jpeg()), 404, ["recipe.notFound"]);
    }
    expect(await stateOf(setup)).toEqual(before);
  });
});

describe("REC-7 anything else is rejected and the recipe is unchanged", () => {
  it("Upload a 20 MB JPEG -> Rejected: too large; existing photo kept", async () => {
    const setup = await appWithPhoto();
    const before = await stateOf(setup);
    const twentyMegabytes = paddedJpeg(await jpeg(), 20 * 1024 * 1024);

    const res = await uploadPhoto(setup.app, setup.id, twentyMegabytes);

    expectErrors(res, 400, ["photo.tooLarge"]);
    expect(await stateOf(setup)).toEqual(before);
    expect((await get(setup.app, `/recipes/${setup.id}/photo`)).statusCode).toBe(200);
  });

  it("refuses one byte over 15 MB", async () => {
    const setup = await appWithRecipe();
    const res = await uploadPhoto(setup.app, setup.id, paddedJpeg(await jpeg(), MAX_PHOTO_BYTES + 1));
    expectErrors(res, 400, ["photo.tooLarge"]);
    expect(setup.photos.names()).toEqual([]);
  });

  it.each([
    ["a text file renamed photo.jpg", async () => ({ bytes: TEXT_FILE, filename: "photo.jpg", contentType: "image/jpeg" })],
    ["a GIF", async () => ({ bytes: await gif(), filename: "photo.gif", contentType: "image/gif" })],
    ["a GIF named photo.jpg", async () => ({ bytes: await gif(), filename: "photo.jpg", contentType: "image/jpeg" })],
    ["a HEIC from an iPhone", async () => ({ bytes: phoneHeic(), filename: "IMG_0001.HEIC", contentType: "image/heic" })],
  ])("rejects %s, keeping the existing photo", async (_name, make) => {
    const setup = await appWithPhoto();
    const before = await stateOf(setup);

    const res = await uploadPhoto(setup.app, setup.id, await make());

    const body = expectErrors(res, 400, ["photo.unsupportedType"]);
    expect(body.errors[0]?.message).toMatch(/JPEG, PNG or WebP/);
    expect(await stateOf(setup)).toEqual(before);
  });

  it("rejects a damaged image", async () => {
    const setup = await appWithRecipe();
    const damaged = Buffer.concat([(await jpeg()).subarray(0, 4), Buffer.alloc(300, 9)]);
    expectErrors(await uploadPhoto(setup.app, setup.id, damaged), 400, ["photo.unreadable"]);
    expect(setup.photos.names()).toEqual([]);
  });


  it("refuses with photo.unreadable when the decoder crashes, and keeps serving", async () => {
    const setup = await photoApp(undefined, { workerUrl: new URL("./workers/throw.mjs", import.meta.url) });
    const recipe = await seed(setup.repository, content("Pad Thai"));
    const id = recipe.id.value;
    const before = await stateOf(setup);

    expectErrors(await uploadPhoto(setup.app, id, await jpeg()), 400, ["photo.unreadable"]);

    expect(await stateOf(setup)).toEqual(before);
    expect((await get(setup.app, `/recipes/${id}`)).statusCode).toBe(200);
    expect((await get(setup.app, "/health")).statusCode).toBe(200);
  });

  it("refuses with photo.unreadable when decoding takes longer than the time limit, and keeps serving", async () => {
    const setup = await photoApp(undefined, { workerUrl: new URL("./workers/hang.mjs", import.meta.url), timeoutMs: 300 });
    const recipe = await seed(setup.repository, content("Pad Thai"));
    const id = recipe.id.value;
    const before = await stateOf(setup);

    expectErrors(await uploadPhoto(setup.app, id, await jpeg()), 400, ["photo.unreadable"]);

    expect(await stateOf(setup)).toEqual(before);
    expect((await get(setup.app, `/recipes/${id}`)).statusCode).toBe(200);
    expect((await get(setup.app, "/health")).statusCode).toBe(200);
  });

  it("refuses with 503 photo.busy when too many uploads are waiting to be decoded, keeping the photo", async () => {
    const queue = new DecodeQueue(1, 0);
    const setup = await photoApp(undefined, { queue });
    const recipe = await seed(setup.repository, content("Pad Thai"));
    const id = recipe.id.value;
    expect((await uploadPhoto(setup.app, id, await jpeg())).statusCode).toBe(200);
    const before = await stateOf(setup);
    let release = (): void => undefined;
    const occupied = queue.run(() => new Promise<void>((resolve) => (release = resolve)));

    expectErrors(await uploadPhoto(setup.app, id, await jpeg()), 503, ["photo.busy"]);
    expect(await stateOf(setup)).toEqual(before);

    release();
    await occupied;
    expect((await uploadPhoto(setup.app, id, await jpeg())).statusCode).toBe(200);
  });

  it.each([
    ["no file", () => multipartBody([])],
    ["two files", async () => multipartBody([{ bytes: await jpeg() }, { field: "other", bytes: await jpeg() }])],
    ["a text field instead of a file", async () => multipartBody([{ field: "photo", value: "hello" }])],
    ["a text field and a file", async () => multipartBody([{ field: "note", value: "x" }, { bytes: await jpeg() }])],
    ["a file and a text field", async () => multipartBody([{ bytes: await jpeg() }, { field: "note", value: "x" }])],
  ])("refuses %s: exactly one file is expected", async (_name, make) => {
    const setup = await appWithRecipe();
    const { payload, contentType } = await make();
    expectErrors(await uploadBody(setup.app, setup.id, payload, contentType), 400, ["photo.required"]);
    expect(await storedPhotoName(setup, setup.id)).toBeUndefined();
    expect(setup.photos.names()).toEqual([]);
  });

  it("refuses a malformed multipart body", async () => {
    const setup = await appWithRecipe();
    const res = await uploadBody(setup.app, setup.id, Buffer.from("--x\r\nnonsense"), "multipart/form-data; boundary=x");
    expectErrors(res, 400, ["photo.required"]);
  });

  it("refuses a JSON body with 415: the photo is sent as multipart/form-data", async () => {
    const setup = await appWithRecipe();
    const res = await change(
      setup.app,
      "PUT",
      `/recipes/${setup.id}/photo`,
      { photo: "data:image/jpeg;base64,AAAA" },
      { ...AS_EDITOR, ...UPLOAD_HEADERS },
    );
    expectErrors(res, 415, ["request.unsupportedMediaType"]);
  });
});

describe("REC-7 photos display correctly oriented, without metadata", () => {
  it("applies the camera's rotation to the photo and the thumbnail", async () => {
    const setup = await appWithRecipe();
    await uploadPhoto(setup.app, setup.id, await phoneJpeg());

    for (const which of ["photo", "thumbnail"]) {
      const res = await get(setup.app, `/recipes/${setup.id}/${which}`);
      const bytes = res.rawPayload;
      const { width, height } = await sharp(bytes).metadata();
      expect([width, height], which).toEqual([40, 60]);
      expectColor(await colorAt(bytes, 20, 5), "red");
      expectColor(await colorAt(bytes, 20, 55), "blue");
    }
  });

  it.each([
    ["JPEG", phoneJpeg],
  ] as const)("stores no EXIF, GPS location or other metadata from a phone %s, in either image", async (_name, make) => {
    const setup = await appWithRecipe();
    await uploadPhoto(setup.app, setup.id, await make());

    const names = setup.photos.names();
    expect(names).toHaveLength(2);
    for (const name of names) await expectStrippedJpeg((await setup.photos.get(name))!.bytes);
    for (const which of ["photo", "thumbnail"]) {
      await expectStrippedJpeg((await get(setup.app, `/recipes/${setup.id}/${which}`)).rawPayload);
    }
  });

  it("serves a thumbnail of at most 400 px and a display image of at most 2000 px", async () => {
    const setup = await appWithRecipe();
    await uploadPhoto(setup.app, setup.id, await jpeg(3000, 2400));

    const photo = await sharp((await get(setup.app, `/recipes/${setup.id}/photo`)).rawPayload).metadata();
    const thumbnail = await sharp((await get(setup.app, `/recipes/${setup.id}/thumbnail`)).rawPayload).metadata();
    expect([photo.width, photo.height]).toEqual([2000, 1600]);
    expect([thumbnail.width, thumbnail.height]).toEqual([400, 320]);
  });
});

describe("REC-7 replacing or removing a photo deletes the previous images", () => {
  it("replace: stores the new images, then deletes the old ones", async () => {
    const setup = await appWithPhoto();

    const res = await uploadPhoto(setup.app, setup.id, await png());

    expect(res.statusCode, res.body).toBe(200);
    const name = await storedPhotoName(setup, setup.id);
    expect(setup.images).not.toContain(name);
    expect(setup.photos.names()).toEqual([name, name!.replace(/\.jpg$/, ".thumbnail.jpg")].sort());
  });

  it("remove: saves the recipe without a photo and deletes both images", async () => {
    const setup = await appWithPhoto();

    const res = await change(setup.app, "DELETE", `/recipes/${setup.id}/photo`);

    expect(res.statusCode, res.body).toBe(200);
    expect(EditorRecipe.parse(res.json()).hasPhoto).toBe(false);
    expect(await storedPhotoName(setup, setup.id)).toBeUndefined();
    expect(setup.photos.names()).toEqual([]);
    expectErrors(await get(setup.app, `/recipes/${setup.id}/photo`), 404, ["photo.notFound"]);
  });

  it("remove: a recipe without a photo is returned unchanged", async () => {
    const setup = await appWithRecipe();
    const before = await stateOf(setup);
    const res = await change(setup.app, "DELETE", `/recipes/${setup.id}/photo`);
    expect(EditorRecipe.parse(res.json()).hasPhoto).toBe(false);
    expect(await stateOf(setup)).toEqual(before);
  });

  it("remove: the body must be {} (EmptyRequest)", async () => {
    const setup = await appWithPhoto();
    const before = await stateOf(setup);
    const res = await change(setup.app, "DELETE", `/recipes/${setup.id}/photo`, { blobName: setup.images[0] });
    expectErrors(res, 400, ["request.unknownField"]);
    expect(await stateOf(setup)).toEqual(before);
  });

  it("remove: 404 for an unknown recipe", async () => {
    const setup = await appWithRecipe();
    expectErrors(await change(setup.app, "DELETE", `/recipes/${UNKNOWN_ID}/photo`), 404, ["recipe.notFound"]);
  });

  it("a failed save deletes the new images and keeps the previous photo", async () => {
    const setup = await appWithPhoto();
    const before = await stateOf(setup);
    setup.repository.failSaves = true;

    const res = await uploadPhoto(setup.app, setup.id, await png());

    expectErrors(res, 500, ["server.error"]);
    expect(await stateOf(setup)).toEqual(before);
    expect((await get(setup.app, `/recipes/${setup.id}/photo`)).statusCode).toBe(200);
  });

  it("a failed save on remove keeps the images the recipe still refers to", async () => {
    const setup = await appWithPhoto();
    const before = await stateOf(setup);
    setup.repository.failSaves = true;

    expectErrors(await change(setup.app, "DELETE", `/recipes/${setup.id}/photo`), 500, ["server.error"]);

    expect(await stateOf(setup)).toEqual(before);
  });

  it("an image that can't be deleted after the save is left behind, and the change still succeeds", async () => {
    const setup = await appWithPhoto();
    const original = setup.photos.delete.bind(setup.photos);
    setup.photos.delete = async () => {
      throw new Error("Blob Storage is unavailable");
    };

    const res = await uploadPhoto(setup.app, setup.id, await png());

    expect(res.statusCode, res.body).toBe(200);
    setup.photos.delete = original;
    expect(setup.photos.names()).toEqual(expect.arrayContaining(setup.images));
    expect(setup.images).not.toContain(await storedPhotoName(setup, setup.id));
  });
});

describe("REC-17 a trashed recipe's photo can't be changed", () => {
  it("refuses an upload with 409 recipe.inTrash, whatever the file, and stores nothing", async () => {
    const setup = await appWithPhoto();
    await moveToTrash(setup, setup.id);
    const before = await stateOf(setup);

    for (const file of [await jpeg(), TEXT_FILE, paddedJpeg(await jpeg(), 20 * 1024 * 1024)]) {
      expectErrors(await uploadPhoto(setup.app, setup.id, file), 409, ["recipe.inTrash"]);
    }
    expect(await stateOf(setup)).toEqual(before);
  });

  it("refuses removal with 409 recipe.inTrash and keeps the images for a restore (REC-15)", async () => {
    const setup = await appWithPhoto();
    await moveToTrash(setup, setup.id);
    const before = await stateOf(setup);

    expectErrors(await change(setup.app, "DELETE", `/recipes/${setup.id}/photo`), 409, ["recipe.inTrash"]);

    expect(await stateOf(setup)).toEqual(before);
    const restored = await change(setup.app, "POST", `/trash/${setup.id}/restore`);
    expect(EditorRecipe.parse(restored.json()).hasPhoto).toBe(true);
    expect((await get(setup.app, `/recipes/${setup.id}/photo`)).statusCode).toBe(200);
  });

  it("refuses removal from a trashed recipe without a photo too", async () => {
    const setup = await appWithRecipe();
    await moveToTrash(setup, setup.id);
    expectErrors(await change(setup.app, "DELETE", `/recipes/${setup.id}/photo`), 409, ["recipe.inTrash"]);
  });

  it("deletes the new images if the recipe is moved to the trash while the upload is processed", async () => {
    const setup = await appWithPhoto();
    const before = setup.photos.names();
    // Trash the recipe between the first lookup and the save, as another device could.
    const put = setup.photos.put.bind(setup.photos);
    let trashed = false;
    setup.photos.put = async (name, bytes, type) => {
      await put(name, bytes, type);
      if (!trashed) {
        trashed = true;
        const recipe = await setup.repository.get(recipeId(setup.id));
        recipe!.delete(setup.clock.now());
        await setup.repository.save(recipe!);
      }
    };

    expectErrors(await uploadPhoto(setup.app, setup.id, await png()), 409, ["recipe.inTrash"]);

    expect(setup.photos.names()).toEqual(before);
  });
});

describe("X-1, REC-14 photos of trashed recipes are private to editors", () => {
  for (const [who, as] of [
    ["a visitor", AS_VISITOR],
    ["a signed-in non-editor", AS_NON_EDITOR],
  ] as const) {
    it(`answers ${who} 404 for the photo and thumbnail of a trashed recipe, as for an unknown one`, async () => {
      const setup = await appWithPhoto();
      await moveToTrash(setup, setup.id);

      for (const which of ["photo", "thumbnail"]) {
        const trashed = await get(setup.app, `/recipes/${setup.id}/${which}`, as);
        const unknown = await get(setup.app, `/recipes/${UNKNOWN_ID}/${which}`, as);
        expectErrors(trashed, 404, ["recipe.notFound"]);
        expect(trashed.body).toBe(unknown.body);
        expect(trashed.headers["cache-control"]).toBe("private, no-store");
        expect(trashed.headers.etag).toBeUndefined();
      }
    });

    it(`answers ${who} 404 for a trashed recipe's photo even when the browser has it cached`, async () => {
      const setup = await appWithPhoto();
      const etags = {
        photo: (await get(setup.app, `/recipes/${setup.id}/photo`, as)).headers.etag as string,
        thumbnail: (await get(setup.app, `/recipes/${setup.id}/thumbnail`, as)).headers.etag as string,
      };
      await moveToTrash(setup, setup.id);

      for (const which of ["photo", "thumbnail"] as const) {
        const trashed = await get(setup.app, `/recipes/${setup.id}/${which}`, { ...as, "if-none-match": etags[which] });
        const unknown = await get(setup.app, `/recipes/${UNKNOWN_ID}/${which}`, { ...as, "if-none-match": etags[which] });
        expectErrors(trashed, 404, ["recipe.notFound"]);
        expect(trashed.body).toBe(unknown.body);
        expect(trashed.headers.etag).toBeUndefined();
      }
    });
  }

  it("serves an editor the photo and thumbnail of a trashed recipe, so the trash can show them", async () => {
    const setup = await appWithPhoto();
    const before = {
      photo: await get(setup.app, `/recipes/${setup.id}/photo`, AS_EDITOR),
      thumbnail: await get(setup.app, `/recipes/${setup.id}/thumbnail`, AS_EDITOR),
    };
    await moveToTrash(setup, setup.id);

    for (const which of ["photo", "thumbnail"] as const) {
      const res = await get(setup.app, `/recipes/${setup.id}/${which}`, AS_EDITOR);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("image/jpeg");
      expect(res.headers["cache-control"]).toBe("private, no-cache");
      expect(res.headers.etag).toBe(before[which].headers.etag);
      expect(res.rawPayload.equals(before[which].rawPayload)).toBe(true);
      const cached = await get(setup.app, `/recipes/${setup.id}/${which}`, {
        ...AS_EDITOR,
        "if-none-match": before[which].headers.etag as string,
      });
      expect(cached.statusCode).toBe(304);
    }
  });

  it("serves the photo to visitors again once the recipe is restored (REC-15)", async () => {
    const setup = await appWithPhoto();
    await moveToTrash(setup, setup.id);
    await change(setup.app, "POST", `/trash/${setup.id}/restore`);
    expect((await get(setup.app, `/recipes/${setup.id}/thumbnail`)).statusCode).toBe(200);
  });
});

describe("REC-7 serving photos", () => {
  it("serves both images to anyone, with their type, an ETag and headers that make browsers check before reuse", async () => {
    const setup = await appWithPhoto();
    for (const as of [AS_VISITOR, AS_NON_EDITOR, AS_EDITOR]) {
      const photo = await get(setup.app, `/recipes/${setup.id}/photo`, as);
      const thumbnail = await get(setup.app, `/recipes/${setup.id}/thumbnail`, as);
      for (const res of [photo, thumbnail]) {
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toBe("image/jpeg");
        expect(res.headers["cache-control"]).toBe("private, no-cache");
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.headers.etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
      }
      expect(photo.headers.etag).not.toBe(thumbnail.headers.etag);
      expect(photo.rawPayload.equals((await setup.photos.get(setup.images.find((n) => !n.includes(".thumbnail"))!))!.bytes)).toBe(
        true,
      );
    }
  });

  it.each([
    ["the same ETag", (etag: string) => etag],
    ["a weak form of it", (etag: string) => `W/${etag}`],
    ["a list containing it", (etag: string) => `"other", ${etag}`],
    ["*", () => "*"],
  ])("answers 304 with no body to If-None-Match with %s", async (_name, header) => {
    const setup = await appWithPhoto();
    const first = await get(setup.app, `/recipes/${setup.id}/thumbnail`);

    const res = await get(setup.app, `/recipes/${setup.id}/thumbnail`, { "if-none-match": header(first.headers.etag as string) });

    expect(res.statusCode).toBe(304);
    expect(res.rawPayload.length).toBe(0);
    expect(res.headers.etag).toBe(first.headers.etag);
    expect(res.headers["cache-control"]).toBe("private, no-cache");
  });

  it("serves the new image, not 304, once the photo is replaced", async () => {
    const setup = await appWithPhoto();
    const old = await get(setup.app, `/recipes/${setup.id}/photo`);
    await uploadPhoto(setup.app, setup.id, await png());

    const res = await get(setup.app, `/recipes/${setup.id}/photo`, { "if-none-match": old.headers.etag as string });

    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).not.toBe(old.headers.etag);
    expect(res.rawPayload.equals(old.rawPayload)).toBe(false);
  });

  it("answers 404 photo.notFound for a recipe without a photo, and recipe.notFound for an unknown one", async () => {
    const setup = await appWithRecipe();
    for (const which of ["photo", "thumbnail"]) {
      expectErrors(await get(setup.app, `/recipes/${setup.id}/${which}`), 404, ["photo.notFound"]);
      expectErrors(await get(setup.app, `/recipes/${UNKNOWN_ID}/${which}`), 404, ["recipe.notFound"]);
      expectErrors(await get(setup.app, `/recipes/not-a-uuid/${which}`), 404, ["recipe.notFound"]);
    }
  });
});
