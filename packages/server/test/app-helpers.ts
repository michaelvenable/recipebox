import type { FastifyInstance } from "fastify";
import { Instant } from "@recipebox/domain";
import { type AppDependencies, buildApp } from "../src/app.js";
import { randomImportId, randomNoteId, randomRecipeId, randomShareToken } from "../src/clock.js";
import { type Config, loadConfig } from "../src/config.js";
import { InMemoryImportQueue } from "../src/imports/in-memory-import-queue.js";
import { InMemoryImportRepository } from "../src/imports/in-memory-import-repository.js";
import { InMemoryPhotoStore } from "../src/photos/in-memory-photo-store.js";
import { InMemoryRecipeRepository } from "../src/recipes/in-memory-recipe-repository.js";
import { InMemorySharedListRepository } from "../src/shopping-lists/in-memory-shared-list-repository.js";

/** Settings a deployed app needs, so tests can build a non-local config. */
export const DEPLOYED_SETTINGS = {
  COSMOS_ENDPOINT: "https://recipebox.documents.azure.com",
  COSMOS_DATABASE: "db",
  COSMOS_CONTAINER: "recipes-prod",
  COSMOS_SHOPPING_LIST_CONTAINER: "shopping-lists-prod",
  COSMOS_IMPORT_CONTAINER: "imports-prod",
  STORAGE_BLOB_ENDPOINT: "https://recipebox.blob.core.windows.net",
  STORAGE_QUEUE_ENDPOINT: "https://recipebox.queue.core.windows.net",
  STORAGE_PHOTO_CONTAINER: "photos-prod",
  STORAGE_IMPORT_QUEUE: "imports-prod",
  AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
  CLIENT_ORIGIN: "https://recipes.example.net",
};

export const EDITOR = "google:1098";
export const NON_EDITOR = "google:5555";

/** A config built the same way as in production, from an environment. Defaults to APP_ENV=test with one Google editor. */
export function configFrom(env: Record<string, string | undefined> = {}): Config {
  return loadConfig({ APP_ENV: "test", EDITORS: `${EDITOR},aad:9f3c`, ...env });
}

/** A fixed time for tests that don't care about the clock. */
export const TEST_TIME = "2026-10-01T09:00:00.000Z";

export function instant(iso: string): Instant {
  const parsed = Instant.fromIso(iso);
  if (!parsed.ok) throw new Error(`Not an ISO time: ${iso}`);
  return parsed.value;
}

/** The app with empty in-memory repositories and photo store and a fixed clock, unless `deps` says otherwise. */
export async function appWith(
  env: Record<string, string | undefined> = {},
  logger: AppDependencies["logger"] = false,
  deps: Partial<
    Pick<
      AppDependencies,
      | "recipes"
      | "sharedLists"
      | "imports"
      | "importQueue"
      | "photos"
      | "clock"
      | "newRecipeId"
      | "newNoteId"
      | "newShareToken"
      | "newImportId"
      | "photoProcessing"
    >
  > = {},
): Promise<FastifyInstance> {
  return buildApp({
    config: configFrom(env),
    logger,
    recipes: deps.recipes ?? new InMemoryRecipeRepository(),
    sharedLists: deps.sharedLists ?? new InMemorySharedListRepository(),
    imports: deps.imports ?? new InMemoryImportRepository(),
    importQueue: deps.importQueue ?? new InMemoryImportQueue(),
    photos: deps.photos ?? new InMemoryPhotoStore(),
    clock: deps.clock ?? (() => instant(TEST_TIME)),
    newRecipeId: deps.newRecipeId ?? randomRecipeId,
    newNoteId: deps.newNoteId ?? randomNoteId,
    newShareToken: deps.newShareToken ?? randomShareToken,
    newImportId: deps.newImportId ?? randomImportId,
    ...(deps.photoProcessing === undefined ? {} : { photoProcessing: deps.photoProcessing }),
  });
}
