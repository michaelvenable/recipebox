// The photo endpoints (docs/api.md, REC-7): upload or replace, remove, and the display image and thumbnail.
//
// Changes follow docs/architecture.md, "How a change is applied" (requireEditor first, X-6), with the images stored in the
// PhotoStore and only their name in the recipe (a PhotoRef). The order of storage steps keeps a recipe from ever referring to a
// missing image (REC-7):
// - upload: store the new images under fresh names, then save the recipe, and only then delete the previous images. If the
//   recipe can't be saved, the new images are deleted and the recipe keeps its previous photo.
// - remove: save the recipe without the photo, then delete the images.
import { createHash } from "node:crypto";
import multipart from "@fastify/multipart";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PhotoRef, type Recipe } from "@recipebox/domain";
import type { EditorRecipe, ErrorItem, ErrorResponse } from "@recipebox/shared";
import { requireEditor } from "../http/caller.js";
import type { RecipeRepository } from "../recipes/recipe-repository.js";
import { toEditorRecipe } from "../recipes/recipe-responses.js";
import {
  recipeIdOf,
  refuseUnlessEmpty,
  sendErrors,
  sendInTrash,
  sendNotFound,
  statusFor,
} from "../recipes/recipe-routes.js";
import { imageNamesOf, newPhotoName, thumbnailNameOf } from "./photo-names.js";
import { MAX_PHOTO_BYTES, type PhotoProcessingOptions, processPhoto } from "./photo-processing.js";
import type { PhotoStore } from "./photo-store.js";

export interface PhotoRouteDependencies {
  recipes: RecipeRepository;
  photos: PhotoStore;
  /** How uploads are decoded; tests use it to simulate a decoder that hangs or crashes, or a full decode queue. */
  photoProcessing?: Omit<PhotoProcessingOptions, "log">;
}

interface IdParams {
  id: string;
}

export type Upload = { ok: true; bytes: Buffer } | { ok: false; error: ErrorItem };

export const TOO_LARGE: ErrorItem = {
  code: "photo.tooLarge",
  field: "photo",
  message: "The photo is larger than 15 MB. Choose a smaller one.",
};
const NOT_ONE_FILE: ErrorItem = {
  code: "photo.required",
  field: "photo",
  message: "Send exactly one image file as multipart/form-data, with no other fields.",
};
export const UNSUPPORTED: ErrorItem = {
  code: "photo.unsupportedType",
  field: "photo",
  message: "This file isn't a JPEG, PNG or WebP image.",
};
export const UNREADABLE: ErrorItem = {
  code: "photo.unreadable",
  field: "photo",
  message: "This image can't be read. It may be damaged or incomplete.",
};

export const BUSY: ErrorItem = {
  code: "photo.busy",
  message: "Too many photos are being processed. Try again in a moment.",
};

export function sendError(reply: FastifyReply, status: number, error: ErrorItem): FastifyReply {
  return reply.code(status).send({ errors: [error] } satisfies ErrorResponse);
}

function sendPhotoNotFound(reply: FastifyReply): FastifyReply {
  return sendError(reply, 404, { code: "photo.notFound", message: "This recipe has no photo." });
}

/**
 * Reads the one uploaded file. The 15 MB limit (REC-7) is enforced while reading: once a file passes it, reading stops and the
 * request is refused, so an oversized upload is never held in memory whole.
 */
export async function readUpload(request: FastifyRequest): Promise<Upload> {
  let bytes: Buffer | undefined;
  try {
    const parts = request.parts({ limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0, parts: 1 } });
    for await (const part of parts) {
      if (part.type !== "file") return { ok: false, error: NOT_ONE_FILE };
      bytes = await part.toBuffer();
    }
  } catch (error) {
    // Everything that can go wrong here is about the request: too large, more than one part, or a malformed body.
    const code = (error as { code?: unknown }).code;
    request.log.info({ err: error }, "photo upload refused while reading");
    return { ok: false, error: code === "FST_REQ_FILE_TOO_LARGE" ? TOO_LARGE : NOT_ONE_FILE };
  }
  return bytes === undefined ? { ok: false, error: NOT_ONE_FILE } : { ok: true, bytes };
}

/**
 * Why a multi-file upload can't be read: no file part, or a part that isn't a file (`required`); more files than allowed
 * (`tooMany`); or file `index` (from 0) over 15 MB (`tooLarge`).
 */
export type UploadsProblem = { kind: "required" } | { kind: "tooMany" } | { kind: "tooLarge"; index: number };

export type Uploads = { ok: true; files: Buffer[] } | { ok: false; problem: UploadsProblem };

/**
 * Reads 1 to `maxFiles` uploaded files, in the order sent, under any field names (POST /imports, docs/api.md). Every file is
 * read before any is decoded, so too many files are refused before any is processed, even when an earlier one is too large:
 * the number is checked first (IMP-2). The 15 MB limit (REC-7) is enforced on each while reading: a file over it stops being
 * buffered at the limit and is dropped, so the body holds at most `maxFiles` files of 15 MB plus the form's overhead.
 */
export async function readUploads(request: FastifyRequest, maxFiles: number): Promise<Uploads> {
  const files: Buffer[] = [];
  // One more part than files allowed, so a file past the limit is seen as too many rather than as too many parts.
  const limits = { fileSize: MAX_PHOTO_BYTES, files: maxFiles, fields: 0, parts: maxFiles + 1 };
  let firstTooLarge: number | undefined;
  try {
    // Not thrown, so the remaining parts are still read and a file past maxFiles still counts as too many. @fastify/multipart
    // honours throwFileSizeLimit in parts() too, though its types list it only for file() and files().
    const options = { limits, throwFileSizeLimit: false };
    for await (const part of request.parts(options)) {
      if (part.type !== "file") return { ok: false, problem: { kind: "required" } };
      const bytes = await part.toBuffer();
      if (part.file.truncated) {
        firstTooLarge ??= files.length;
        files.push(Buffer.alloc(0));
      } else {
        files.push(bytes);
      }
    }
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    request.log.info({ err: error }, "photo upload refused while reading");
    if (code === "FST_FILES_LIMIT") return { ok: false, problem: { kind: "tooMany" } };
    return { ok: false, problem: { kind: "required" } };
  }
  if (firstTooLarge !== undefined) {
    request.log.info({ index: firstTooLarge }, "photo upload refused: a file is too large");
    return { ok: false, problem: { kind: "tooLarge", index: firstTooLarge } };
  }
  return files.length === 0 ? { ok: false, problem: { kind: "required" } } : { ok: true, files };
}

/**
 * Deletes images without failing the request: used after the recipe is saved (the change has happened; an image left behind
 * only costs storage) and when cleaning up after a failure (the original error is what the caller should see).
 */
export async function deleteImages(
  photos: PhotoStore,
  names: readonly string[],
  log: FastifyBaseLogger,
): Promise<void> {
  await Promise.all(
    names.map(async (name) => {
      try {
        await photos.delete(name);
      } catch (error) {
        log.error({ err: error, blob: name }, "could not delete a photo image; it is left in storage");
      }
    }),
  );
}

/** A strong validator for one stored image. Names are never reused (newPhotoName), so the name identifies the bytes. */
function etagOf(name: string): string {
  return `"${createHash("sha256").update(name).digest("base64url")}"`;
}

/** If-None-Match: a list of entity tags, or `*`. Weak tags match too (RFC 9110, weak comparison for If-None-Match). */
function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header.split(",").some((tag) => {
    const value = tag.trim();
    return value === "*" || value.replace(/^W\//, "") === etag;
  });
}

export async function registerPhotoRoutes(
  app: FastifyInstance,
  { recipes, photos, photoProcessing = {} }: PhotoRouteDependencies,
): Promise<void> {
  // Parses multipart/form-data for the routes in this scope only. Whether a request may send it at all is decided earlier, by
  // registerJsonOnlyChanges: only on routes that opt in with acceptsMultipartUpload (docs/architecture.md, "Sign-in").
  await app.register(multipart);

  async function load(rawId: string): Promise<Recipe | undefined> {
    const id = recipeIdOf(rawId);
    return id === undefined ? undefined : recipes.get(id);
  }

  // Changes answer with the editor shape (X-1), so no cache may keep them. The image routes set their own policy.
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "private, no-store");
  });

  /**
   * GET photo and thumbnail (REC-7, X-1): 404 when the recipe doesn't exist or has no photo. A recipe in the trash answers
   * visitors and non-editors exactly as an unknown id, before If-None-Match is looked at; editors get its images, so the trash
   * can show thumbnails (REC-14, docs/api.md). Browsers may keep a copy but must check it on every use (no-cache), so a replaced photo
   * or one of a recipe moved to the trash is never shown from cache; `private` keeps shared caches from storing it at all.
   */
  async function serveImage(
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply,
    nameOf: (photo: PhotoRef) => string,
  ): Promise<FastifyReply> {
    const recipe = await load(request.params.id);
    const isEditor = request.caller.signedIn && request.caller.isEditor;
    if (recipe === undefined || (recipe.isDeleted && !isEditor)) return sendNotFound(reply);
    const photo = recipe.photo;
    if (photo === undefined) return sendPhotoNotFound(reply);
    const name = nameOf(photo);
    const etag = etagOf(name);
    if (matchesIfNoneMatch(request.headers["if-none-match"], etag)) {
      return reply.code(304).header("cache-control", "private, no-cache").header("etag", etag).send();
    }
    const image = await photos.get(name);
    if (image === undefined) {
      request.log.error({ blob: name, recipeId: recipe.id.value }, "a recipe's photo is missing from storage");
      return sendPhotoNotFound(reply);
    }
    return reply
      .header("cache-control", "private, no-cache")
      .header("etag", etag)
      .header("x-content-type-options", "nosniff")
      .type(image.contentType)
      .send(image.bytes);
  }

  app.get<{ Params: IdParams }>("/recipes/:id/photo", (request, reply) =>
    serveImage(request, reply, (photo) => photo.blobName),
  );

  app.get<{ Params: IdParams }>("/recipes/:id/thumbnail", (request, reply) =>
    serveImage(request, reply, (photo) => thumbnailNameOf(photo.blobName)),
  );

  // REC-7: add or replace. The one route that accepts multipart/form-data (docs/api.md). requireEditor runs before the upload is
  // read or the recipe looked up (X-6), so visitors can't tell a trashed id from an unknown one (X-1).
  app.put<{ Params: IdParams }>(
    "/recipes/:id/photo",
    { preHandler: requireEditor, config: { acceptsMultipartUpload: true } },
    async (request, reply): Promise<EditorRecipe | FastifyReply> => {
      if (!request.isMultipart()) {
        return sendError(reply, 415, {
          code: "request.unsupportedMediaType",
          message: "Send the photo as multipart/form-data.",
        });
      }
      // Checked before the upload is read, so the editor is told about a trashed recipe whatever the file (REC-17).
      const current = await load(request.params.id);
      if (current === undefined) return sendNotFound(reply);
      if (current.isDeleted) return sendInTrash(reply);

      const upload = await readUpload(request);
      if (!upload.ok) return sendError(reply, 400, upload.error);
      const processed = await processPhoto(upload.bytes, { ...photoProcessing, log: request.log });
      if (!processed.ok) {
        if (processed.reason === "busy") return sendError(reply, 503, BUSY);
        return sendError(reply, 400, processed.reason === "unsupportedType" ? UNSUPPORTED : UNREADABLE);
      }

      const created = PhotoRef.create({ blobName: newPhotoName(current.id), contentType: processed.value.contentType });
      if (!created.ok) throw new Error(`Invalid photo reference: ${JSON.stringify(created.errors)}`);
      const photo = created.value;
      const [photoName, thumbnailName] = imageNamesOf(photo);

      let recipe: Recipe | undefined;
      let replaced: PhotoRef | undefined;
      try {
        await photos.put(photoName, processed.value.photo, photo.contentType);
        await photos.put(thumbnailName, processed.value.thumbnail, photo.contentType);
        // Read again: the recipe may have changed while the upload was read and converted.
        recipe = await load(request.params.id);
        if (recipe === undefined) {
          await deleteImages(photos, [photoName, thumbnailName], request.log);
          return sendNotFound(reply);
        }
        const set = recipe.setPhoto(photo);
        if (!set.ok) {
          await deleteImages(photos, [photoName, thumbnailName], request.log);
          return sendErrors(reply, statusFor(set.errors), set.errors);
        }
        replaced = set.value.replaced;
        await recipes.save(recipe);
      } catch (error) {
        // Nothing refers to the new images; the recipe keeps its previous photo.
        await deleteImages(photos, [photoName, thumbnailName], request.log);
        throw error;
      }
      if (replaced !== undefined) await deleteImages(photos, imageNamesOf(replaced), request.log);
      return toEditorRecipe(recipe);
    },
  );

  // REC-7: remove. A recipe without a photo is returned unchanged; one in the trash is refused with 409 (REC-17).
  app.delete<{ Params: IdParams }>(
    "/recipes/:id/photo",
    { preHandler: requireEditor },
    async (request, reply): Promise<EditorRecipe | FastifyReply> => {
      const refused = refuseUnlessEmpty(request.body, reply);
      if (refused) return refused;
      const recipe = await load(request.params.id);
      if (recipe === undefined) return sendNotFound(reply);
      const removed = recipe.removePhoto();
      if (!removed.ok) return sendErrors(reply, statusFor(removed.errors), removed.errors);
      await recipes.save(recipe);
      const previous = removed.value.removed;
      if (previous !== undefined) await deleteImages(photos, imageNamesOf(previous), request.log);
      return toEditorRecipe(recipe);
    },
  );
}
