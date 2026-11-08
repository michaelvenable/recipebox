import { pino } from "pino";
import { systemClock } from "../clock.js";
import { loadConfig } from "../config.js";
import { createRecipeReader } from "../imports/azure-openai-recipe-reader.js";
import { CosmosImportRepository } from "../imports/cosmos-import-repository.js";
import { processImport } from "../imports/process-import.js";
import { createImportQueueClient, StorageImportQueue } from "../imports/storage-import-queue.js";
import { openImportQueue, openStorage } from "../open-storage.js";
import { BlobPhotoStore, createPhotoContainerClient } from "../photos/blob-photo-store.js";
import { CosmosRecipeRepository, createCosmosClient } from "../recipes/cosmos-recipe-repository.js";
import { type ImportJobResult, runImportJob } from "./run-import.js";

/**
 * The import job (docs/architecture.md, "Recipe import"; IMP-6 to IMP-12): one execution per queue message, started by the
 * queue. It takes one message, processes its import and exits; with an empty queue it exits cleanly. Logs JSON lines to stdout,
 * like the API, and exits with a non-zero code only if something unexpected failed; a failed import is an expected outcome,
 * logged as `recipe-import-failed` (IMP-11).
 *
 * `npm run import` runs it with the environment as it is, as deployed: every setting is required (config.ts) and a missing
 * database or container is an error, and the model deployment (MODEL_ENDPOINT, MODEL_DEPLOYMENT) reads the photos.
 * `npm run import:dev` sets APP_ENV=development and processes every queued message, one after another, against the emulators
 * with the development reader.
 */
const logger = pino();

try {
  const config = loadConfig();
  const untilEmpty = process.argv.includes("--until-empty");
  if (untilEmpty && !config.local) throw new Error("--until-empty is for local runs only.");
  const reader = createRecipeReader(config);
  const cosmos = createCosmosClient(config.cosmos);
  try {
    // Outside local development a missing database, container or queue is an error, never created (open-storage.ts).
    const { recipeContainer, importContainer, photoContainer } = await openStorage(
      config,
      cosmos,
      createPhotoContainerClient(config.storage),
    );
    const queue = new StorageImportQueue(await openImportQueue(config, createImportQueueClient(config.storage)));
    const dependencies = {
      imports: new CosmosImportRepository(importContainer),
      recipes: new CosmosRecipeRepository(recipeContainer),
      photos: new BlobPhotoStore(photoContainer),
      reader,
      clock: systemClock,
      logger,
    };

    let result: ImportJobResult;
    do {
      result = await runImportJob({ queue, process: (importId) => processImport(importId, dependencies), logger });
      if (result === "error") process.exitCode = 1;
    } while (untilEmpty && result !== "empty");
  } finally {
    cosmos.dispose();
  }
} catch (error) {
  logger.error({ err: error }, "import job could not run");
  process.exitCode = 1;
}
