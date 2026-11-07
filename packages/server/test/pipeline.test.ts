import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { ErrorResponse } from "@recipebox/shared";
import type { AppDependencies } from "../src/app.js";
import { requireEditor } from "../src/http/caller.js";
import { DEPLOYED_SETTINGS, EDITOR, NON_EDITOR, appWith } from "./app-helpers.js";

/** The app plus stand-in routes; recipe routes come later. */
async function appWithTestRoutes(
  env: Record<string, string | undefined> = {},
  logger: AppDependencies["logger"] = false,
): Promise<FastifyInstance> {
  const app = await appWith(env, logger);
  let changes = 0;
  app.get("/test/changes", async () => ({ changes }));
  app.post("/test/change", { preHandler: requireEditor }, async () => {
    changes += 1;
    return { changes };
  });
  app.put("/test/change", async () => ({ ok: true }));
  app.delete("/test/change", async () => ({ ok: true }));
  app.get("/test/boom", async () => {
    throw new Error("connection string AccountKey=secret at CosmosClient.read");
  });
  app.get("/test/teapot", async () => {
    throw Object.assign(new Error("short and stout"), { statusCode: 418 });
  });
  // Shaped like an Azure SDK RestError from Blob Storage: a statusCode and the service's own text.
  app.get("/test/storage-denied", async () => {
    throw Object.assign(
      new Error("AuthorizationFailure: This request is not authorized to perform this operation. RequestId:7c1e-0001 Time:..."),
      { name: "RestError", statusCode: 403, code: "AuthorizationFailure" },
    );
  });
  return app;
}

function expectErrorResponse(body: unknown, code: string): void {
  const parsed = ErrorResponse.parse(body);
  expect(parsed.errors.map((e) => e.code)).toEqual([code]);
}

async function changeCount(app: FastifyInstance): Promise<unknown> {
  return (await app.inject({ method: "GET", url: "/test/changes" })).json();
}

const JSON_HEADERS = { "content-type": "application/json" };

describe("X-6 changes require a signed-in editor", () => {
  it("refuses a visitor with 401 and changes nothing", async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({ method: "POST", url: "/test/change", headers: JSON_HEADERS, payload: {} });

    expect(res.statusCode).toBe(401);
    expectErrorResponse(res.json(), "auth.signInRequired");
    expect(await changeCount(app)).toEqual({ changes: 0 });
  });

  it("refuses a signed-in non-editor with 403 and changes nothing", async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({
      method: "POST",
      url: "/test/change",
      headers: { ...JSON_HEADERS, "x-dev-identity": NON_EDITOR },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expectErrorResponse(res.json(), "auth.notEditor");
    expect(await changeCount(app)).toEqual({ changes: 0 });
  });

  it("refuses everyone with 403 when EDITORS is empty", async () => {
    const app = await appWithTestRoutes({ EDITORS: "" });
    const res = await app.inject({
      method: "POST",
      url: "/test/change",
      headers: { ...JSON_HEADERS, "x-dev-identity": EDITOR },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets an editor through", async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({
      method: "POST",
      url: "/test/change",
      headers: { ...JSON_HEADERS, "x-dev-identity": EDITOR },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ changes: 1 });
  });

  it("treats forged identity headers on Container Apps without TRUST_AUTH_HEADERS as a visitor (401)", async () => {
    const app = await appWithTestRoutes({ ...DEPLOYED_SETTINGS, APP_ENV: "production", CONTAINER_APP_NAME: "recipebox-api" });
    const res = await app.inject({
      method: "POST",
      url: "/test/change",
      headers: { ...JSON_HEADERS, "x-ms-client-principal-idp": "google", "x-ms-client-principal-id": "1098" },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("treats forged identity headers off Container Apps as a visitor (401)", async () => {
    const app = await appWithTestRoutes({ ...DEPLOYED_SETTINGS, APP_ENV: "production" });
    const res = await app.inject({
      method: "POST",
      url: "/test/change",
      headers: {
        ...JSON_HEADERS,
        "x-ms-client-principal-idp": "google",
        "x-ms-client-principal-id": "1098",
        "x-dev-identity": EDITOR,
      },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('architecture "Sign-in": CSRF, changes must be JSON', () => {
  const editor = { "x-dev-identity": EDITOR };

  it.each([
    ["no content type", {}, ""],
    ["text/plain", { "content-type": "text/plain" }, "{}"],
    ["application/x-www-form-urlencoded", { "content-type": "application/x-www-form-urlencoded" }, "a=1"],
    ["multipart/form-data", { "content-type": "multipart/form-data; boundary=x" }, "--x--"],
    ["application/jsonp", { "content-type": "application/jsonp" }, "{}"],
  ])("refuses a POST with %s with 415, and changes nothing", async (_name, headers, payload) => {
    const app = await appWithTestRoutes();
    const res = await app.inject({ method: "POST", url: "/test/change", headers: { ...editor, ...headers }, payload });

    expect(res.statusCode).toBe(415);
    expectErrorResponse(res.json(), "request.unsupportedMediaType");
    expect(await changeCount(app)).toEqual({ changes: 0 });
  });

  it.each(["PUT", "DELETE"] as const)("refuses a %s without a JSON content type with 415", async (method) => {
    const app = await appWithTestRoutes();
    const res = await app.inject({ method, url: "/test/change", headers: { "content-type": "text/plain" }, payload: "{}" });
    expect(res.statusCode).toBe(415);
    expectErrorResponse(res.json(), "request.unsupportedMediaType");
  });

  it.each(["application/json", "application/json; charset=utf-8", "Application/JSON;charset=UTF-8"])(
    "accepts %s",
    async (contentType) => {
      const app = await appWithTestRoutes();
      const res = await app.inject({
        method: "POST",
        url: "/test/change",
        headers: { ...editor, "content-type": contentType },
        payload: "{}",
      });
      expect(res.statusCode).toBe(200);
    },
  );

  it("accepts a DELETE with an empty JSON body", async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({ method: "DELETE", url: "/test/change", headers: JSON_HEADERS, payload: "{}" });
    expect(res.statusCode).toBe(200);
  });

  describe("uploads: multipart/form-data only on upload routes, and only with X-Requested-By: recipebox", () => {
    const UPLOAD = { "x-requested-by": "recipebox" };
    const MULTIPART = { "content-type": "multipart/form-data; boundary=x" };

    /** The app with an upload route for each method a change can use. */
    async function appWithUploads(): Promise<FastifyInstance> {
      const app = await appWithTestRoutes();
      for (const method of ["POST", "PUT", "DELETE"] as const) {
        app.route({ method, url: "/test/any-upload", config: { acceptsMultipartUpload: true }, handler: async () => ({ ok: true }) });
      }
      app.addContentTypeParser("multipart/form-data", (_request, _payload, done) => done(null, undefined));
      return app;
    }

    it.each(["PUT", "POST", "DELETE"] as const)("accepts multipart/form-data with the header on a %s upload route", async (method) => {
      const app = await appWithUploads();
      const res = await app.inject({ method, url: "/test/any-upload", headers: { ...MULTIPART, ...UPLOAD }, payload: "--x--" });
      expect(res.statusCode, res.body).toBe(200);
    });

    it.each(["PUT", "POST", "DELETE"] as const)(
      "refuses a %s upload without the header with 403 request.headerMissing, as a form on another site would send it",
      async (method) => {
        const app = await appWithUploads();
        const res = await app.inject({ method, url: "/test/any-upload", headers: MULTIPART, payload: "--x--" });
        expect(res.statusCode).toBe(403);
        expectErrorResponse(res.json(), "request.headerMissing");
      },
    );

    it.each([
      ["another value", { "x-requested-by": "evil" }],
      ["an empty value", { "x-requested-by": "" }],
      ["the value in other case", { "x-requested-by": "RecipeBox" }],
      ["a different header", { "x-requested-with": "recipebox" }],
    ])("refuses an upload with %s with 403", async (_case, headers) => {
      const app = await appWithUploads();
      const res = await app.inject({ method: "POST", url: "/test/any-upload", headers: { ...MULTIPART, ...headers }, payload: "--x--" });
      expect(res.statusCode).toBe(403);
      expectErrorResponse(res.json(), "request.headerMissing");
    });

    it("refuses before the body is read, whatever its content type", async () => {
      const app = await appWithUploads();
      for (const type of ["application/json", "text/plain", "application/x-www-form-urlencoded"]) {
        const res = await app.inject({ method: "POST", url: "/test/any-upload", headers: { "content-type": type }, payload: "{" });
        expect(res.statusCode, type).toBe(403);
        expectErrorResponse(res.json(), "request.headerMissing");
      }
    });

    it("refuses text/plain and form-urlencoded on an upload route with 415, even with the header", async () => {
      const app = await appWithUploads();
      for (const type of ["text/plain", "application/x-www-form-urlencoded"]) {
        const res = await app.inject({
          method: "POST",
          url: "/test/any-upload",
          headers: { "content-type": type, ...UPLOAD },
          payload: "x",
        });
        expect(res.statusCode, type).toBe(415);
        expectErrorResponse(res.json(), "request.unsupportedMediaType");
      }
    });

    it.each(["POST", "PUT", "DELETE"] as const)(
      "refuses multipart/form-data with 415 on a %s route that isn't an upload, even with the header",
      async (method) => {
        const app = await appWithTestRoutes();
        const res = await app.inject({ method, url: "/test/change", headers: { ...MULTIPART, ...UPLOAD }, payload: "--x--" });
        expect(res.statusCode).toBe(415);
        expectErrorResponse(res.json(), "request.unsupportedMediaType");
      },
    );

    it("doesn't ask JSON changes to other routes for the header", async () => {
      const app = await appWithTestRoutes();
      const res = await app.inject({ method: "PUT", url: "/test/change", headers: JSON_HEADERS, payload: "{}" });
      expect(res.statusCode).toBe(200);
    });
  });

  it("does not require a content type for GET", async () => {
    const app = await appWithTestRoutes();
    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(200);
  });
});

describe('architecture "Sign-in": CORS', () => {
  const clientOrigin = "https://recipes.example.net";
  const env = { ...DEPLOYED_SETTINGS, APP_ENV: "production", CLIENT_ORIGIN: clientOrigin };
  const preflightHeaders = { "access-control-request-method": "POST", "access-control-request-headers": "content-type" };

  it("allows the client's origin, with credentials", async () => {
    const app = await appWithTestRoutes(env);
    const res = await app.inject({ method: "GET", url: "/me", headers: { origin: clientOrigin } });
    expect(res.headers["access-control-allow-origin"]).toBe(clientOrigin);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("answers the client's preflight for a JSON change", async () => {
    const app = await appWithTestRoutes(env);
    const res = await app.inject({
      method: "OPTIONS",
      url: "/test/change",
      headers: { origin: clientOrigin, ...preflightHeaders },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers["access-control-allow-origin"]).toBe(clientOrigin);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it.each(["POST", "PUT", "DELETE"])("allows the client's preflight for %s", async (method) => {
    const app = await appWithTestRoutes(env);
    const res = await app.inject({
      method: "OPTIONS",
      url: "/test/change",
      headers: { origin: clientOrigin, "access-control-request-method": method, "access-control-request-headers": "content-type" },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers["access-control-allow-origin"]).toBe(clientOrigin);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    const allowed = String(res.headers["access-control-allow-methods"]).split(",").map((m) => m.trim());
    expect(allowed).toContain(method);
  });

  it.each(["POST", "PUT"])("allows the client's %s upload preflight the X-Requested-By header", async (method) => {
    const app = await appWithTestRoutes(env);
    const res = await app.inject({
      method: "OPTIONS",
      url: "/imports",
      headers: { origin: clientOrigin, "access-control-request-method": method, "access-control-request-headers": "x-requested-by" },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers["access-control-allow-origin"]).toBe(clientOrigin);
    const allowed = String(res.headers["access-control-allow-headers"]).split(",").map((h) => h.trim().toLowerCase());
    expect(allowed).toContain("x-requested-by");
  });

  it("gives another origin's upload preflight no CORS allowance, so its script can't send X-Requested-By", async () => {
    const app = await appWithTestRoutes(env);
    const res = await app.inject({
      method: "OPTIONS",
      url: "/imports",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-requested-by",
      },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-headers"]).toBeUndefined();
  });

  it.each(["POST", "PUT", "DELETE"])("gives another origin's %s preflight no CORS allowance", async (method) => {
    const app = await appWithTestRoutes(env);
    const res = await app.inject({
      method: "OPTIONS",
      url: "/test/change",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": method,
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it.each(["https://evil.example.com", "https://recipes.example.net.evil.com", "http://recipes.example.net", "null"])(
    "gives no CORS allowance to %s",
    async (origin) => {
      const app = await appWithTestRoutes(env);
      const get = await app.inject({ method: "GET", url: "/me", headers: { origin } });
      expect(get.headers["access-control-allow-origin"]).toBeUndefined();
      expect(get.headers["access-control-allow-credentials"]).toBeUndefined();

      const preflight = await app.inject({
        method: "OPTIONS",
        url: "/test/change",
        headers: { origin, ...preflightHeaders },
      });
      expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
      expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();
    },
  );

  it("allows http://localhost:5173 by default in development", async () => {
    const app = await appWithTestRoutes({ APP_ENV: "development" });
    const res = await app.inject({ method: "GET", url: "/me", headers: { origin: "http://localhost:5173" } });
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});

describe("docs/api.md errors: every error is an ErrorResponse", () => {
  it("answers a 500 with a generic message and no internal detail", async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({ method: "GET", url: "/test/boom" });

    expect(res.statusCode).toBe(500);
    expectErrorResponse(res.json(), "server.error");
    expect(res.body).not.toContain("AccountKey");
    expect(res.body).not.toContain("CosmosClient");
    expect(res.body).not.toContain("stack");
  });

  it("answers an error with a statusCode that is not Fastify's own with 500", async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({ method: "GET", url: "/test/teapot" });
    expect(res.statusCode).toBe(500);
    expectErrorResponse(res.json(), "server.error");
    expect(res.body).not.toContain("short and stout");
  });

  it("answers an Azure SDK RestError with 500 and none of the service's text", async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({ method: "GET", url: "/test/storage-denied" });
    expect(res.statusCode).toBe(500);
    expectErrorResponse(res.json(), "server.error");
    expect(res.body).not.toContain("AuthorizationFailure");
    expect(res.body).not.toContain("RequestId");
    expect(res.body).not.toContain("RestError");
  });

  it("logs a 500 with the error detail, but no cookies or authorization headers", async () => {
    const lines: string[] = [];
    const app = await appWithTestRoutes({}, { stream: { write: (line: string) => void lines.push(line) } });
    const res = await app.inject({
      method: "GET",
      url: "/test/boom",
      headers: { cookie: "AppServiceAuthSession=session-secret", authorization: "Bearer token-secret" },
    });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("AccountKey");
    const logged = lines.map((line) => JSON.parse(line) as { level: number; msg: string; err?: { message: string } });
    const failure = logged.find((entry) => entry.msg === "request failed");
    expect(failure?.level).toBe(50);
    expect(failure?.err?.message).toContain("AccountKey=secret at CosmosClient.read");
    const all = lines.join("\n");
    expect(all).not.toContain("session-secret");
    expect(all).not.toContain("token-secret");
  });

  it("keeps Fastify's own 400 for an empty JSON body", async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({
      method: "POST",
      url: "/test/change",
      headers: { ...JSON_HEADERS, "x-dev-identity": EDITOR },
      payload: "",
    });
    expect(res.statusCode).toBe(400);
    expectErrorResponse(res.json(), "request.rejected");
  });

  it("answers malformed JSON with 400", async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({
      method: "POST",
      url: "/test/change",
      headers: { ...JSON_HEADERS, "x-dev-identity": EDITOR },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expectErrorResponse(res.json(), "request.rejected");
  });

  it("answers an unknown route with 404", async () => {
    const app = await appWithTestRoutes();
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expectErrorResponse(res.json(), "notFound");
  });
});
