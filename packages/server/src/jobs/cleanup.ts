import { pino } from "pino";
import { systemClock } from "../clock.js";
import { loadConfig } from "../config.js";
import { openStorage } from "../open-storage.js";
import { BlobPhotoStore, createPhotoContainerClient } from "../photos/blob-photo-store.js";
import { CosmosRecipeRepository, createCosmosClient } from "../recipes/cosmos-recipe-repository.js";
import { runCleanup } from "./run-cleanup.js";

/**
 * The daily trash cleanup job (docs/architecture.md, "Trash cleanup"; REC-16). Logs JSON lines to stdout, like the API, and
 * exits with a non-zero code if any step failed, so the job's run is reported as failed.
 *
 * `npm run cleanup` runs it with the environment as it is, as deployed: every setting is required (config.ts) and a missing
 * database or container is an error. `npm run cleanup:dev` sets APP_ENV=development to run it locally against the emulators.
 */
const logger = pino();

try {
  const config = loadConfig();
  const cosmos = createCosmosClient(config.cosmos);
  try {
    // Outside local development a missing database or container is an error, never created (open-storage.ts).
    const { recipeContainer: container, photoContainer } = await openStorage(
      config,
      cosmos,
      createPhotoContainerClient(config.storage),
    );

    const summary = await runCleanup({
      recipes: new CosmosRecipeRepository(container),
      photos: new BlobPhotoStore(photoContainer),
      clock: systemClock,
      logger,
    });
    logger.info({ summary }, "trash cleanup finished");
    if (summary.failures > 0) process.exitCode = 1;
  } finally {
    cosmos.dispose();
  }
} catch (error) {
  logger.error({ err: error }, "trash cleanup could not run");
  process.exitCode = 1;
}
