import { useEffect, useState } from "react";

/**
 * Keeps the screen on while `enabled`, with the Screen Wake Lock API (REC-18). Returns whether the lock is held, for the note
 * that says so.
 *
 * The browser releases the lock whenever the page is hidden (another tab or app, the screen locked), so it is requested again
 * each time the page becomes visible. It is released when `enabled` turns false or the component goes away. Browsers without
 * the API, or that refuse the request (e.g. battery saver), simply leave the screen to its normal timeout, without an error.
 */
export function useWakeLock(enabled: boolean): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator) || navigator.wakeLock === undefined) return;
    const wakeLock = navigator.wakeLock;
    let sentinel: WakeLockSentinel | undefined;
    let requesting = false;
    let stopped = false;

    async function acquire() {
      if (stopped || requesting || document.visibilityState !== "visible") return;
      if (sentinel !== undefined && !sentinel.released) return;
      requesting = true;
      try {
        const lock = await wakeLock.request("screen");
        if (stopped) {
          void lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
        lock.addEventListener("release", () => {
          if (sentinel !== lock) return;
          sentinel = undefined;
          setHeld(false);
        });
        setHeld(!lock.released);
      } catch {
        setHeld(false);
      } finally {
        requesting = false;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void acquire();
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const lock = sentinel;
      sentinel = undefined;
      setHeld(false);
      if (lock !== undefined && !lock.released) void lock.release().catch(() => {});
    };
  }, [enabled]);

  return held;
}
