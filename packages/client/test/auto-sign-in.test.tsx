import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_SIGN_IN_TRIED_KEY, REMEMBERED_PROVIDER_KEY, leavePage } from "../src/auth/auto-sign-in.js";
import { ME_QUERY_KEY } from "../src/auth/sign-in.js";
import { API, EDITOR, NON_EDITOR, VISITOR, afterSignIn, jsonResponse, mockApiAs, mockFetch, renderAt } from "./helpers.js";

let leave: ReturnType<typeof vi.fn<(url: string) => void>>;

beforeEach(() => {
  leave = vi.fn<(url: string) => void>();
  vi.spyOn(leavePage, "to").mockImplementation(leave);
});

/** Waits until GET /me has answered or failed, and the app has acted on the answer. */
async function meSettled(queryClient: QueryClient) {
  await waitFor(() => expect(queryClient.getQueryState(ME_QUERY_KEY)?.status).not.toBe("pending"));
  await act(async () => {});
}

function remember(provider: string) {
  localStorage.setItem(REMEMBERED_PROVIDER_KEY, provider);
}

describe("X-16 signing in again automatically", () => {
  it("goes once to the remembered provider's sign-in, returning to the same page, showing Loading meanwhile", async () => {
    remember("aad");
    mockApiAs(VISITOR);
    const { queryClient } = renderAt("/recipes/r1?from=list#notes");
    await meSettled(queryClient);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledWith(
      `${API}/.auth/login/aad?post_login_redirect_uri=${afterSignIn("/recipes/r1?from=list#notes")}`,
    );
    expect(sessionStorage.getItem(AUTO_SIGN_IN_TRIED_KEY)).not.toBeNull();
    // No flash of the visitor's page or its Sign in link while leaving.
    expect(within(screen.getByRole("main")).getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  });

  it("uses Google when that is the remembered provider and Google is offered (X-7)", async () => {
    vi.stubEnv("VITE_GOOGLE_SIGN_IN", "true");
    remember("google");
    mockApiAs(VISITOR);
    const { queryClient } = renderAt("/plan");
    await meSettled(queryClient);
    expect(leave).toHaveBeenCalledWith(`${API}/.auth/login/google?post_login_redirect_uri=${afterSignIn("/plan")}`);
  });

  // X-16: Back from the provider's page may restore the app from the back/forward cache rather than reload it.
  it("shows the visitor's page with Sign in after a pageshow persisted restore", async () => {
    localStorage.setItem(REMEMBERED_PROVIDER_KEY, "aad");
    mockApiAs(VISITOR);
    const { queryClient } = renderAt("/account");
    await meSettled(queryClient);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("main")).getByRole("status")).toHaveTextContent("Loading…");
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    });
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" }, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("doesn't try again in the same visit: back still signed out, the visitor's page shows", async () => {
    remember("aad");
    sessionStorage.setItem(AUTO_SIGN_IN_TRIED_KEY, "1");
    mockApiAs(VISITOR);
    renderAt("/account");
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toBeInTheDocument();
    expect(leave).not.toHaveBeenCalled();
  });

  it("doesn't try when no provider is remembered", async () => {
    mockApiAs(VISITOR);
    renderAt("/account");
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toBeInTheDocument();
    expect(leave).not.toHaveBeenCalled();
  });

  it("ignores a remembered value that isn't a provider, or a provider no longer offered", async () => {
    vi.stubEnv("VITE_GOOGLE_SIGN_IN", undefined);
    for (const value of ["evil", "google"]) {
      cleanup();
      remember(value);
      mockApiAs(VISITOR);
      const { queryClient } = renderAt("/account");
      await meSettled(queryClient);
      expect(leave).not.toHaveBeenCalled();
    }
  });

  it("doesn't try while the device is offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    remember("aad");
    mockApiAs(VISITOR);
    const { queryClient } = renderAt("/account");
    await meSettled(queryClient);
    expect(leave).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(AUTO_SIGN_IN_TRIED_KEY)).toBeNull();
  });

  it("doesn't try when the app can't tell whether the editor is signed in (/me failed)", async () => {
    remember("aad");
    mockFetch(() => jsonResponse(500, { errors: [] }));
    const { queryClient } = renderAt("/account");
    await meSettled(queryClient);
    expect(queryClient.getQueryState(ME_QUERY_KEY)?.status).toBe("error");
    expect(leave).not.toHaveBeenCalled();
  });

  it("doesn't try on a shopping list link, which anyone may open (PLAN-9)", async () => {
    remember("aad");
    mockApiAs(VISITOR);
    const { queryClient } = renderAt("/list/abc123");
    await meSettled(queryClient);
    expect(leave).not.toHaveBeenCalled();
  });

  it.each([
    ["an editor", EDITOR],
    ["a non-editor", NON_EDITOR],
  ])("doesn't try when signed in as %s", async (_who, me) => {
    remember("aad");
    mockApiAs(me);
    const { queryClient } = renderAt("/account");
    await meSettled(queryClient);
    expect(leave).not.toHaveBeenCalled();
  });

  it("doesn't send the editor away when the session ends later in the visit", async () => {
    remember("google");
    mockApiAs(EDITOR);
    const { queryClient } = renderAt("/account");
    await meSettled(queryClient);
    mockApiAs(VISITOR);
    await act(() => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }));
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toBeInTheDocument();
    expect(leave).not.toHaveBeenCalled();
  });
});

describe("X-16 remembering the provider", () => {
  it("forgets a remembered provider when /me says signed in as a non-editor, so the next load doesn't redirect", async () => {
    remember("aad");
    mockApiAs(NON_EDITOR);
    const { queryClient } = renderAt("/account");
    await meSettled(queryClient);
    await waitFor(() => expect(localStorage.getItem(REMEMBERED_PROVIDER_KEY)).toBeNull());

    // The next load, signed out (the non-editor's session ended).
    cleanup();
    sessionStorage.clear();
    mockApiAs(VISITOR);
    const next = renderAt("/account");
    await meSettled(next.queryClient);
    expect(leave).not.toHaveBeenCalled();
  });

  it("doesn't forget a remembered provider when /me says not signed in", async () => {
    remember("aad");
    sessionStorage.setItem(AUTO_SIGN_IN_TRIED_KEY, "1");
    mockApiAs(VISITOR);
    const { queryClient } = renderAt("/account");
    await meSettled(queryClient);
    expect(localStorage.getItem(REMEMBERED_PROVIDER_KEY)).toBe("aad");
  });

  it("remembers the provider once /me confirms an editor, and nothing else", async () => {
    mockApiAs(EDITOR);
    renderAt("/account");
    await waitFor(() => expect(localStorage.getItem(REMEMBERED_PROVIDER_KEY)).toBe("google"));
    expect(Object.keys(localStorage)).toEqual([REMEMBERED_PROVIDER_KEY]);
  });

  it.each([
    ["a visitor", VISITOR],
    ["a signed-in non-editor (X-6)", NON_EDITOR],
  ])("doesn't remember %s", async (_who, me) => {
    mockApiAs(me);
    const { queryClient } = renderAt("/account");
    await meSettled(queryClient);
    expect(localStorage.getItem(REMEMBERED_PROVIDER_KEY)).toBeNull();
  });

  it("signing out forgets the provider before leaving; signing in by hand remembers it again", async () => {
    const user = userEvent.setup();
    // jsdom can't follow the link to the sign-out address; the click handler still runs.
    const stopNavigation = (event: Event) => event.preventDefault();
    document.addEventListener("click", stopNavigation);
    try {
      mockApiAs(EDITOR);
      renderAt("/account");
      await waitFor(() => expect(localStorage.getItem(REMEMBERED_PROVIDER_KEY)).toBe("google"));
      await user.click(screen.getByRole("link", { name: "Sign out" }));
      expect(localStorage.getItem(REMEMBERED_PROVIDER_KEY)).toBeNull();
    } finally {
      document.removeEventListener("click", stopNavigation);
    }

    cleanup();
    // Back from signing out: nothing remembered, so no automatic sign-in.
    mockApiAs(VISITOR);
    const { queryClient } = renderAt("/");
    await meSettled(queryClient);
    expect(leave).not.toHaveBeenCalled();

    cleanup();
    // Signed in by hand, the app is loaded again and /me confirms an editor.
    mockApiAs(EDITOR);
    renderAt("/account");
    await waitFor(() => expect(localStorage.getItem(REMEMBERED_PROVIDER_KEY)).toBe("google"));
  });
});

describe("X-16 without storage", () => {
  it("works as before when storage throws: no automatic sign-in, nothing breaks", async () => {
    const fail = () => {
      throw new DOMException("denied", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(fail);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(fail);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(fail);

    mockApiAs(VISITOR);
    renderAt("/account");
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toBeInTheDocument();
    expect(leave).not.toHaveBeenCalled();
  });

  it("an editor's pages and Sign out still work when storage throws", async () => {
    const user = userEvent.setup();
    const fail = () => {
      throw new DOMException("denied", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(fail);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(fail);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(fail);
    const stopNavigation = (event: Event) => event.preventDefault();
    document.addEventListener("click", stopNavigation);
    try {
      mockApiAs(EDITOR);
      renderAt("/account");
      await user.click(await screen.findByRole("link", { name: "Sign out" }));
      expect(screen.getByText("Signed in with")).toBeInTheDocument();
    } finally {
      document.removeEventListener("click", stopNavigation);
    }
  });

  it("doesn't try when the once-per-visit flag can't be kept, so a failed sign-in can't loop", async () => {
    remember("aad");
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (this === sessionStorage) throw new DOMException("full", "QuotaExceededError");
      setItem.call(this, key, value);
    });
    mockApiAs(VISITOR);
    renderAt("/account");
    expect(await screen.findByRole("link", { name: "Sign in with Microsoft" })).toBeInTheDocument();
    expect(leave).not.toHaveBeenCalled();
  });
});
