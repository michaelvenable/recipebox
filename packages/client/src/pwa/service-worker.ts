// The service worker (X-4, built from pwa.config.ts) and switching to a new version. A new version is never applied on its own:
// the app shows "A new version is available" with Reload (src/layout/notices.tsx), and only that button reloads the page, so an
// editor is never interrupted mid-edit. Reloading with unsaved changes still asks first (RecipeForm's beforeunload warning).
import { createContext, useContext, useSyncExternalStore } from "react";
import { Workbox } from "workbox-window";

/** The parts of workbox-window's Workbox used here, so tests can stand in for the browser's service worker. */
export interface WorkboxLike {
  addEventListener(type: "waiting" | "controlling", listener: (event: { isUpdate?: boolean }) => void): void;
  messageSkipWaiting(): void;
  update(): Promise<unknown>;
}

/** How often, at most, to ask the server for a new version when the app comes back to the screen. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

export class AppUpdates {
  private available = false;
  /** The new version is in control of this page (switched by this tab, or by Reload in another tab). */
  private activated = false;
  private reloadRequested = false;
  private readonly listeners = new Set<() => void>();
  private lastCheck: number;

  constructor(
    private readonly workbox: WorkboxLike,
    private readonly reload: () => void = () => window.location.reload(),
    private readonly now: () => number = Date.now,
  ) {
    this.lastCheck = now();
    workbox.addEventListener("waiting", () => this.setAvailable());
    workbox.addEventListener("controlling", (event) => {
      if (!event.isUpdate) return;
      this.activated = true;
      // Only the tab where Reload was pressed reloads. Other tabs keep running and keep offering Reload.
      if (this.reloadRequested) this.reload();
      else this.setAvailable();
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Whether a new version is waiting for the user to reload. */
  readonly isAvailable = (): boolean => this.available;

  /** The user pressed Reload: switch to the new version, then reload once it controls the page. */
  apply(): void {
    if (this.activated) {
      this.reload();
      return;
    }
    this.reloadRequested = true;
    this.workbox.messageSkipWaiting();
  }

  /**
   * Asks the server whether there is a new version, at most once per UPDATE_CHECK_MS. An installed app can stay open for days
   * without loading a page, which is otherwise when the browser checks.
   */
  checkForUpdate(): void {
    if (this.now() - this.lastCheck < UPDATE_CHECK_MS) return;
    this.lastCheck = this.now();
    this.workbox.update().catch(() => {
      // Offline or the server is unreachable: the next check will try again.
    });
  }

  private setAvailable() {
    if (this.available) return;
    this.available = true;
    for (const listener of this.listeners) listener();
  }
}

/**
 * Registers the service worker in a production build, in browsers that have them. Returns undefined otherwise, and then the app
 * simply never offers an update.
 */
export function registerServiceWorker({
  enabled = import.meta.env.PROD && "serviceWorker" in navigator,
  createWorkbox = () => new Workbox("/sw.js", { scope: "/" }),
}: {
  enabled?: boolean;
  /** Tests pass a stand-in. */
  createWorkbox?: () => WorkboxLike & { register(): Promise<unknown> };
} = {}): AppUpdates | undefined {
  if (!enabled) return undefined;
  const workbox = createWorkbox();
  const updates = new AppUpdates(workbox);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") updates.checkForUpdate();
  });
  workbox.register().catch((error: unknown) => {
    // The app works without it, only not offline-capable or installable; nothing to tell the user.
    console.warn("Service worker registration failed", error);
  });
  return updates;
}

export const AppUpdatesContext = createContext<AppUpdates | undefined>(undefined);

const NEVER = () => () => {};
const NO = () => false;

/** Whether a new version is waiting, and the updates to apply it with. */
export function useAppUpdate(): { available: boolean; updates: AppUpdates | undefined } {
  const updates = useContext(AppUpdatesContext);
  const available = useSyncExternalStore(updates?.subscribe ?? NEVER, updates?.isAvailable ?? NO);
  return { available, updates };
}
