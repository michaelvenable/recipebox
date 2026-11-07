import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { API, APP, EDITOR, VISITOR, mockApiAs, renderAt } from "./helpers.js";

// Every place the client offers sign-in: the Account page and the editor-only pages' message (X-8).
const SIGN_IN_PAGES = ["/account", "/plan"];

describe("X-7 sign-in providers: Microsoft only unless the client is built with Google", () => {
  it.each(SIGN_IN_PAGES)("offers only Microsoft at %s when VITE_GOOGLE_SIGN_IN isn't set", async (path) => {
    vi.stubEnv("VITE_GOOGLE_SIGN_IN", undefined);
    mockApiAs(VISITOR);
    renderAt(path);
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toHaveAttribute(
      "href",
      `${API}/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(`${APP}${path}`)}`,
    );
    expect(screen.queryByRole("link", { name: "Sign in with Google" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^Sign in with / })).toHaveLength(1);
  });

  it.each(["", "false", "1", "TRUE", "yes"])("offers only Microsoft when VITE_GOOGLE_SIGN_IN is %j", async (value) => {
    vi.stubEnv("VITE_GOOGLE_SIGN_IN", value);
    mockApiAs(VISITOR);
    renderAt("/account");
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it.each(SIGN_IN_PAGES)("offers Microsoft and Google at %s when VITE_GOOGLE_SIGN_IN is true", async (path) => {
    vi.stubEnv("VITE_GOOGLE_SIGN_IN", "true");
    mockApiAs(VISITOR);
    renderAt(path);
    const returnTo = encodeURIComponent(`${APP}${path}`);
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toHaveAttribute(
      "href",
      `${API}/.auth/login/aad?post_login_redirect_uri=${returnTo}`,
    );
    expect(screen.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute(
      "href",
      `${API}/.auth/login/google?post_login_redirect_uri=${returnTo}`,
    );
  });
});

describe("X-11 Account page for a Google identity while Google isn't offered", () => {
  // The server still recognizes `google:` identities (docs/architecture.md, "Sign-in"), so the page must still name them.
  it("shows Google as the provider and the google: ID", async () => {
    vi.stubEnv("VITE_GOOGLE_SIGN_IN", undefined);
    mockApiAs(EDITOR);
    renderAt("/account");
    expect(await screen.findByText("Signed in with")).toBeInTheDocument();
    expect(screen.getByText("Signed in with", { selector: "dt" }).nextElementSibling).toHaveTextContent("Google");
    expect(screen.getByText(`google:${EDITOR.accountId}`)).toBeInTheDocument();
  });
});
