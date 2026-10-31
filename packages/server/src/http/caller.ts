import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ErrorResponse } from "@recipebox/shared";
import { type Config, type Identity, isProvider, parseIdentity } from "../config.js";

/** Who is making a request: a visitor, or a signed-in identity that may be on the editor list (X-6, X-7). */
export type Caller = { signedIn: false } | (Identity & { signedIn: true; isEditor: boolean });

declare module "fastify" {
  interface FastifyRequest {
    caller: Caller;
  }
}

/** Headers set by Container Apps' built-in authentication (docs/architecture.md, "Sign-in"). */
export const PRINCIPAL_IDP_HEADER = "x-ms-client-principal-idp";
export const PRINCIPAL_ID_HEADER = "x-ms-client-principal-id";
/** Development sign-in stub: `x-dev-identity: google:1234`. Honored only in development and test, never on Container Apps. */
export const DEV_IDENTITY_HEADER = "x-dev-identity";

const VISITOR: Caller = { signedIn: false };

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function identityOf(request: FastifyRequest, config: Config): Identity | undefined {
  if (config.onContainerApps) {
    // Fail closed: unless the auth layer is confirmed on, anyone could send these headers.
    if (!config.trustAuthHeaders) return undefined;
    // Only the auth layer in front of the app can set these; outside requests cannot.
    const provider = header(request, PRINCIPAL_IDP_HEADER)?.trim() ?? "";
    const accountId = header(request, PRINCIPAL_ID_HEADER)?.trim() ?? "";
    return isProvider(provider) && accountId !== "" ? { provider, accountId } : undefined;
  }
  if (config.local) {
    const stub = header(request, DEV_IDENTITY_HEADER);
    return stub === undefined ? undefined : parseIdentity(stub);
  }
  return undefined;
}

/** Sets `request.caller` on every request. An unknown provider or incomplete identity is a visitor. */
export function registerCaller(app: FastifyInstance, config: Config): void {
  // Placeholder until the onRequest hook below sets it; Fastify forbids an object as a request decorator's initial value.
  app.decorateRequest("caller", null as never);
  app.addHook("onRequest", async (request) => {
    const identity = identityOf(request, config);
    request.caller =
      identity === undefined
        ? VISITOR
        : {
            signedIn: true,
            ...identity,
            // X-7: an exact provider + account ID match; never an email address.
            isEditor: config.editors.some(
              (e) => e.provider === identity.provider && e.accountId === identity.accountId,
            ),
          };
  });
}

/**
 * preHandler for every change and editor-only endpoint (X-6): 401 for visitors, 403 for signed-in non-editors
 * (docs/api.md, errors table). Nothing runs after a refusal, so nothing is changed.
 */
export async function requireEditor(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  const caller = request.caller;
  if (!caller.signedIn) {
    const body: ErrorResponse = { errors: [{ code: "auth.signInRequired", message: "Sign in to do this." }] };
    return reply.code(401).send(body);
  }
  if (!caller.isEditor) {
    const body: ErrorResponse = {
      errors: [{ code: "auth.notEditor", message: "Only editors can do this. Your account is not on the editor list." }],
    };
    return reply.code(403).send(body);
  }
  return undefined;
}
