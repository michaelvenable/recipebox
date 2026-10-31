import type { Instant, Recipe, RecipeId } from "@recipebox/domain";
import type { Clock } from "../clock.js";
import { imageNamesOf, isRecipeImageName } from "../photos/photo-names.js";
import type { PhotoStore, StoredImageInfo } from "../photos/photo-store.js";
import type { RecipeRepository } from "../recipes/recipe-repository.js";

/** Where the cleanup reports what it did. A pino logger fits, as does Fastify's. */
export interface CleanupLogger {
  info(details: object, message: string): void;
  error(details: object, message: string): void;
}

export interface CleanupDependencies {
  recipes: RecipeRepository;
  photos: PhotoStore;
  clock: Clock;
  logger: CleanupLogger;
}

export interface CleanupSummary {
  /** Recipes permanently removed (REC-16). */
  recipesRemoved: number;
  /** Images of removed recipes deleted. */
  imagesDeleted: number;
  /** Images no recipe refers to that were deleted. */
  orphansDeleted: number;
  /** Steps that failed and were logged; each is retried on the next run. */
  failures: number;
}

/**
 * An image no recipe refers to is deleted only once it is older than this. An upload stores its images before saving the
 * recipe that refers to them, so a young unreferenced image may belong to an upload still in progress.
 */
const ORPHAN_MIN_AGE_DAYS = 1;

/**
 * If the sweep finds more unused images than this, it deletes none and reports a failure (docs/architecture.md, "Trash
 * cleanup"). Overlapping photo changes leave an image behind only now and then; many at once rather suggests misconfiguration,
 * such as the job pointing at the wrong database.
 */
export const MAX_ORPHANS_PER_RUN = 10;

/**
 * The daily trash cleanup (docs/architecture.md, "Trash cleanup"):
 *
 * 1. Permanently removes each recipe whose trash period has ended (REC-16): its document, only if unchanged since the job read
 *    it, then its photo and thumbnail.
 * 2. Deletes images more than a day old, named like recipe images, that no remaining recipe refers to, such as those left
 *    behind when two photo changes to the same recipe overlap (X-5), unless there are suspiciously many.
 *
 * It is safe to run repeatedly and alongside the API: each due recipe is read again just before it is removed, the remove is
 * conditional on that read, and a failure on one item is logged and counted, and the job goes on with the next.
 */
export async function runCleanup({ recipes, photos, clock, logger }: CleanupDependencies): Promise<CleanupSummary> {
  const summary: CleanupSummary = { recipesRemoved: 0, imagesDeleted: 0, orphansDeleted: 0, failures: 0 };
  const now = clock();

  let all: Recipe[];
  try {
    all = await recipes.list();
  } catch (error) {
    summary.failures++;
    logger.error({ err: error }, "could not list recipes; nothing was cleaned up");
    return summary;
  }

  for (const listed of all.filter((recipe) => isDueForRemoval(recipe, now))) {
    await removeRecipe(listed.id, { recipes, photos, logger }, now, summary);
  }

  await deleteOrphans({ recipes, photos, logger }, now, summary);
  return summary;
}

/**
 * REC-16: due once `removalDueAt` has been reached, the same moment from which `Recipe.restore` refuses. The 30 days themselves
 * are the domain's (`Recipe.removalDueAt`).
 */
function isDueForRemoval(recipe: Recipe, now: Instant): boolean {
  const due = recipe.removalDueAt();
  return recipe.isDeleted && due !== undefined && !now.isBefore(due);
}

type Stores = Omit<CleanupDependencies, "clock">;

async function removeRecipe(id: RecipeId, { recipes, photos, logger }: Stores, now: Instant, summary: CleanupSummary) {
  const recipeId = id.value;
  let recipe: Recipe;
  try {
    // Listed as due, but it may have been restored, or its photo changed, since; only the stored recipe counts.
    const read = await recipes.getWithVersion(id);
    if (read === undefined) return;
    recipe = read.recipe;
    if (!isDueForRemoval(recipe, now)) {
      logger.info({ recipeId }, "recipe no longer due for removal; kept");
      return;
    }
    // The document goes first, and only if nobody saved it since the read above, e.g. a restore that landed at the last
    // moment. Its images are deleted only after that succeeded, so losing the race never deletes the images of a recipe that
    // still exists. The cost: if an image delete then fails, the image is left without a recipe, and the orphan sweep
    // deletes it, in this run or a later one.
    if (!(await recipes.removeIfUnchanged(id, read.version))) {
      logger.info({ recipeId }, "recipe changed since it was read; kept");
      return;
    }
  } catch (error) {
    summary.failures++;
    logger.error({ err: error, recipeId }, "could not remove a recipe due for removal; retrying on the next run");
    return;
  }
  summary.recipesRemoved++;
  logger.info({ recipeId }, "recipe permanently removed");

  for (const name of recipe.photo === undefined ? [] : imageNamesOf(recipe.photo)) {
    try {
      await photos.delete(name);
      summary.imagesDeleted++;
    } catch (error) {
      summary.failures++;
      logger.error({ err: error, recipeId, blob: name }, "could not delete a removed recipe's image; left for the orphan sweep");
    }
  }
}

async function deleteOrphans({ recipes, photos, logger }: Stores, now: Instant, summary: CleanupSummary) {
  let referenced: Set<string>;
  let stored: StoredImageInfo[];
  try {
    // Recipes are listed before images, so an image saved on a recipe after this listing is younger than a day and kept.
    referenced = new Set(
      (await recipes.list()).flatMap((recipe) => (recipe.photo === undefined ? [] : imageNamesOf(recipe.photo))),
    );
    stored = await photos.list();
  } catch (error) {
    summary.failures++;
    logger.error({ err: error }, "could not list recipes or images; no unused images were deleted");
    return;
  }

  const orphans = stored.filter(
    (image) =>
      // Only names an upload produces; anything else in the store is not the job's to delete.
      isRecipeImageName(image.name) &&
      !referenced.has(image.name) &&
      // Strictly older than a day.
      image.lastModified.plusDays(ORPHAN_MIN_AGE_DAYS).isBefore(now),
  );
  if (orphans.length > MAX_ORPHANS_PER_RUN) {
    summary.failures++;
    logger.error(
      { orphans: orphans.length, limit: MAX_ORPHANS_PER_RUN },
      "found more unused images than the limit; none were deleted. Check the job's settings point at the right database",
    );
    return;
  }

  for (const image of orphans) {
    try {
      await photos.delete(image.name);
      summary.orphansDeleted++;
      logger.info({ blob: image.name }, "deleted an image no recipe refers to");
    } catch (error) {
      summary.failures++;
      logger.error({ err: error, blob: image.name }, "could not delete an image no recipe refers to");
    }
  }
}
