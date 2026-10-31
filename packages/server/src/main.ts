import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

// Fails at startup, naming each missing setting, rather than on the first request.
loadConfig();

const port = Number(process.env.PORT ?? 3000);
const app = buildApp();

await app.listen({ port, host: "0.0.0.0" });
console.log(`RecipeBox API listening on port ${port}`);
