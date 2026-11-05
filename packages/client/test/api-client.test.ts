import { describe, expect, it, vi } from "vitest";
import { EditorRecipe, Me } from "@recipebox/shared";
import { ApiError, apiBaseUrl, apiChange, apiChangeNoContent, apiGet } from "../src/api/client.js";
import { API, EDITOR, jsonResponse, mockFetch } from "./helpers.js";

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

const RECIPE: EditorRecipe = {
  id: "8d3f2a4e-1b2c-4d5e-8f90-1234567890ab",
  name: "Pad Thai",
  ingredients: ["noodles"],
  steps: ["Cook."],
  tags: [],
  hasPhoto: false,
  cookedAt: [],
  timesCooked: 0,
};

describe("API client: requests (docs/api.md, Conventions; docs/architecture.md, Sign-in)", () => {
  it("sends GET with the session cookie and no body or content type", async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, EDITOR));
    await expect(apiGet("/me", Me)).resolves.toEqual(EDITOR);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API}/me`);
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("include");
    expect(init?.body).toBeUndefined();
    expect(headersOf(init!)["content-type"]).toBeUndefined();
  });

  it("sends a change as JSON with the session cookie, and an empty {} body when there is no input", async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, RECIPE));
    await expect(apiChange("POST", `/recipes/${RECIPE.id}/cookings`, EditorRecipe)).resolves.toEqual(RECIPE);
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(headersOf(init)["content-type"]).toBe("application/json");
    expect(init.body).toBe("{}");
  });

  it("sends the given body as JSON", async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, RECIPE));
    await apiChange("POST", `/recipes/${RECIPE.id}/tags`, EditorRecipe, { tag: "quick" });
    expect(fetchMock.mock.calls[0]![1]!.body).toBe('{"tag":"quick"}');
  });

  it("sends a change answered with 204 as JSON too", async () => {
    const fetchMock = mockFetch(() => new Response(null, { status: 204 }));
    await expect(apiChangeNoContent("DELETE", `/recipes/${RECIPE.id}`)).resolves.toBeUndefined();
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe("DELETE");
    expect(init.credentials).toBe("include");
    expect(headersOf(init)["content-type"]).toBe("application/json");
    expect(init.body).toBe("{}");
  });

  it("rejects a response that doesn't match the shared schema, rather than passing it on", async () => {
    mockFetch(() => jsonResponse(200, { ...EDITOR, email: "someone@example.com" }));
    const result = apiGet("/me", Me);
    await expect(result).rejects.toThrow();
    await expect(result).rejects.not.toBeInstanceOf(ApiError);
  });
});

describe("API client: errors become ApiError (docs/api.md, Errors)", () => {
  it("carries the status and every ErrorResponse item", async () => {
    mockFetch(() =>
      jsonResponse(400, {
        errors: [
          { code: "recipe.nameRequired", field: "name", message: "Give the recipe a name." },
          { code: "recipe.stepsRequired", field: "steps", message: "Add at least one step." },
        ],
      }),
    );
    const error = await apiChange("POST", "/recipes", EditorRecipe, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.codes).toEqual(["recipe.nameRequired", "recipe.stepsRequired"]);
    expect(apiError.errors[0]).toEqual({ code: "recipe.nameRequired", field: "name", message: "Give the recipe a name." });
    expect(apiError.message).toBe("Give the recipe a name.");
  });

  it("is an ApiError with no codes when the error body isn't an ErrorResponse", async () => {
    mockFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    const error = await apiGet("/me", Me).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).codes).toEqual([]);
  });

  it("is an ApiError for 403 and 409 refusals", async () => {
    mockFetch(() => jsonResponse(403, { errors: [{ code: "auth.notEditor", message: "Only editors can do this." }] }));
    await expect(apiGet("/trash", Me)).rejects.toMatchObject({ status: 403, codes: ["auth.notEditor"] });
    mockFetch(() => jsonResponse(409, { errors: [{ code: "recipe.inTrash", message: "This recipe is in the trash." }] }));
    await expect(apiChange("PUT", `/recipes/${RECIPE.id}/content`, EditorRecipe, {})).rejects.toMatchObject({
      status: 409,
      codes: ["recipe.inTrash"],
    });
  });
});

describe("API client: address", () => {
  it("uses VITE_API_URL without a trailing slash", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.net/");
    const fetchMock = mockFetch(() => jsonResponse(200, EDITOR));
    await apiGet("/me", Me);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.net/me");
  });

  it("defaults to the local server in development and the production API otherwise", () => {
    vi.stubEnv("VITE_API_URL", "");
    expect(apiBaseUrl()).toBe("http://localhost:3000");
    vi.stubEnv("DEV", false);
    expect(apiBaseUrl()).toBe("https://api.recipes.mikevenable.net");
  });
});

describe("API client: development sign-in stub (docs/architecture.md, Sign-in)", () => {
  it("sends x-dev-identity on every request when VITE_DEV_IDENTITY is set in development", async () => {
    vi.stubEnv("VITE_DEV_IDENTITY", "google:1234");
    const fetchMock = mockFetch(() => jsonResponse(200, RECIPE));
    await apiGet(`/recipes/${RECIPE.id}`, EditorRecipe);
    await apiChange("POST", `/recipes/${RECIPE.id}/add-to-plan`, EditorRecipe);
    for (const [, init] of fetchMock.mock.calls) expect(headersOf(init!)["x-dev-identity"]).toBe("google:1234");
  });

  it("sends no identity header when VITE_DEV_IDENTITY isn't set", async () => {
    vi.stubEnv("VITE_DEV_IDENTITY", "");
    const fetchMock = mockFetch(() => jsonResponse(200, EDITOR));
    await apiGet("/me", Me);
    expect(headersOf(fetchMock.mock.calls[0]![1]!)).not.toHaveProperty("x-dev-identity");
  });

  it("never sends the identity header outside development, even if VITE_DEV_IDENTITY is set", async () => {
    vi.stubEnv("VITE_DEV_IDENTITY", "google:1234");
    vi.stubEnv("DEV", false);
    const fetchMock = mockFetch(() => jsonResponse(200, EDITOR));
    await apiGet("/me", Me);
    expect(headersOf(fetchMock.mock.calls[0]![1]!)).not.toHaveProperty("x-dev-identity");
  });
});
