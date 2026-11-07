import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { API, EDITOR, NON_EDITOR, VISITOR, mockApiAs, renderAt, requestedUrls } from "./helpers.js";

async function privacyPage(): Promise<HTMLElement> {
  await screen.findByRole("heading", { level: 1, name: "Privacy" });
  return screen.getByRole("main");
}

/** The nav's links once GET /me has answered: visitors get Sign in, signed-in people the Account button. */
async function navLinks(): Promise<string[]> {
  const nav = screen.getByRole("navigation", { name: "Main" });
  await within(nav).findByRole("link", { name: /Sign in|Account/ });
  return within(nav)
    .getAllByRole("link")
    .map((link) => link.getAttribute("aria-label") ?? link.textContent ?? "");
}

describe("X-15 privacy page", () => {
  it("is open to a visitor, with the visitor's nav, and asks the API for nothing but /me", async () => {
    const fetchMock = mockApiAs(VISITOR);
    renderAt("/privacy");
    await privacyPage();
    expect(screen.queryByText("Sign in to see this")).not.toBeInTheDocument();
    expect(await navLinks()).toEqual(["Catalog", "Sign in"]);
    expect(requestedUrls(fetchMock)).toEqual([`${API}/me`]);
  });

  it.each([
    ["an editor", EDITOR, ["Catalog", "Plan", "Recommendations", "Trash", "Account"]],
    ["a signed-in non-editor", NON_EDITOR, ["Catalog", "Account"]],
  ])("is open to %s", async (_who, me, links) => {
    mockApiAs(me);
    renderAt("/privacy");
    await privacyPage();
    expect(await navLinks()).toEqual(links);
  });

  it("says in plain words what is stored and who can see it", async () => {
    mockApiAs(VISITOR);
    renderAt("/privacy");
    const text = (await privacyPage()).textContent ?? "";
    // X-1: recipes and photos are public.
    expect(text).toMatch(/Recipes and their photos are public/);
    // X-1, PLAN-9: the private lists, and the shopping list link exception.
    expect(text).toMatch(/"to make" list, cooking history and trash can be seen only by the household's editors/);
    expect(text).toMatch(/shopping list an editor sends: for 7 days, anyone with its link can see/);
    // X-7: Microsoft or Google; only the provider and permanent account ID; no name or email.
    expect(text).toMatch(/Microsoft or Google account/);
    expect(text).toMatch(/permanent account ID/);
    expect(text).toMatch(/doesn't keep your name or email address/);
    // X-9: cookies only for staying signed in.
    expect(text).toMatch(/The only cookies are the ones signing in sets, to keep you signed in/);
    // Server logs: network address, used only to run the app, and how long they are kept (infra/main.bicep).
    expect(text).toMatch(/network address it came from/);
    expect(text).toMatch(/used only to keep the app running, and are kept for 30 days/);
    expect(text).toMatch(/Nothing is sold or shared with anyone else/);
    expect(text).toMatch(/Ask the household member who shared the app with you/);
  });

  it("shows no email address or other personal contact details", async () => {
    mockApiAs(EDITOR);
    renderAt("/privacy");
    const page = await privacyPage();
    expect(page.textContent ?? "").not.toMatch(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    expect(page.textContent ?? "").not.toMatch(/\+?\d[\d\s().-]{7,}\d/);
    for (const link of within(page).queryAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/^(mailto|tel):/i);
    }
  });

  it.each([
    ["signed out", VISITOR],
    ["signed in as an editor", EDITOR],
    ["signed in, not an editor", NON_EDITOR],
  ])("is linked from the Account page %s", async (_who, me) => {
    mockApiAs(me);
    renderAt("/account");
    // Wait for the answer from /me, so the link is checked in the signed-in or signed-out page, not while loading.
    await screen.findByRole("link", { name: /Sign in with Microsoft|Sign out/ });
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  });
});
