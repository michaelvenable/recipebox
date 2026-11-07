import type { FastifyRequest, FastifyServerOptions } from "fastify";

/**
 * Paths whose last part is a secret: the code of a shopping list link (PLAN-9, GET /shopping-lists/{token}), which lets anyone
 * holding it read the list. Logs keep the prefix and drop the code, so the logs can't be used to open the list.
 */
const SECRET_PATHS = [/^(\/shopping-lists\/).*$/s];

/** `url` with everything after a secret path's prefix, query string included, replaced by `[redacted]`. */
export function redactedUrl(url: string): string {
  for (const pattern of SECRET_PATHS) {
    if (pattern.test(url)) return url.replace(pattern, "$1[redacted]");
  }
  return url;
}

/**
 * Fastify's default request serializer, with the URL redacted (`redactedUrl`). Like the default it logs no headers, so cookies
 * and authorization headers never reach the log.
 */
function serializeRequest(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: redactedUrl(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}

type LoggerOption = NonNullable<FastifyServerOptions["logger"]>;

/** The logger option with request URLs redacted. Off stays off. */
export function withRedactedUrls(logger: LoggerOption): LoggerOption {
  if (logger === false) return logger;
  const options = logger === true ? {} : logger;
  return { ...options, serializers: { ...options.serializers, req: serializeRequest } };
}
