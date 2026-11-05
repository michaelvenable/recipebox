import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  AppUpdates,
  AppUpdatesContext,
  UPDATE_CHECK_MS,
  type WorkboxLike,
  registerServiceWorker,
} from "../src/pwa/service-worker.js";
import { routes } from "../src/routes.js";
import { VISITOR, mockApiAs, renderAt } from "./helpers.js";

type Listener = (event: { isUpdate?: boolean }) => void;

/** Stands in for workbox-window: the test fires its events as the browser's service worker would. */
class FakeWorkbox implements WorkboxLike {
  private readonly listeners = new Map<string, Listener[]>();
  readonly messageSkipWaiting = vi.fn();
  readonly update = vi.fn(async () => {});

  addEventListener(type: "waiting" | "controlling", listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  fire(type: "waiting" | "controlling", event: { isUpdate?: boolean } = {}) {
    act(() => {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    });
  }
}

function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
  act(() => {
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  });
}

function renderWithUpdates(updates: AppUpdates) {
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <AppUpdatesContext value={updates}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppUpdatesContext>,
  );
}

const UPDATE_TEXT = "A new version is available";

describe("X-4 offline banner", () => {
  it("says the app is offline while the browser has no connection, and goes when it is back", () => {
    mockApiAs(VISITOR);
    renderAt("/");
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();

    setOnline(false);
    // Changes fail at once offline (mutations use networkMode "always"), so it must not promise to save later.
    const banner = screen.getByText("You're offline. RecipeBox needs a connection to load and save recipes.");
    expect(banner.closest('[role="status"]')).not.toBeNull();

    setOnline(true);
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
  });

  it("shows when the app opens without a connection", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mockApiAs(VISITOR);
    renderAt("/");
    expect(screen.getByText(/You're offline/)).toBeInTheDocument();
  });
});

describe("X-4 new version", () => {
  it("offers Reload once a new version is waiting, and reloads only after it takes over", async () => {
    mockApiAs(VISITOR);
    const workbox = new FakeWorkbox();
    const reload = vi.fn();
    renderWithUpdates(new AppUpdates(workbox, reload));
    expect(screen.queryByText(UPDATE_TEXT)).not.toBeInTheDocument();

    workbox.fire("waiting");
    const notice = screen.getByText(UPDATE_TEXT).closest(".notice") as HTMLElement;
    expect(notice.closest('[role="status"]')).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();

    await userEvent.click(within(notice).getByRole("button", { name: "Reload" }));
    expect(workbox.messageSkipWaiting).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();

    workbox.fire("controlling", { isUpdate: true });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("never reloads on its own, even when another tab switches to the new version", async () => {
    mockApiAs(VISITOR);
    const workbox = new FakeWorkbox();
    const reload = vi.fn();
    renderWithUpdates(new AppUpdates(workbox, reload));

    workbox.fire("waiting");
    workbox.fire("controlling", { isUpdate: true });
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(UPDATE_TEXT)).toBeInTheDocument();

    // The new version already controls the page, so Reload just reloads.
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(workbox.messageSkipWaiting).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("stays until Reload is pressed, unlike the timed messages (REC-6)", () => {
    mockApiAs(VISITOR);
    const workbox = new FakeWorkbox();
    renderWithUpdates(new AppUpdates(workbox, vi.fn()));
    workbox.fire("waiting");
    vi.useFakeTimers();
    try {
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByText(UPDATE_TEXT)).toBeInTheDocument();
  });

  it("ignores the first service worker taking control: there is nothing to reload for", () => {
    const workbox = new FakeWorkbox();
    const reload = vi.fn();
    const updates = new AppUpdates(workbox, reload);
    workbox.fire("controlling", { isUpdate: false });
    expect(updates.isAvailable()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("asks the server for a new version when the app comes back, at most once an hour", () => {
    const workbox = new FakeWorkbox();
    let now = 0;
    const updates = new AppUpdates(workbox, vi.fn(), () => now);
    updates.checkForUpdate();
    expect(workbox.update).not.toHaveBeenCalled();
    now = UPDATE_CHECK_MS;
    updates.checkForUpdate();
    updates.checkForUpdate();
    expect(workbox.update).toHaveBeenCalledOnce();
  });

  it("checks for a new version when the app comes back to the screen, once registered", () => {
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    try {
      const workbox = new FakeWorkbox();
      const register = vi.fn(async () => undefined);
      const updates = registerServiceWorker({ enabled: true, createWorkbox: () => Object.assign(workbox, { register }) });
      expect(updates).toBeInstanceOf(AppUpdates);
      expect(register).toHaveBeenCalledOnce();

      let visibility: DocumentVisibilityState = "hidden";
      vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
      vi.setSystemTime(UPDATE_CHECK_MS);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(workbox.update).not.toHaveBeenCalled();

      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(workbox.update).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("registers nothing in development or without service workers", () => {
    const createWorkbox = vi.fn();
    expect(registerServiceWorker({ enabled: false, createWorkbox })).toBeUndefined();
    expect(createWorkbox).not.toHaveBeenCalled();
  });

  it("offers nothing without a service worker", () => {
    mockApiAs(VISITOR);
    renderAt("/");
    expect(screen.queryByText(UPDATE_TEXT)).not.toBeInTheDocument();
  });
});
