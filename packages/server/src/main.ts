import { buildApp } from "./app.js";
import { randomImportId, randomNoteId, randomRecipeId, randomShareToken, systemClock } from "./clock.js";
import { loadConfig } from "./config.js";
import { CosmosImportRepository } from "./imports/cosmos-import-repository.js";
import { createImportQueueClient, StorageImportQueue } from "./imports/storage-import-queue.js";
import { openImportQueue, openStorage } from "./open-storage.js";
import { BlobPhotoStore, createPhotoContainerClient } from "./photos/blob-photo-store.js";
import { CosmosRecipeRepository, createCosmosClient } from "./recipes/cosmos-recipe-repository.js";
import { CosmosSharedListRepository } from "./shopping-lists/cosmos-shared-list-repository.js";

// Fails at startup, naming each missing or malformed setting, rather than on the first request.
const config = loadConfig();

// Locally the emulators' database and containers are created on first run; deployed ones come from the infrastructure scripts,
// and if one is missing the app refuses to start rather than creating an empty one.
const cosmos = createCosmosClient(config.cosmos);
const { recipeContainer: container, shoppingListContainer, importContainer, photoContainer } = await openStorage(
  config,
  cosmos,
  createPhotoContainerClient(config.storage),
);
const importQueue = await openImportQueue(config, createImportQueueClient(config.storage));

const port = Number(process.env.PORT ?? 3000);
const app = await buildApp({
  config,
  recipes: new CosmosRecipeRepository(container),
  sharedLists: new CosmosSharedListRepository(shoppingListContainer),
  imports: new CosmosImportRepository(importContainer),
  importQueue: new StorageImportQueue(importQueue),
  photos: new BlobPhotoStore(photoContainer),
  clock: systemClock,
  newRecipeId: randomRecipeId,
  newNoteId: randomNoteId,
  newShareToken: randomShareToken,
  newImportId: randomImportId,
  logger: true,
});

await app.listen({ port, host: "0.0.0.0" });
console.log(`RecipeBox API listening on port ${port}`);
