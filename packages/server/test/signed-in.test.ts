import { describe, expect, it } from "vitest";
import { DEPLOYED_SETTINGS, appWith } from "./app-helpers.js";

const ORIGIN = DEPLOYED_SETTINGS.CLIENT_ORIGIN;
const ENV = { APP_ENV: "production", ...DEPLOYED_SETTINGS };

async function signedIn(query: string, headers: Record<string, string> = {}) {
  const app = await appWith(ENV);
  return app.inject({ method: "GET", url: `/signed-in${query}`, headers });
}

describe("X-8 return to the page after signing in (GET /signed-in)", () => {
  it.each([
    ["/", `${ORIGIN}/`],
    ["/recipes/abc", `${ORIGIN}/recipes/abc`],
    ["/plan?sort=new&tag=soup", `${ORIGIN}/plan?sort=new&tag=soup`],
    ["/trash#top", `${ORIGIN}/trash#top`],
  ])("sends to=%j to that page in the client", async (to, location) => {
    const res = await signedIn(`?to=${encodeURIComponent(to)}`);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(location);
  });

  it.each([
    ["missing", ""],
    ["empty", "?to="],
    ["not a path", `?to=${encodeURIComponent("recipes/abc")}`],
    ["//evil.example", `?to=${encodeURIComponent("//evil.example")}`],
    ["/\\evil.example", `?to=${encodeURIComponent("/\\evil.example")}`],
    ["/\\t/evil.example", `?to=${encodeURIComponent("/\t/evil.example")}`],
    ["/\\n/evil.example", `?to=${encodeURIComponent("/\n/evil.example")}`],
    ["https://evil.example", `?to=${encodeURIComponent("https://evil.example")}`],
    ["https://evil.example/ with a path", `?to=${encodeURIComponent("https://evil.example/recipes")}`],
    ["javascript:", `?to=${encodeURIComponent("javascript:alert(1)")}`],
    ["given twice", "?to=%2Fa&to=%2Fb"],
  ])("sends a to that isn't a path in the app (%s) to the client's home page", async (_name, query) => {
    const res = await signedIn(query);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${ORIGIN}/`);
  });

  it("needs no sign-in and no JSON content type, and isn't cached", async () => {
    const res = await signedIn(`?to=${encodeURIComponent("/account")}`, { "content-type": "text/plain" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${ORIGIN}/account`);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("only answers GET: a POST is not a route", async () => {
    const app = await appWith(ENV);
    const res = await app.inject({
      method: "POST",
      url: "/signed-in",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(res.statusCode).toBe(404);
  });
});
