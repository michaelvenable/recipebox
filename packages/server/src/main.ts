import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

// Fails at startup, naming each missing or malformed setting, rather than on the first request.
const config = loadConfig();

const port = Number(process.env.PORT ?? 3000);
const app = await buildApp({ config, logger: true });

await app.listen({ port, host: "0.0.0.0" });
console.log(`RecipeBox API listening on port ${port}`);
