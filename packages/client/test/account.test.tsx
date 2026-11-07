import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { API, APP, EDITOR, NON_EDITOR, VISITOR, jsonResponse, mockApiAs, mockFetch, renderAt } from "./helpers.js";

function detail(term: string): HTMLElement {
  const dt = screen.getByText(term, { selector: "dt" });
  return dt.nextElementSibling as HTMLElement;
}

describe("X-11 Account page, signed out", () => {
  it("offers Microsoft sign-in, returning to the Account page", async () => {
    mockApiAs(VISITOR);
    renderAt("/account");
    const returnTo = encodeURIComponent(`${APP}/account`);
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toHaveAttribute(
      "href",
      `${API}/.auth/login/aad?post_login_redirect_uri=${returnTo}`,
    );
    expect(screen.queryByRole("link", { name: "Sign out" })).not.toBeInTheDocument();
    expect(screen.queryByText("Account ID")).not.toBeInTheDocument();
  });

  it("ignores a return address that isn't a page of this app", async () => {
    mockApiAs(VISITOR);
    renderAt("/account", { from: "//evil.example/steal" });
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toHaveAttribute(
      "href",
      `${API}/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(`${APP}/account`)}`,
    );
  });

  // A browser's URL parser drops tabs and newlines, so "/\t/evil.example" would become "//evil.example", another site.
  it.each(["/\t/evil.example/x", "/\n/evil.example/x", "/\r/evil.example/x", "\t//evil.example/x", "/\\evil.example/x"])(
    "ignores a return address that becomes another site once parsed: %j",
    async (from) => {
      mockApiAs(VISITOR);
      renderAt("/account", { from });
      expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toHaveAttribute(
        "href",
        `${API}/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(`${APP}/account`)}`,
      );
    },
  );

  it("uses VITE_API_URL for the sign-in links", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.net");
    mockFetch((url) => (url === "https://api.example.net/me" ? jsonResponse(200, VISITOR) : jsonResponse(500, {})));
    renderAt("/account");
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toHaveAttribute(
      "href",
      `https://api.example.net/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(`${APP}/account`)}`,
    );
  });
});

describe("X-11 Account page, signed in as an editor", () => {
  it("shows the provider, the account ID, editor access and Sign out", async () => {
    mockApiAs(EDITOR);
    renderAt("/account");
    expect(await screen.findByText("Signed in with")).toBeInTheDocument();
    expect(detail("Signed in with")).toHaveTextContent("Google");
    expect(detail("Account ID")).toHaveTextContent("google:109876543210987654321");
    expect(detail("Access")).toHaveTextContent("Editor");
    expect(screen.queryByText(/send this ID/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign out" })).toHaveAttribute(
      "href",
      `${API}/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(`${APP}/`)}`,
    );
    expect(screen.queryByRole("link", { name: /Sign in with/ })).not.toBeInTheDocument();
  });

  it("copies the ID, as it goes in the editor list, to the clipboard", async () => {
    const user = userEvent.setup();
    mockApiAs(EDITOR);
    renderAt("/account");
    await user.click(await screen.findByRole("button", { name: "Copy" }));
    await expect(navigator.clipboard.readText()).resolves.toBe("google:109876543210987654321");
    // In the page: the layout has a live region of its own for messages such as Undo (REC-6).
    expect(within(screen.getByRole("main")).getByRole("status")).toHaveTextContent("Copied");
  });

  it("says so when the clipboard refuses", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    mockApiAs(EDITOR);
    renderAt("/account");
    await user.click(await screen.findByRole("button", { name: "Copy" }));
    expect(within(screen.getByRole("main")).getByRole("status")).toHaveTextContent("Couldn't copy");
  });
});

describe("X-11 Account page, signed in but not an editor", () => {
  it("shows the provider, the account ID, no editor access, and how to become an editor", async () => {
    mockApiAs(NON_EDITOR);
    renderAt("/account");
    expect(await screen.findByText("Signed in with")).toBeInTheDocument();
    expect(detail("Signed in with")).toHaveTextContent("Microsoft");
    expect(detail("Account ID")).toHaveTextContent(`aad:${NON_EDITOR.accountId}`);
    expect(detail("Access")).toHaveTextContent("Not an editor");
    expect(screen.getByText(/send this ID to the app's owner to be added to the editor list/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign out" })).toBeInTheDocument();
  });
});
