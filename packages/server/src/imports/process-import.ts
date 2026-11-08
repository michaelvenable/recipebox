// The import job's work for one import (docs/architecture.md, "Recipe import"): read the page photos (1 to 4 of one recipe,
// IMP-3) with the reading service in one request,
// turn the answer into a recipe through the domain, add it with the dish picture as its photo, and end the import. Any number
// of imports run at once, each in its own job execution (IMP-3); nothing here looks at other imports.
//
// Order, so that nothing is added unless the import ends as done (IMP-7, IMP-11):
// 1. The record is loaded; one no longer in progress by the server's clock is ended as `timed-out` without reading (or, if
//    a run that stopped partway already added its recipe, ended as failed and logged as an ordinary error).
// 2. The reading service is called with a deadline (READING_MARGIN_MS before the 10 minutes; stopped there, it is
//    `timed-out`), and its answer parsed.
// 3. The recipe is built by the domain (importedRecipe); the dish picture is cut from the photo it is on and stored under
//    fresh names.
// 4. `succeed` is called on the import with the server's time, before the recipe is written. If it refuses (the 10 minutes
//    passed while reading), nothing has been added: the stored images are deleted and the import ends as `timed-out`.
// 5. The recipe is written with create; its id comes from the import id, so a second delivery of the same message finds it
//    there and treats the import as done, deleting the images it stored itself.
// 6. The record is saved as done, tried again a few times if the write fails.
// The app's own storage failing before the recipe is added ends the import as `internal-error` (IMP-11).
// The page photos are deleted at the end whatever happened (IMP-12).
import sharp from "sharp";
import {
  IMPORT_MINUTES,
  type ImportId,
  importedRecipe,
  PhotoRef,
  type Recipe,
  RecipeImport,
  type Tag,
  tagsInUse,
} from "@recipebox/domain";
import type { Clock } from "../clock.js";
import { imageNamesOf, newPhotoName } from "../photos/photo-names.js";
import { type PhotoProcessingOptions, processDishPhoto } from "../photos/photo-processing.js";
import type { PhotoStore } from "../photos/photo-store.js";
import type { RecipeRepository } from "../recipes/recipe-repository.js";
import { dishPhotoArea, dishPhotoPage } from "./dish-photo.js";
import { importPagesInOrder, importPagesPrefix } from "./import-page-name.js";
import type { ImportRepository } from "./import-repository.js";
import { importedRecipeId } from "./imported-recipe-id.js";
import { type DishPhotoBox, parseReadingAnswer } from "./reading-answer.js";
import type { RecipeReader } from "./recipe-reader.js";

/**
 * The reading service is stopped this long before the import's 10 minutes are up (IMP-11), leaving time to cut the dish
 * picture, add the recipe and end the import.
 */
export const READING_MARGIN_MS = 60_000;

/** IMP-11: why an import failed, as logged. */
export type ImportFailureReason = "no-recipe-found" | "invalid-recipe" | "service-error" | "timed-out" | "internal-error";

/**
 * What became of one import: `done` (IMP-10), a failure reason (IMP-11), `already-ended` (a message delivered again for an
 * import that had ended), `missing` (no record, e.g. removed after a day) or `error`: the recipe was added but the import
 * couldn't be ended as done, so it ends or reads as failed; logged as an ordinary error.
 */
export type ImportOutcome = "done" | ImportFailureReason | "already-ended" | "missing" | "error";

/** Where the job logs. A pino logger fits. Lines never hold the photo, recipe text or who started the import (IMP-11). */
export interface ImportLogger {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
  error(details: object, message: string): void;
}

export interface ImportProcessingDependencies {
  imports: ImportRepository;
  recipes: RecipeRepository;
  /** The page photos (`imports/{importId}/{n}.jpg`) and recipe photos. */
  photos: PhotoStore;
  reader: RecipeReader;
  /** The server's clock (X-12): whether the import is still in progress, and the time it ends. */
  clock: Clock;
  logger: ImportLogger;
  /** How the dish picture is decoded; the same decode worker as uploaded photos. */
  photoProcessing?: Omit<PhotoProcessingOptions, "log">;
}

/** Processes one import, as one queue message asks. Every failure is logged here; nothing is thrown. */
export async function processImport(importId: ImportId, deps: ImportProcessingDependencies): Promise<ImportOutcome> {
  const { imports, photos, logger } = deps;
  let recipeImport: RecipeImport | undefined;
  try {
    recipeImport = await imports.get(importId);
  } catch {
    // IMP-11: the app's own storage failed. A record that can't be loaded can't be ended; it reads as failed after its 10
    // minutes, and the page photos are left for the one-day lifecycle rule (owner decision).
    logFailure(logger, importId.value, "internal-error", undefined);
    return "internal-error";
  }
  if (recipeImport === undefined) {
    logger.warn({ importId: importId.value }, "no record for this import; nothing to do");
    return "missing";
  }
  try {
    return await processLoaded(recipeImport, deps);
  } finally {
    // IMP-12: every page photo is deleted when the import ends, whether it succeeds or fails. Listed again here, so photos are
    // deleted even when reading them failed partway.
    try {
      const stored = await photos.list(importPagesPrefix(importId));
      for (const { name } of stored) await photos.delete(name);
    } catch (error) {
      // A lifecycle rule deletes them within a day (docs/architecture.md, "Recipe import").
      logger.error(
        { err: error, importId: importId.value },
        "could not delete an import's page photos; left for the lifecycle rule",
      );
    }
  }
}

/**
 * The import's page photos, in the order they were added (`imports/{importId}/{n}.jpg`, by n). Throws if there are none or one
 * listed can't be read: the app's own storage failed (IMP-11, `internal-error`).
 */
async function readPages(importId: ImportId, photos: PhotoStore): Promise<Buffer[]> {
  const names = importPagesInOrder(
    importId,
    (await photos.list(importPagesPrefix(importId))).map((image) => image.name),
  );
  if (names.length === 0) throw new Error("The import's page photos are missing");
  const pages: Buffer[] = [];
  for (const name of names) {
    const page = await photos.get(name);
    if (page === undefined) throw new Error("One of the import's page photos is missing");
    pages.push(page.bytes);
  }
  return pages;
}

async function processLoaded(recipeImport: RecipeImport, deps: ImportProcessingDependencies): Promise<ImportOutcome> {
  const { imports, photos, recipes, clock, logger } = deps;
  const importId = recipeImport.id.value;
  const loaded = recipeImport.toSnapshot();

  const now = clock();
  if (!recipeImport.isInProgress(now)) {
    if (loaded.status === "reading") return endExpired(recipeImport, deps);
    // Already ended by an earlier delivery of the message.
    logger.info({ importId }, "import already ended; nothing to do");
    return "already-ended";
  }

  let storedImages: string[] = [];
  let recipeAdded = false;
  try {
    const pages = await readPages(recipeImport.id, photos);
    const tags = tagsInUse(await recipes.list()).map((entry) => entry.tag);

    const deadline = recipeImport.startedAt.plusMinutes(IMPORT_MINUTES).epochMillis - READING_MARGIN_MS;
    const answer = await readWithDeadline(deps.reader, pages, tags, deadline - now.epochMillis);
    // IMP-11 (owner decision): a read stopped at the deadline is a timeout, not a failure of the service.
    if (answer.kind === "stopped") return await endAsFailed(recipeImport, "timed-out", undefined, deps);
    if (answer.kind === "failed") return await endAsFailed(recipeImport, "service-error", answer.detail, deps);
    const parsed = parseReadingAnswer(answer.text);
    if (!parsed.ok) return await endAsFailed(recipeImport, "service-error", parsed.detail, deps);
    if (!parsed.value.found) return await endAsFailed(recipeImport, "no-recipe-found", undefined, deps);

    // IMP-7, IMP-8: the same rules as a typed recipe, and only tags in use.
    const built = importedRecipe(importedRecipeId(recipeImport.id), parsed.value.recipe, tags);
    if (!built.ok) return await endAsFailed(recipeImport, "invalid-recipe", undefined, deps);
    const recipe = built.value;
    storedImages = await attachDishPhoto(recipe, pages, parsed.value.dishPhoto, importId, deps);

    // Decided before the recipe is written, so a recipe read too late is never added (IMP-11, X-12).
    const succeeded = recipeImport.succeed(recipe, clock());
    if (!succeeded.ok) {
      if (!succeeded.errors.some((e) => e.code === "import.timedOut")) {
        throw new Error(`An import in progress refused to succeed: ${succeeded.errors.map((e) => e.code).join(", ")}`);
      }
      await deleteImages(storedImages, importId, deps);
      storedImages = [];
      // A refused `succeed` changes nothing, so the import is still reading.
      return await endAsFailed(recipeImport, "timed-out", undefined, deps);
    }

    recipeAdded = await recipes.add(recipe);
    if (!recipeAdded) {
      // An earlier delivery of the same message added it; its own photo stays and these images are not needed.
      logger.info({ importId }, "recipe already added for this import");
      await deleteImages(storedImages, importId, deps);
      storedImages = [];
      recipeAdded = true;
    }
    // IMP-10: the recipe is in the collection, so the record must say done, or the editor never hears of it. `succeed` has
    // already run on this object; only the write is tried again.
    await saveWithRetry(imports, recipeImport);
    logger.info({ importId }, "recipe imported");
    return "done";
  } catch (error) {
    if (recipeAdded) {
      // The recipe is in the collection; the record could only not be saved, so it reads as failed after its 10 minutes.
      logger.error({ err: error, importId }, "recipe added, but the import could not be ended as done");
      return "error";
    }
    await deleteImages(storedImages, importId, deps);
    // IMP-11: the app's own storage failed partway (Cosmos DB, Blob Storage, a missing page photo, a recipe write). The line
    // carries no detail: an error from a store is not the reading service's message, and only that one is logged.
    return endAsFailed(RecipeImport.fromSnapshot(loaded), "internal-error", undefined, deps);
  }
}

/** How many times the record is written as done before giving up (IMP-10), and the pause before each new try. */
export const DONE_SAVE_ATTEMPTS = 3;
const DONE_SAVE_RETRY_MS = 200;

async function saveWithRetry(imports: ImportRepository, recipeImport: RecipeImport): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await imports.save(recipeImport);
      return;
    } catch (error) {
      if (attempt >= DONE_SAVE_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, DONE_SAVE_RETRY_MS * attempt));
    }
  }
}

/**
 * A record still stored as reading after its 10 minutes (IMP-11): usually a message seen again after a run stopped partway.
 * If that run had already added the recipe, the import is not a timeout: the recipe is in the collection, but the domain
 * refuses `succeed` after the deadline, so the record is ended as failed and this is logged as an ordinary error rather than
 * `recipe-import-failed` (owner decision).
 */
async function endExpired(recipeImport: RecipeImport, deps: ImportProcessingDependencies): Promise<ImportOutcome> {
  const { recipes, logger } = deps;
  const importId = recipeImport.id.value;
  let added: boolean;
  try {
    added = (await recipes.get(importedRecipeId(recipeImport.id))) !== undefined;
  } catch {
    return endAsFailed(recipeImport, "internal-error", undefined, deps);
  }
  if (!added) return endAsFailed(recipeImport, "timed-out", undefined, deps);
  logger.error({ importId }, "recipe added, import not ended");
  recipeImport.fail();
  await saveFailed(recipeImport, deps);
  return "error";
}

type ReadResult = { kind: "answered"; text: string } | { kind: "failed"; detail: string } | { kind: "stopped" };

/**
 * Calls the reading service, stopping it at `timeoutMs`. The answer is awaited only until then, even if the reader ignores
 * the signal: `stopped`, which is a timeout (IMP-11). A reader that throws has `failed`, with its own message.
 */
async function readWithDeadline(
  reader: RecipeReader,
  images: readonly Buffer[],
  tags: readonly Tag[],
  timeoutMs: number,
): Promise<ReadResult> {
  if (timeoutMs <= 0) return { kind: "stopped" };
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const stopped = new Promise<ReadResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error("The import's time to read the photos ran out."));
      resolve({ kind: "stopped" });
    }, timeoutMs);
  });
  const reading = Promise.resolve()
    .then(() =>
      reader.read(
        images,
        tags.map((t) => t.value),
        controller.signal,
      ),
    )
    .then(
      (text): ReadResult => ({ kind: "answered", text }),
      (error: unknown): ReadResult => ({ kind: "failed", detail: error instanceof Error ? error.message : String(error) }),
    );
  try {
    return await Promise.race([reading, stopped]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * IMP-9: cuts the dish picture from the page photo the box names and stores it as an uploaded recipe photo is stored
 * (photo-routes.ts): a display image and a thumbnail under fresh names, oriented and without metadata, then attached with the
 * domain's `setPhoto`.
 * Returns the names stored, for cleaning up if the recipe isn't added. No box, a box on a photo that doesn't exist, a box too
 * small, or a picture that can't be cut leaves the recipe without a photo.
 */
async function attachDishPhoto(
  recipe: Recipe,
  pages: readonly Buffer[],
  box: DishPhotoBox | undefined,
  importId: string,
  { photos, logger, photoProcessing = {} }: ImportProcessingDependencies,
): Promise<string[]> {
  const page = dishPhotoPage(box, pages);
  if (box === undefined || page === undefined) return [];
  // The page photo is the API's own output (an oriented JPEG without metadata), so reading its size here is safe; it is
  // decoded only in the worker.
  // The size as displayed, which is what the box describes and what the worker cuts from.
  const { autoOrient } = await sharp(page).metadata();
  const area = dishPhotoArea(box, autoOrient);
  if (area === undefined) return [];
  const processed = await processDishPhoto(page, area, { ...photoProcessing, log: logger });
  if (!processed.ok) {
    logger.warn({ importId, reason: processed.reason }, "could not cut the dish picture; the recipe has no photo");
    return [];
  }
  const created = PhotoRef.create({ blobName: newPhotoName(recipe.id), contentType: processed.value.contentType });
  if (!created.ok) throw new Error(`Invalid photo reference: ${JSON.stringify(created.errors)}`);
  const photo = created.value;
  const names = imageNamesOf(photo);
  try {
    await photos.put(names[0], processed.value.photo, photo.contentType);
    await photos.put(names[1], processed.value.thumbnail, photo.contentType);
  } catch (error) {
    await deleteImages(names, importId, { photos, logger });
    throw error;
  }
  const set = recipe.setPhoto(photo);
  if (!set.ok) throw new Error(`A new recipe refused its photo: ${set.errors.map((e) => e.code).join(", ")}`);
  return names;
}

/** Deletes images no recipe will refer to. A failure is logged; the trash cleanup's orphan sweep deletes them later. */
async function deleteImages(
  names: readonly string[],
  importId: string,
  { photos, logger }: Pick<ImportProcessingDependencies, "photos" | "logger">,
): Promise<void> {
  for (const name of names) {
    try {
      await photos.delete(name);
    } catch (error) {
      logger.error({ err: error, importId, blob: name }, "could not delete an unused recipe image; left for the orphan sweep");
    }
  }
}

/**
 * Ends the import as failed (IMP-11) and logs the one line that says why: the import id, the reason and, for `service-error`
 * only, the service's message. Nothing is added.
 */
async function endAsFailed(
  recipeImport: RecipeImport,
  reason: ImportFailureReason,
  detail: string | undefined,
  deps: ImportProcessingDependencies,
): Promise<ImportFailureReason> {
  const { logger } = deps;
  logFailure(logger, recipeImport.id.value, reason, detail);
  recipeImport.fail();
  await saveFailed(recipeImport, deps);
  return reason;
}

/** The one line that says why an import failed (IMP-11): its id, the reason and, for `service-error` only, the detail. */
function logFailure(
  logger: ImportLogger,
  importId: string,
  reason: ImportFailureReason,
  detail: string | undefined,
): void {
  logger.error(
    {
      event: "recipe-import-failed",
      importId,
      reason,
      ...(reason === "service-error" && detail !== undefined ? { detail } : {}),
    },
    "recipe import failed",
  );
}

/** Saves an import ended as failed. If that fails too, it still reads as failed once its 10 minutes are up (IMP-11). */
async function saveFailed(recipeImport: RecipeImport, { imports, logger }: ImportProcessingDependencies): Promise<void> {
  try {
    await imports.save(recipeImport);
  } catch (error) {
    logger.error(
      { err: error, importId: recipeImport.id.value },
      "could not end an import as failed; it reads as failed after its 10 minutes",
    );
  }
}
