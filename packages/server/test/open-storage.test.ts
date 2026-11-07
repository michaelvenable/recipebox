import { readFileSync } from "node:fs";
import type { Container, CosmosClient } from "@azure/cosmos";
import type { ContainerClient } from "@azure/storage-blob";
import { describe, expect, it } from "vitest";
import { openStorage, type StorageOpeners } from "../src/open-storage.js";

// Safety rule for the trash cleanup job and the API (docs/architecture.md, "Trash cleanup"): outside local development,
// databases and containers are never created, so a misconfigured run fails instead of starting against new, empty stores.

const cosmos = {} as CosmosClient;
const photos = { containerName: "photos" } as ContainerClient;
const recipeContainer = { id: "recipes" } as Container;
const cosmosNames = {
  endpoint: "https://example",
  access: { kind: "key" as const, key: "k" },
  database: "db",
  container: "recipes",
};

function recordingOpeners(): { calls: string[]; openers: StorageOpeners } {
  const calls: string[] = [];
  return {
    calls,
    openers: {
      ensureRecipeContainer: async () => (calls.push("ensureRecipeContainer"), recipeContainer),
      openRecipeContainer: async () => (calls.push("openRecipeContainer"), recipeContainer),
      ensurePhotoContainer: async (c) => (calls.push("ensurePhotoContainer"), c),
      openPhotoContainer: async (c) => (calls.push("openPhotoContainer"), c),
    },
  };
}

describe("openStorage", () => {
  it("outside local development only opens existing containers and never creates any", async () => {
    const { calls, openers } = recordingOpeners();

    const result = await openStorage({ local: false, cosmos: cosmosNames }, cosmos, photos, openers);

    expect(calls.sort()).toEqual(["openPhotoContainer", "openRecipeContainer"]);
    expect(result).toEqual({ recipeContainer, photoContainer: photos });
  });

  it("in local development creates the emulators' containers if missing", async () => {
    const { calls, openers } = recordingOpeners();

    const result = await openStorage({ local: true, cosmos: cosmosNames }, cosmos, photos, openers);

    expect(calls.sort()).toEqual(["ensurePhotoContainer", "ensureRecipeContainer"]);
    expect(result).toEqual({ recipeContainer, photoContainer: photos });
  });
});

describe("entry points", () => {
  it.each(["../src/main.ts", "../src/jobs/cleanup.ts"])("%s opens storage only through openStorage", (path) => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source).toMatch(/\bopenStorage\(/);
    expect(source).not.toMatch(/\b(ensure|open)(Recipe|Photo)Container\b|createIfNotExists/);
  });
});

describe("cleanup npm scripts", () => {
  const scripts = (
    JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> }
  ).scripts;

  it('"cleanup" runs with the environment as deployed and never sets APP_ENV', () => {
    expect(scripts.cleanup).toBeDefined();
    expect(scripts.cleanup).not.toMatch(/APP_ENV/);
  });

  it('"cleanup:dev" sets APP_ENV=development for the emulators', () => {
    expect(scripts["cleanup:dev"]).toMatch(/\bAPP_ENV=development\b/);
  });
});
