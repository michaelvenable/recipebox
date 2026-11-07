import type { FastifyInstance } from "fastify";
import { Instant } from "@recipebox/domain";
import { type AppDependencies, buildApp } from "../src/app.js";
import { randomRecipeId } from "../src/clock.js";
import { type Config, loadConfig } from "../src/config.js";
import { InMemoryPhotoStore } from "../src/photos/in-memory-photo-store.js";
import { InMemoryRecipeRepository } from "../src/recipes/in-memory-recipe-repository.js";

/** Settings a deployed app needs, so tests can build a non-local config. */
export const DEPLOYED_SETTINGS = {
  COSMOS_ENDPOINT: "https://recipebox.documents.azure.com",
  COSMOS_DATABASE: "db",
  COSMOS_CONTAINER: "recipes-prod",
  STORAGE_BLOB_ENDPOINT: "https://recipebox.blob.core.windows.net",
  STORAGE_PHOTO_CONTAINER: "photos-prod",
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

/** The app with an empty in-memory repository and photo store and a fixed clock, unless `deps` says otherwise. */
export async function appWith(
  env: Record<string, string | undefined> = {},
  logger: AppDependencies["logger"] = false,
  deps: Partial<Pick<AppDependencies, "recipes" | "photos" | "clock" | "newRecipeId" | "photoProcessing">> = {},
): Promise<FastifyInstance> {
  return buildApp({
    config: configFrom(env),
    logger,
    recipes: deps.recipes ?? new InMemoryRecipeRepository(),
    photos: deps.photos ?? new InMemoryPhotoStore(),
    clock: deps.clock ?? (() => instant(TEST_TIME)),
    newRecipeId: deps.newRecipeId ?? randomRecipeId,
    ...(deps.photoProcessing === undefined ? {} : { photoProcessing: deps.photoProcessing }),
  });
}
