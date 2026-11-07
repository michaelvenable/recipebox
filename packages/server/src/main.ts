import { buildApp } from "./app.js";
import { randomRecipeId, randomShareToken, systemClock } from "./clock.js";
import { loadConfig } from "./config.js";
import { openStorage } from "./open-storage.js";
import { BlobPhotoStore, createPhotoContainerClient } from "./photos/blob-photo-store.js";
import { CosmosRecipeRepository, createCosmosClient } from "./recipes/cosmos-recipe-repository.js";
import { CosmosSharedListRepository } from "./shopping-lists/cosmos-shared-list-repository.js";

// Fails at startup, naming each missing or malformed setting, rather than on the first request.
const config = loadConfig();

// Locally the emulators' database and containers are created on first run; deployed ones come from the infrastructure scripts,
// and if one is missing the app refuses to start rather than creating an empty one.
const cosmos = createCosmosClient(config.cosmos);
const { recipeContainer: container, shoppingListContainer, photoContainer } = await openStorage(
  config,
  cosmos,
  createPhotoContainerClient(config.storage),
);

const port = Number(process.env.PORT ?? 3000);
const app = await buildApp({
  config,
  recipes: new CosmosRecipeRepository(container),
  sharedLists: new CosmosSharedListRepository(shoppingListContainer),
  photos: new BlobPhotoStore(photoContainer),
  clock: systemClock,
  newRecipeId: randomRecipeId,
  newShareToken: randomShareToken,
  logger: true,
});

await app.listen({ port, host: "0.0.0.0" });
console.log(`RecipeBox API listening on port ${port}`);
