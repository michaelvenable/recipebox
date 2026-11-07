import type { Container, CosmosClient } from "@azure/cosmos";
import type { ContainerClient } from "@azure/storage-blob";
import type { Config } from "./config.js";
import { ensurePhotoContainer, openPhotoContainer } from "./photos/blob-photo-store.js";
import { ensureRecipeContainer, openRecipeContainer } from "./recipes/cosmos-recipe-repository.js";
import { ensureShoppingListContainer, openShoppingListContainer } from "./shopping-lists/cosmos-shared-list-repository.js";

/** The functions that create or open the stores; replaceable in tests. */
export interface StorageOpeners {
  ensureRecipeContainer: typeof ensureRecipeContainer;
  openRecipeContainer: typeof openRecipeContainer;
  ensureShoppingListContainer: typeof ensureShoppingListContainer;
  openShoppingListContainer: typeof openShoppingListContainer;
  ensurePhotoContainer: typeof ensurePhotoContainer;
  openPhotoContainer: typeof openPhotoContainer;
}

const defaultOpeners: StorageOpeners = {
  ensureRecipeContainer,
  openRecipeContainer,
  ensureShoppingListContainer,
  openShoppingListContainer,
  ensurePhotoContainer,
  openPhotoContainer,
};

/**
 * The recipe, sent shopping list (PLAN-9) and photo containers for the API and the trash cleanup job. Only locally are the
 * emulators' database and containers created on first run. Anywhere else they come from the infrastructure scripts and a
 * missing one is an error: an app must not start against a new, empty store, and against an empty recipe container the cleanup
 * sweep would find no recipes and treat every photo as unused (docs/architecture.md, "Trash cleanup").
 */
export async function openStorage(
  config: Pick<Config, "local" | "cosmos">,
  cosmos: CosmosClient,
  photos: ContainerClient,
  openers: StorageOpeners = defaultOpeners,
): Promise<{ recipeContainer: Container; shoppingListContainer: Container; photoContainer: ContainerClient }> {
  if (config.local) {
    return {
      recipeContainer: await openers.ensureRecipeContainer(cosmos, config.cosmos),
      shoppingListContainer: await openers.ensureShoppingListContainer(cosmos, config.cosmos),
      photoContainer: await openers.ensurePhotoContainer(photos),
    };
  }
  return {
    recipeContainer: await openers.openRecipeContainer(cosmos, config.cosmos),
    shoppingListContainer: await openers.openShoppingListContainer(cosmos, config.cosmos),
    photoContainer: await openers.openPhotoContainer(photos),
  };
}
