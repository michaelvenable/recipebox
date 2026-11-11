import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { API, afterSignIn, EDITOR, NON_EDITOR, VISITOR, jsonResponse, mockApiAs, mockFetch, renderAt } from "./helpers.js";

async function mainNav(): Promise<HTMLElement> {
  const nav = screen.getByRole("navigation", { name: "Main" });
  // The row fills in once GET /me has answered.
  await within(nav).findByRole("link", { name: /Sign in|Account/ });
  return nav;
}

function linkNames(nav: HTMLElement): string[] {
  return within(nav)
    .getAllByRole("link")
    .map((link) => link.getAttribute("aria-label") ?? link.textContent ?? "");
}

describe("X-8 navigation row", () => {
  it("shows visitors Catalog and Sign in, and no editor pages", async () => {
    mockApiAs(VISITOR);
    renderAt("/");
    expect(linkNames(await mainNav())).toEqual(["Catalog", "Sign in"]);
  });

  it("shows editors Catalog, Plan, Recommendations, Trash and an Account button", async () => {
    mockApiAs(EDITOR);
    renderAt("/");
    const nav = await mainNav();
    expect(linkNames(nav)).toEqual(["Catalog", "Plan", "Recommendations", "Trash", "Account"]);
    expect(within(nav).getByRole("link", { name: "Plan" })).toHaveAttribute("href", "/plan");
    expect(within(nav).getByRole("link", { name: "Recommendations" })).toHaveAttribute("href", "/recommendations");
    expect(within(nav).getByRole("link", { name: "Trash" })).toHaveAttribute("href", "/trash");
    expect(within(nav).getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  });

  it("shows signed-in non-editors Catalog and the Account button, with no editor pages and no Sign in", async () => {
    mockApiAs(NON_EDITOR);
    renderAt("/");
    expect(linkNames(await mainNav())).toEqual(["Catalog", "Account"]);
  });

  it("treats the person as a visitor if /me can't be loaded", async () => {
    mockFetch(() => jsonResponse(503, { errors: [] }));
    renderAt("/");
    expect(linkNames(await mainNav())).toEqual(["Catalog", "Sign in"]);
  });
});

describe("X-8 current page", () => {
  it.each([
    ["/", "Catalog"],
    ["/recipes/8d3f2a4e-1b2c-4d5e-8f90-1234567890ab", "Catalog"],
    ["/recipes/new", "Catalog"],
    ["/plan", "Plan"],
    ["/recommendations", "Recommendations"],
    ["/trash", "Trash"],
    ["/account", "Account"],
  ])("marks only the current item at %s with aria-current=page", async (path, current) => {
    mockApiAs(EDITOR);
    renderAt(path);
    const nav = await mainNav();
    const marked = within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
      .map((link) => link.getAttribute("aria-label") ?? link.textContent);
    expect(marked).toEqual([current]);
  });

  it("marks nothing on a page that isn't in the row", async () => {
    mockApiAs(EDITOR);
    renderAt("/no-such-page");
    const nav = await mainNav();
    expect(within(nav).getAllByRole("link").filter((l) => l.hasAttribute("aria-current"))).toEqual([]);
  });

  it("marks Sign in as current on the Account page for visitors", async () => {
    mockApiAs(VISITOR);
    renderAt("/account");
    const nav = await mainNav();
    expect(within(nav).getByRole("link", { name: "Sign in" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Catalog" })).not.toHaveAttribute("aria-current");
  });

  it("follows navigation", async () => {
    mockApiAs(EDITOR);
    renderAt("/");
    const nav = await mainNav();
    await userEvent.click(within(nav).getByRole("link", { name: "Trash" }));
    expect(within(nav).getByRole("link", { name: "Trash" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Catalog" })).not.toHaveAttribute("aria-current");
  });
});

describe("X-8 Sign in returns to the page the visitor was on", () => {
  it("takes the visitor to sign-in buttons that return to that page afterwards", async () => {
    mockApiAs(VISITOR);
    renderAt("/recipes/8d3f2a4e-1b2c-4d5e-8f90-1234567890ab");
    await userEvent.click(within(await mainNav()).getByRole("link", { name: "Sign in" }));

    const returnTo = afterSignIn("/recipes/8d3f2a4e-1b2c-4d5e-8f90-1234567890ab");
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toHaveAttribute(
      "href",
      `${API}/.auth/login/aad?post_login_redirect_uri=${returnTo}`,
    );
  });

  it("keeps the query string of the page", async () => {
    mockApiAs(VISITOR);
    renderAt("/?tags=dinner");
    await userEvent.click(within(await mainNav()).getByRole("link", { name: "Sign in" }));
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toHaveAttribute(
      "href",
      `${API}/.auth/login/aad?post_login_redirect_uri=${afterSignIn("/?tags=dinner")}`,
    );
  });
});
