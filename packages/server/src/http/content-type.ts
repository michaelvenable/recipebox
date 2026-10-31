import type { FastifyInstance } from "fastify";
import type { ErrorResponse } from "@recipebox/shared";

declare module "fastify" {
  interface FastifyContextConfig {
    /**
     * Opt-in for a route that receives an upload: also accept `multipart/form-data` as well as JSON. Only the photo upload
     * (`PUT /recipes/{id}/photo`, REC-7) uses it; docs/api.md calls it "the one exception to the JSON rule". It is allowed only
     * on `PUT` routes: a form on another site can only `POST`, and a cross-site `PUT` needs a CORS preflight, which CORS refuses
     * for other origins. Setting it on any other method fails when the app is built.
     */
    acceptsMultipartUpload?: boolean;
  }
}

/** Methods that never change anything; every other method is a change. */
const SAFE_METHODS: readonly string[] = ["GET", "HEAD", "OPTIONS"];

/** The only method that may accept multipart/form-data (docs/architecture.md, "Sign-in"). */
const MULTIPART_METHOD = "PUT";

function mediaType(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase();
}

/**
 * CSRF protection (docs/architecture.md, "Sign-in"): every change must be sent with `Content-Type: application/json` (parameters
 * such as charset allowed). A form on another site can't send that without a CORS preflight, which CORS refuses. Anything else,
 * including no content type at all, is refused with 415 before the body is read. The one exception is multipart/form-data on a
 * `PUT` route that opts in with `acceptsMultipartUpload`.
 */
export function registerJsonOnlyChanges(app: FastifyInstance): void {
  app.addHook("onRoute", (route) => {
    if (route.config?.acceptsMultipartUpload !== true) return;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const others = methods.filter((method) => method.toUpperCase() !== MULTIPART_METHOD);
    if (others.length > 0) {
      throw new Error(
        `acceptsMultipartUpload is allowed only on ${MULTIPART_METHOD} routes; ${others.join(", ")} ${route.url} uses it. ` +
          "A form on another site can send multipart/form-data with POST without a CORS preflight.",
      );
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    if (SAFE_METHODS.includes(request.method)) return undefined;
    const type = mediaType(request.headers["content-type"]);
    if (type === "application/json") return undefined;
    if (
      type === "multipart/form-data" &&
      request.method === MULTIPART_METHOD &&
      request.routeOptions.config.acceptsMultipartUpload === true
    ) {
      return undefined;
    }
    const body: ErrorResponse = {
      errors: [{ code: "request.unsupportedMediaType", message: "Changes must be sent as JSON (Content-Type: application/json)." }],
    };
    return reply.code(415).send(body);
  });
}
