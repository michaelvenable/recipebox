import type { FastifyError, FastifyInstance } from "fastify";
import type { ErrorResponse } from "@recipebox/shared";

function errorResponse(code: string, message: string): ErrorResponse {
  return { errors: [{ code, message }] };
}

/**
 * Fastify's own request errors: its errors (code `FST_…`, e.g. malformed or empty JSON, body too large) and schema validation
 * failures. Only these describe the request. Other errors may carry a `statusCode` too, such as an Azure SDK `RestError` from a
 * storage call, but that status and message are about our call to the service, not the caller's request.
 */
function isRequestError(error: FastifyError): boolean {
  return error.validation !== undefined || (typeof error.code === "string" && error.code.startsWith("FST_"));
}

/**
 * Every error is answered with an `ErrorResponse` (docs/api.md, "Conventions"). Fastify's request errors (4xx) keep their status
 * and message, which describe the request. Every other error is logged and answered with 500 and a generic message, so no
 * stack trace or internal detail reaches the caller.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const status = error.statusCode;
    if (isRequestError(error) && status !== undefined && status >= 400 && status < 500) {
      const code = error.validation !== undefined ? "request.invalid" : "request.rejected";
      return reply.code(status).send(errorResponse(code, error.message));
    }
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send(errorResponse("server.error", "Something went wrong on the server. Please try again."));
  });

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send(errorResponse("notFound", "Not found.")),
  );
}
