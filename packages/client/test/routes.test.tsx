import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { API, APP, EDITOR, NON_EDITOR, VISITOR, jsonResponse, mockApi, mockApiAs, renderAt, requestedUrls } from "./helpers.js";

const ID = "8d3f2a4e-1b2c-4d5e-8f90-1234567890ab";

const EDITOR_ONLY: [path: string, heading: string][] = [
  ["/plan", "Plan"],
  ["/recommendations", "Recommendations"],
  ["/trash", "Trash"],
  ["/recipes/new", "New recipe"],
  [`/recipes/${ID}/edit`, "Edit recipe"],
];

describe("X-1, X-6 editor-only pages", () => {
  it.each(EDITOR_ONLY)("shows visitors a sign-in message at %s and calls nothing but /me", async (path) => {
    const fetchMock = mockApiAs(VISITOR);
    renderAt(path);
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in to see this" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in with Microsoft" })).toHaveAttribute(
      "href",
      `${API}/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(`${APP}${path}`)}`,
    );
    expect(requestedUrls(fetchMock)).toEqual([`${API}/me`]);
  });

  it.each(EDITOR_ONLY)("tells signed-in non-editors at %s that only editors can see it", async (path) => {
    const fetchMock = mockApiAs(NON_EDITOR);
    renderAt(path);
    expect(await screen.findByRole("heading", { level: 1, name: "Only editors can see this" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your Account page" })).toHaveAttribute("href", "/account");
    expect(requestedUrls(fetchMock)).toEqual([`${API}/me`]);
  });

  it.each(EDITOR_ONLY)("shows editors the page at %s", async (path, heading) => {
    mockApiAs(EDITOR);
    renderAt(path);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.queryByText("Sign in to see this")).not.toBeInTheDocument();
  });
});

describe("X-1 public pages", () => {
  it.each([
    ["/", "Recipe Box"],
    [`/recipes/${ID}`, "Toast"],
  ])("shows visitors %s", async (path, heading) => {
    mockApi(VISITOR, (url) => {
      if (url.pathname === "/recipes" || url.pathname === "/tags") return jsonResponse(200, []);
      if (url.pathname === `/recipes/${ID}`) {
        return jsonResponse(200, { id: ID, name: "Toast", ingredients: ["Bread"], steps: ["Toast it."], tags: [], hasPhoto: false });
      }
      return undefined;
    });
    renderAt(path);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });
});

describe("Routes: not found", () => {
  it("shows a not-found page with a way back to the recipes", async () => {
    mockApiAs(VISITOR);
    renderAt("/no/such/page");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the recipes" })).toHaveAttribute("href", "/");
  });
});
