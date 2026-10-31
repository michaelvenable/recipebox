import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { HealthResponse, Me } from "@recipebox/shared";
import type { Config } from "./config.js";
import { registerCaller } from "./http/caller.js";
import { registerJsonOnlyChanges } from "./http/content-type.js";
import { registerErrorHandling } from "./http/errors.js";

/** Everything the API needs from outside, passed in so tests can build it without environment variables. */
export interface AppDependencies {
  config: Config;
  /**
   * Fastify's logger. main.ts turns it on (JSON lines to stdout, collected by Container Apps); tests leave it off unless they
   * check what is logged. Fastify's default request serializer logs method, URL and host but no headers, so cookies and
   * authorization headers never reach the log; don't replace it with one that logs headers.
   */
  logger?: FastifyServerOptions["logger"];
}

// Builds the API without starting it, so tests can call routes with inject() (docs/architecture.md, "Testing").
export async function buildApp({ config, logger = false }: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger });

  registerErrorHandling(app);
  // CORS allows exactly the client's origin, with the session cookie (docs/architecture.md, "Sign-in"). Any other origin gets
  // no CORS headers at all. A function rather than a list, because with a list @fastify/cors still sends
  // Access-Control-Allow-Credentials to other origins.
  await app.register(cors, {
    origin: (origin, callback) => callback(null, origin === config.clientOrigin),
    credentials: true,
    // The methods the client uses; without this list @fastify/cors allows only GET, HEAD and POST.
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

  return app;
}
