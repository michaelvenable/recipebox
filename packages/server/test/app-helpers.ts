import type { FastifyInstance } from "fastify";
import { type AppDependencies, buildApp } from "../src/app.js";
import { type Config, loadConfig } from "../src/config.js";

/** Settings a deployed app needs, so tests can build a non-local config. */
export const DEPLOYED_SETTINGS = {
  COSMOS_ENDPOINT: "https://recipebox.documents.azure.com:443/",
  COSMOS_KEY: "secret",
  COSMOS_DATABASE: "db",
  COSMOS_CONTAINER: "recipes-prod",
  CLIENT_ORIGIN: "https://recipes.example.net",
};

export const EDITOR = "google:1098";
export const NON_EDITOR = "google:5555";

/** A config built the same way as in production, from an environment. Defaults to APP_ENV=test with one Google editor. */
export function configFrom(env: Record<string, string | undefined> = {}): Config {
  return loadConfig({ APP_ENV: "test", EDITORS: `${EDITOR},aad:9f3c`, ...env });
}

export async function appWith(
  env: Record<string, string | undefined> = {},
  logger: AppDependencies["logger"] = false,
): Promise<FastifyInstance> {
  return buildApp({ config: configFrom(env), logger });
}
