import type { FastifyInstance } from "fastify";
import type { ErrorResponse } from "@recipebox/shared";

declare module "fastify" {
  interface FastifyContextConfig {
    /**
     * Declares the route an upload: it also accepts `multipart/form-data` as well as JSON, and every change sent to it must
     * carry `X-Requested-By: recipebox`. Used by the photo upload (`PUT /recipes/{id}/photo`, REC-7) and the start of an import
     * (`POST /imports`, IMP-1), the uploads in docs/api.md. The header check is part of this declaration, so no upload route can
     * skip it (docs/architecture.md, "Sign-in").
     */
    acceptsMultipartUpload?: boolean;
  }
}

/** The header every upload must carry, and its value (docs/api.md, "Conventions"). The client sends it with each upload. */
export const UPLOAD_HEADER = "x-requested-by";
export const UPLOAD_HEADER_VALUE = "recipebox";

/** Methods that never change anything; every other method is a change. */
const SAFE_METHODS: readonly string[] = ["GET", "HEAD", "OPTIONS"];

function mediaType(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase();
}

/**
 * CSRF protection (docs/architecture.md, "Sign-in"): every change must be sent with `Content-Type: application/json` (parameters
 * such as charset allowed). A form on another site can't send that without a CORS preflight, which CORS refuses. Anything else,
 * including no content type at all, is refused with 415 before the body is read.
 *
 * The exception is an upload route (`acceptsMultipartUpload`), which also accepts multipart/form-data. A form on another site
 * can send a multipart `POST` without a preflight, so every change sent to an upload route, whatever its method or content type,
 * must carry `X-Requested-By: recipebox`: a form can't add a header, and a script on another site can only send one after a
 * preflight, which CORS refuses. Without it the request gets 403 `request.headerMissing` before its body is read.
 */
export function registerJsonOnlyChanges(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (SAFE_METHODS.includes(request.method)) return undefined;
    const isUpload = request.routeOptions.config.acceptsMultipartUpload === true;
    if (isUpload && request.headers[UPLOAD_HEADER] !== UPLOAD_HEADER_VALUE) {
      const body: ErrorResponse = {
        errors: [
          {
            code: "request.headerMissing",
            message: `Uploads must carry the header X-Requested-By: ${UPLOAD_HEADER_VALUE}.`,
          },
        ],
      };
      return reply.code(403).send(body);
    }
    const type = mediaType(request.headers["content-type"]);
    if (type === "application/json") return undefined;
    if (type === "multipart/form-data" && isUpload) return undefined;
    const body: ErrorResponse = {
      errors: [{ code: "request.unsupportedMediaType", message: "Changes must be sent as JSON (Content-Type: application/json)." }],
    };
    return reply.code(415).send(body);
  });
}
