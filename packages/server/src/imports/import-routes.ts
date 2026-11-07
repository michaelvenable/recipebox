// Importing a recipe from a photo, the API side (docs/api.md, "Import from a photo"; docs/architecture.md, "Recipe import"):
// starting an import and listing the last day's imports. Both are editor-only (X-6), and nothing about an import ever reaches
// a visitor (IMP-5, X-1). Any number of imports can be in progress at once (IMP-3), so starting one never looks at the others.
//
// Starting stores three things, in this order: the page photo, the import's record and the queue message. If the import can't
// start, nothing is left in progress (IMP-4):
// - the photo can't be stored: nothing else is written;
// - the record can't be stored: the photo is deleted;
// - the message can't be queued: no job would ever read the photo, so the record is ended as failed and the photo deleted.
// Each answers with an error (500), so the editor stays on the form. A queueing failure is logged as an ordinary server error
// with the import ID, not as `recipe-import-failed`, since nothing was read (IMP-11).
import multipart from "@fastify/multipart";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import { type Instant, RecipeImport } from "@recipebox/domain";
import type { ImportStatus } from "@recipebox/shared";
import type { Clock, ImportIdGenerator } from "../clock.js";
import { requireEditor } from "../http/caller.js";
import { type PhotoProcessingOptions, processImportPage } from "../photos/photo-processing.js";
import { BUSY, deleteImages, readUpload, sendError, UNREADABLE, UNSUPPORTED } from "../photos/photo-routes.js";
import type { PhotoStore } from "../photos/photo-store.js";
import { importPageName } from "./import-page-name.js";
import type { ImportQueue } from "./import-queue.js";
import type { ImportRepository } from "./import-repository.js";

export interface ImportRouteDependencies {
  imports: ImportRepository;
  importQueue: ImportQueue;
  /** Where the page photo is stored, in the photo container next to recipe photos (docs/architecture.md, "Recipe import"). */
  photos: PhotoStore;
  /** The server's clock: the start time, and whether an import is still reading (X-12, IMP-11). */
  clock: Clock;
  newImportId: ImportIdGenerator;
  /** How uploads are decoded; the same decode worker and queue as recipe photos. */
  photoProcessing?: Omit<PhotoProcessingOptions, "log">;
}

/**
 * The response shape (docs/api.md, "Shapes"): the status by the server's clock, so an import still reading after its 10
 * minutes is failed (IMP-11). No start time, failure reason or photo.
 */
export function toImportStatus(recipeImport: RecipeImport, now: Instant): ImportStatus {
  const status = recipeImport.statusAt(now);
  const importId = recipeImport.id.value;
  if (status !== "done") return { importId, status };
  const { recipeId, recipeName } = recipeImport;
  if (recipeId === undefined || recipeName === undefined) throw new Error("A done import has no recipe");
  return { importId, status, recipeId: recipeId.value, recipeName: recipeName.value };
}

/** IMP-5: newest first, by when each started; the id breaks ties, so the order never changes between reads. */
function newestFirst(a: RecipeImport, b: RecipeImport): number {
  const byStart = b.startedAt.epochMillis - a.startedAt.epochMillis;
  if (byStart !== 0) return byStart;
  return a.id.value < b.id.value ? -1 : a.id.value > b.id.value ? 1 : 0;
}

export async function registerImportRoutes(
  app: FastifyInstance,
  { imports, importQueue, photos, clock, newImportId, photoProcessing = {} }: ImportRouteDependencies,
): Promise<void> {
  // Parses multipart/form-data for the routes in this scope only (see photo-routes.ts).
  await app.register(multipart);

  // Editor-only answers about the collection's imports; no cache may keep them (X-1).
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "private, no-store");
  });

  /** Ends an import whose message couldn't be queued, so it isn't left in progress with nothing to process it. */
  async function endUnqueued(recipeImport: RecipeImport, log: FastifyBaseLogger): Promise<void> {
    recipeImport.fail();
    try {
      await imports.save(recipeImport);
    } catch (error) {
      // It then reads as failed once its 10 minutes are up (IMP-11).
      log.error({ err: error, importId: recipeImport.id.value }, "could not end an unqueued import");
    }
  }

  // IMP-1 to IMP-4: start an import of one photo. An upload (docs/api.md, "Conventions"): multipart/form-data with
  // X-Requested-By, checked by registerJsonOnlyChanges before anything else. requireEditor runs before anything is read or
  // stored (X-6).
  app.post(
    "/imports",
    { preHandler: requireEditor, config: { acceptsMultipartUpload: true } },
    async (request, reply): Promise<FastifyReply> => {
      if (!request.isMultipart()) {
        return sendError(reply, 415, {
          code: "request.unsupportedMediaType",
          message: "Send the photo as multipart/form-data.",
        });
      }

      // IMP-2: the same checks as a recipe photo (REC-7); then all metadata is removed and the image scaled down for reading.
      const upload = await readUpload(request);
      if (!upload.ok) return sendError(reply, 400, upload.error);
      const processed = await processImportPage(upload.bytes, { ...photoProcessing, log: request.log });
      if (!processed.ok) {
        if (processed.reason === "busy") return sendError(reply, 503, BUSY);
        return sendError(reply, 400, processed.reason === "unsupportedType" ? UNSUPPORTED : UNREADABLE);
      }

      const importId = newImportId();
      const pageName = importPageName(importId);
      await photos.put(pageName, processed.value.image, processed.value.contentType);

      // The start time is the server's (X-12).
      const recipeImport = RecipeImport.start(importId, clock());
      try {
        await imports.add(recipeImport);
      } catch (error) {
        await deleteImages(photos, [pageName], request.log);
        throw error;
      }

      try {
        await importQueue.send(importId);
      } catch (error) {
        request.log.error({ err: error, importId: importId.value }, "could not queue an import; it is ended");
        await endUnqueued(recipeImport, request.log);
        await deleteImages(photos, [pageName], request.log);
        throw error;
      }
      return reply.code(202).send(toImportStatus(recipeImport, recipeImport.startedAt));
    },
  );

  // IMP-5, IMP-10, IMP-11: the last day's imports, newest first; editor-only (X-1).
  app.get("/imports", { preHandler: requireEditor }, async (): Promise<ImportStatus[]> => {
    const now = clock();
    const all = await imports.list();
    return all.sort(newestFirst).map((recipeImport) => toImportStatus(recipeImport, now));
  });
}
