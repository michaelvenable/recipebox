import { describe, expect, it } from "vitest";
import { Me } from "@recipebox/shared";
import { DEPLOYED_SETTINGS, EDITOR, NON_EDITOR, appWith } from "./app-helpers.js";

const ON_CONTAINER_APPS = { CONTAINER_APP_NAME: "recipebox-api" };
/** Container Apps with the built-in authentication layer switched on. */
const BEHIND_AUTH = { ...ON_CONTAINER_APPS, TRUST_AUTH_HEADERS: "true" };

async function me(env: Record<string, string | undefined>, headers: Record<string, string>): Promise<Me> {
  const app = await appWith(env);
  const res = await app.inject({ method: "GET", url: "/me", headers });
  expect(res.statusCode).toBe(200);
  return Me.parse(res.json());
}

function principal(idp: string, id: string): Record<string, string> {
  return { "x-ms-client-principal-idp": idp, "x-ms-client-principal-id": id };
}

const VISITOR: Me = { signedIn: false, isEditor: false };

describe('architecture "Sign-in": Container Apps identity headers', () => {
  it.each([
    ["development", { APP_ENV: "development" }],
    ["test", { APP_ENV: "test" }],
    ["a deployed environment off Container Apps", { APP_ENV: "production", ...DEPLOYED_SETTINGS }],
  ])("ignores forged X-MS-CLIENT-PRINCIPAL-* headers in %s", async (_name, env) => {
    expect(await me(env, principal("google", "1098"))).toEqual(VISITOR);
  });

  it("ignores them on Container Apps without TRUST_AUTH_HEADERS (fail closed)", async () => {
    expect(await me({ APP_ENV: "production", ...DEPLOYED_SETTINGS, ...ON_CONTAINER_APPS }, principal("google", "1098"))).toEqual(
      VISITOR,
    );
  });

  it.each(["false", "", "TRUE", "True", " true", "1", "yes"])(
    "ignores them on Container Apps when TRUST_AUTH_HEADERS is %j",
    async (value) => {
      const env = { APP_ENV: "production", ...DEPLOYED_SETTINGS, ...ON_CONTAINER_APPS, TRUST_AUTH_HEADERS: value };
      expect(await me(env, principal("google", "1098"))).toEqual(VISITOR);
    },
  );

  it("ignores them with TRUST_AUTH_HEADERS=true off Container Apps", async () => {
    const env = { APP_ENV: "production", ...DEPLOYED_SETTINGS, TRUST_AUTH_HEADERS: "true" };
    expect(await me(env, principal("google", "1098"))).toEqual(VISITOR);
  });

  it("trusts them on Container Apps with TRUST_AUTH_HEADERS=true", async () => {
    const env = { APP_ENV: "production", ...DEPLOYED_SETTINGS, ...BEHIND_AUTH };
    expect(await me(env, principal("google", "1098"))).toEqual({
      signedIn: true,
      provider: "google",
      accountId: "1098",
      isEditor: true,
    });
    expect(await me(env, principal("aad", "7777"))).toEqual({
      signedIn: true,
      provider: "aad",
      accountId: "7777",
      isEditor: false,
    });
  });

  it.each([
    ["an unknown provider", principal("github", "1098")],
    ["a provider in the wrong case", principal("Google", "1098")],
    ["a blank account ID", principal("google", " ")],
    ["only the provider header", { "x-ms-client-principal-idp": "google" }],
    ["only the ID header", { "x-ms-client-principal-id": "1098" }],
  ])("treats %s as a visitor on Container Apps", async (_name, headers) => {
    expect(await me({ APP_ENV: "production", ...DEPLOYED_SETTINGS, ...BEHIND_AUTH }, headers)).toEqual(VISITOR);
  });
});

describe('architecture "Sign-in": development sign-in stub', () => {
  it.each(["development", "test"])("signs the caller in when APP_ENV=%s", async (appEnv) => {
    expect(await me({ APP_ENV: appEnv }, { "x-dev-identity": EDITOR })).toEqual({
      signedIn: true,
      provider: "google",
      accountId: "1098",
      isEditor: true,
    });
  });

  it.each([undefined, "production", "staging", "Development"])(
    "is ignored when APP_ENV is %j",
    async (appEnv) => {
      expect(await me({ ...DEPLOYED_SETTINGS, APP_ENV: appEnv }, { "x-dev-identity": EDITOR })).toEqual(VISITOR);
    },
  );

  it("is ignored on Container Apps", async () => {
    for (const env of [ON_CONTAINER_APPS, BEHIND_AUTH]) {
      expect(await me({ ...DEPLOYED_SETTINGS, APP_ENV: "production", ...env }, { "x-dev-identity": EDITOR })).toEqual(VISITOR);
    }
  });

  it.each(["development", "test"])("cannot be enabled on Container Apps: APP_ENV=%s refuses to start", async (appEnv) => {
    await expect(appWith({ APP_ENV: appEnv, ...ON_CONTAINER_APPS })).rejects.toThrow("not allowed on Container Apps");
  });

  it.each(["github:1098", "google", "google:", "1098"])("treats %j as a visitor", async (identity) => {
    expect(await me({}, { "x-dev-identity": identity })).toEqual(VISITOR);
  });
});

describe("X-7 editors are listed in configuration", () => {
  it("is an editor only on an exact provider + account ID match", async () => {
    expect((await me({}, { "x-dev-identity": "google:1098" })).isEditor).toBe(true);
    expect((await me({}, { "x-dev-identity": "aad:9f3c" })).isEditor).toBe(true);
    // Same ID, other provider.
    expect((await me({}, { "x-dev-identity": "aad:1098" })).isEditor).toBe(false);
    // Prefix, suffix and case variants of a listed ID.
    expect((await me({}, { "x-dev-identity": "google:109" })).isEditor).toBe(false);
    expect((await me({}, { "x-dev-identity": "google:10980" })).isEditor).toBe(false);
    expect((await me({}, { "x-dev-identity": "aad:9F3C" })).isEditor).toBe(false);
    expect((await me({}, { "x-dev-identity": NON_EDITOR })).isEditor).toBe(false);
  });

  it("has no editors when EDITORS is empty", async () => {
    expect(await me({ EDITORS: "" }, { "x-dev-identity": EDITOR })).toEqual({
      signedIn: true,
      provider: "google",
      accountId: "1098",
      isEditor: false,
    });
  });
});

describe("X-11 GET /me", () => {
  it("tells a visitor they are not signed in", async () => {
    expect(await me({}, {})).toEqual(VISITOR);
  });

  it("shows a signed-in non-editor their provider and account ID", async () => {
    expect(await me({}, { "x-dev-identity": "aad:abc-123" })).toEqual({
      signedIn: true,
      provider: "aad",
      accountId: "abc-123",
      isEditor: false,
    });
  });

  it("is never cached", async () => {
    const app = await appWith();
    const res = await app.inject({ method: "GET", url: "/me", headers: { "x-dev-identity": EDITOR } });
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
