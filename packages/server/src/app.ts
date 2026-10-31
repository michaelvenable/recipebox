import Fastify, { type FastifyInstance } from "fastify";
import type { HealthResponse } from "@recipebox/shared";

// Builds the API without starting it, so tests can call routes with inject() (docs/architecture.md, "Testing").
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async (): Promise<HealthResponse> => ({ status: "ok" }));

  return app;
}
