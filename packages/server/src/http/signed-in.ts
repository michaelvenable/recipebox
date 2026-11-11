import type { FastifyInstance } from "fastify";

/**
 * Where `GET /signed-in?to={path}` sends the editor: the client's origin plus `to`, or the client's home page when `to` isn't a
 * path in the app (X-8; docs/api.md). Checking the text alone isn't enough: the URL parser drops tabs and newlines and reads
 * "\" as "/", so "/\t/evil.example" names another site. Parse it against the client's origin and compare origins.
 */
export function signedInTarget(clientOrigin: string, to: unknown): string {
  const home = `${clientOrigin}/`;
  if (typeof to !== "string" || !to.startsWith("/") || to.startsWith("//")) return home;
  let url: URL;
  try {
    url = new URL(to, clientOrigin);
  } catch {
    return home;
  }
  return url.origin === clientOrigin ? url.href : home;
}

/**
 * X-8: sign-in returns here, a path on the API host, because Container Apps authentication drops a full address for Microsoft
 * sign-in (docs/architecture.md, "Sign-in"). Open to everyone and changes nothing; it only redirects into the client.
 */
export function registerSignedInRoute(app: FastifyInstance, clientOrigin: string): void {
  app.get("/signed-in", async (request, reply) => {
    const to = (request.query as { to?: unknown } | undefined)?.to;
    reply.header("cache-control", "no-store");
    return reply.redirect(signedInTarget(clientOrigin, to), 302);
  });
}
