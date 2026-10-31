import { describe, expect, it } from "vitest";
import { HealthResponse } from "@recipebox/shared";
import { buildApp } from "../src/app.js";

describe("health check", () => {
  it("responds ok with a body matching the shared contract", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(HealthResponse.parse(res.json())).toEqual({ status: "ok" });
  });
});
