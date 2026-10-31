/**
 * Server configuration, read from the environment.
 *
 * `APP_ENV` names the environment. Only when it is `development` or `test` may settings be left out or blank; they then default
 * to the Cosmos DB emulator from docker-compose.yml. In every other case, including when `APP_ENV` is not set, every setting is
 * required and `loadConfig` throws at startup naming the missing ones, so a deployed app never silently uses the emulator.
 * `npm run dev` and the Vitest configs set `APP_ENV` for local use.
 */
export interface CosmosConfig {
  endpoint: string;
  key: string;
  database: string;
  container: string;
}

export interface Config {
  cosmos: CosmosConfig;
}

/** The emulator's address in docker-compose.yml; it serves plain HTTP. */
export const COSMOS_EMULATOR_ENDPOINT = "http://localhost:8081";

/**
 * The Cosmos DB emulator's fixed, publicly documented key. It is the same for every emulator install and grants access to
 * nothing else, so it is not a secret.
 */
export const COSMOS_EMULATOR_KEY =
  "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

/** The `APP_ENV` values in which missing settings fall back to the local emulator defaults. */
const LOCAL_ENVIRONMENTS: readonly string[] = ["development", "test"];

type Env = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: Env = process.env): Config {
  const useLocalDefaults = LOCAL_ENVIRONMENTS.includes(env.APP_ENV?.trim() ?? "");
  const missing: string[] = [];

  function setting(name: string, localDefault: string): string {
    const value = env[name]?.trim();
    if (value !== undefined && value !== "") return value;
    if (!useLocalDefaults) missing.push(name);
    return localDefault;
  }

  const config: Config = {
    cosmos: {
      endpoint: setting("COSMOS_ENDPOINT", COSMOS_EMULATOR_ENDPOINT),
      key: setting("COSMOS_KEY", COSMOS_EMULATOR_KEY),
      database: setting("COSMOS_DATABASE", "recipebox"),
      container: setting("COSMOS_CONTAINER", "recipes"),
    },
  };
  if (missing.length > 0) {
    throw new Error(
      `Missing required settings: ${missing.join(", ")}. ` +
        "Set them, or set APP_ENV=development or APP_ENV=test to use the local emulator.",
    );
  }
  return config;
}
