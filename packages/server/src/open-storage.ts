import type { Container, CosmosClient } from "@azure/cosmos";
import type { ContainerClient } from "@azure/storage-blob";
import type { QueueClient } from "@azure/storage-queue";
import type { Config } from "./config.js";
import { ensureImportContainer, openImportContainer } from "./imports/cosmos-import-repository.js";
import { ensureImportQueue } from "./imports/storage-import-queue.js";
import { ensurePhotoContainer, openPhotoContainer } from "./photos/blob-photo-store.js";
import { ensureRecipeContainer, openRecipeContainer } from "./recipes/cosmos-recipe-repository.js";
import { ensureShoppingListContainer, openShoppingListContainer } from "./shopping-lists/cosmos-shared-list-repository.js";

/** The functions that create or open the stores; replaceable in tests. */
export interface StorageOpeners {
  ensureRecipeContainer: typeof ensureRecipeContainer;
  openRecipeContainer: typeof openRecipeContainer;
  ensureShoppingListContainer: typeof ensureShoppingListContainer;
  openShoppingListContainer: typeof openShoppingListContainer;
  ensureImportContainer: typeof ensureImportContainer;
  openImportContainer: typeof openImportContainer;
  ensurePhotoContainer: typeof ensurePhotoContainer;
  openPhotoContainer: typeof openPhotoContainer;
}

const defaultOpeners: StorageOpeners = {
  ensureRecipeContainer,
  openRecipeContainer,
  ensureShoppingListContainer,
  openShoppingListContainer,
  ensureImportContainer,
  openImportContainer,
  ensurePhotoContainer,
  openPhotoContainer,
};

/**
 * The recipe, sent shopping list (PLAN-9), import (IMP-3) and photo containers for the API and the trash cleanup job. Only
 * locally are the emulators' database and containers created on first run. Anywhere else they come from the infrastructure
 * scripts and a missing one is an error: an app must not start against a new, empty store, and against an empty recipe
 * container the cleanup sweep would find no recipes and treat every photo as unused (docs/architecture.md, "Trash cleanup").
 */
export async function openStorage(
  config: Pick<Config, "local" | "cosmos">,
  cosmos: CosmosClient,
  photos: ContainerClient,
  openers: StorageOpeners = defaultOpeners,
): Promise<{
  recipeContainer: Container;
  shoppingListContainer: Container;
  importContainer: Container;
  photoContainer: ContainerClient;
}> {
  if (config.local) {
    return {
      recipeContainer: await openers.ensureRecipeContainer(cosmos, config.cosmos),
      shoppingListContainer: await openers.ensureShoppingListContainer(cosmos, config.cosmos),
      importContainer: await openers.ensureImportContainer(cosmos, config.cosmos),
      photoContainer: await openers.ensurePhotoContainer(photos),
    };
  }
  return {
    recipeContainer: await openers.openRecipeContainer(cosmos, config.cosmos),
    shoppingListContainer: await openers.openShoppingListContainer(cosmos, config.cosmos),
    importContainer: await openers.openImportContainer(cosmos, config.cosmos),
    photoContainer: await openers.openPhotoContainer(photos),
  };
}

/**
 * The import queue for the API (docs/architecture.md, "Recipe import"). Only locally is Azurite's queue created on first run.
 * Anywhere else it comes from the infrastructure scripts and is not checked here (storage-import-queue.ts).
 */
export async function openImportQueue(
  config: Pick<Config, "local">,
  queue: QueueClient,
  ensure: typeof ensureImportQueue = ensureImportQueue,
): Promise<QueueClient> {
  return config.local ? ensure(queue) : queue;
}
