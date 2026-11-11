import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { HealthResponse, Me } from "@recipebox/shared";
import type { Clock, ImportIdGenerator, RecipeIdGenerator, ShareTokenGenerator } from "./clock.js";
import type { Config } from "./config.js";
import { registerCaller } from "./http/caller.js";
import { registerJsonOnlyChanges } from "./http/content-type.js";
import { registerErrorHandling } from "./http/errors.js";
import { withRedactedUrls } from "./http/request-log.js";
import { registerSignedInRoute } from "./http/signed-in.js";
import type { ImportQueue } from "./imports/import-queue.js";
import type { ImportRepository } from "./imports/import-repository.js";
import { registerImportRoutes } from "./imports/import-routes.js";
import type { PhotoProcessingOptions } from "./photos/photo-processing.js";
import { registerPhotoRoutes } from "./photos/photo-routes.js";
import type { PhotoStore } from "./photos/photo-store.js";
import type { RecipeRepository } from "./recipes/recipe-repository.js";
import { registerRecipeRoutes } from "./recipes/recipe-routes.js";
import type { SharedListRepository } from "./shopping-lists/shared-list-repository.js";
import { registerSharedListRoutes } from "./shopping-lists/shared-list-routes.js";

/** Everything the API needs from outside, passed in so tests can build it without environment variables. */
export interface AppDependencies {
  config: Config;
  /** Where recipes are stored: Cosmos DB in main.ts, the in-memory repository in route tests. */
  recipes: RecipeRepository;
  /** Where sent shopping lists are stored (PLAN-9): Cosmos DB in main.ts, the in-memory repository in route tests. */
  sharedLists: SharedListRepository;
  /** Where imports are stored, one record each (IMP-3): Cosmos DB in main.ts, the in-memory repository in route tests. */
  imports: ImportRepository;
  /** The queue that starts the import job (IMP-1): a Storage queue in main.ts, in memory in route tests. */
  importQueue: ImportQueue;
  /** Where photo images are stored: Blob Storage in main.ts, the in-memory store in route tests (REC-7). */
  photos: PhotoStore;
  /** The server's clock, the source of every stored time (X-12). */
  clock: Clock;
  /** Creates the id for a new recipe (REC-1). */
  newRecipeId: RecipeIdGenerator;
  /** Creates the random code of a new shopping list link (PLAN-9). */
  newShareToken: ShareTokenGenerator;
  /** Creates the id of a new import (IMP-1). */
  newImportId: ImportIdGenerator;
  /** How photo uploads, recipe photos and import page photos, are decoded (REC-7, IMP-2). Left out except in tests that simulate a decoder that hangs or crashes. */
  photoProcessing?: Omit<PhotoProcessingOptions, "log">;
  /**
   * Fastify's logger. main.ts turns it on (JSON lines to stdout, collected by Container Apps); tests leave it off unless they
   * check what is logged. Fastify's default request serializer logs method, URL and host but no headers, so cookies and
   * authorization headers never reach the log; don't replace it with one that logs headers. The URL of a shopping list link
   * is logged without its code (http/request-log.ts, PLAN-9).
   */
  logger?: FastifyServerOptions["logger"];
}

// Builds the API without starting it, so tests can call routes with inject() (docs/architecture.md, "Testing").
export async function buildApp({
  config,
  recipes,
  sharedLists,
  imports,
  importQueue,
  photos,
  clock,
  newRecipeId,
  newShareToken,
  newImportId,
  photoProcessing = {},
  logger = false,
}: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: withRedactedUrls(logger) });

  registerErrorHandling(app);
  // CORS allows exactly the client's origin, with the session cookie (docs/architecture.md, "Sign-in"). Any other origin gets
  // no CORS headers at all. A function rather than a list, because with a list @fastify/cors still sends
  // Access-Control-Allow-Credentials to other origins.
  await app.register(cors, {
    origin: (origin, callback) => callback(null, origin === config.clientOrigin),
    credentials: true,
    // The methods the client uses; without this list @fastify/cors allows only GET, HEAD and POST. Request headers aren't
    // listed, so a preflight from the client's origin is allowed the headers it asks for, including X-Requested-By, which
    // every upload carries (docs/architecture.md, "Sign-in"); other origins get no CORS allowance at all.
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE"],
  });
  registerJsonOnlyChanges(app);
  registerCaller(app, config);

  app.get("/health", async (): Promise<HealthResponse> => ({ status: "ok" }));

  // X-11: the Account page. Answered per caller, so never cached.
  app.get("/me", async (request, reply): Promise<Me> => {
    reply.header("cache-control", "no-store");
    const caller = request.caller;
    if (!caller.signedIn) return { signedIn: false, isEditor: false };
    return { signedIn: true, provider: caller.provider, accountId: caller.accountId, isEditor: caller.isEditor };
  });

  registerSignedInRoute(app, config.clientOrigin);

  // Each in its own scope, so their hooks (and the photo routes' multipart parser) apply only to them.
  await app.register(async (scope) => registerRecipeRoutes(scope, { recipes, clock, newRecipeId }));
  await app.register(async (scope) => registerSharedListRoutes(scope, { recipes, sharedLists, clock, newShareToken }));
  await app.register(async (scope) => registerPhotoRoutes(scope, { recipes, photos, photoProcessing }));
  await app.register(async (scope) =>
    registerImportRoutes(scope, { imports, importQueue, photos, clock, newImportId, photoProcessing }),
  );

  return app;
}
