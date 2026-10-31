import { buildApp } from "./app.js";
import { randomRecipeId, systemClock } from "./clock.js";
import { loadConfig } from "./config.js";
import {
  CosmosRecipeRepository,
  createCosmosClient,
  ensureRecipeContainer,
} from "./recipes/cosmos-recipe-repository.js";

// Fails at startup, naming each missing or malformed setting, rather than on the first request.
const config = loadConfig();

// Locally the emulator's database and container are created on first run; deployed ones come from the infrastructure scripts.
const cosmos = createCosmosClient(config.cosmos);
const container = config.local
  ? await ensureRecipeContainer(cosmos, config.cosmos)
  : cosmos.database(config.cosmos.database).container(config.cosmos.container);

const port = Number(process.env.PORT ?? 3000);
const app = await buildApp({
  config,
  recipes: new CosmosRecipeRepository(container),
  clock: systemClock,
  newRecipeId: randomRecipeId,
  logger: true,
});

await app.listen({ port, host: "0.0.0.0" });
console.log(`RecipeBox API listening on port ${port}`);
