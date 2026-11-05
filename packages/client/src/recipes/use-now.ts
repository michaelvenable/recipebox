import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/**
 * The device's current time, updated every minute while the page is open, and again whenever the page becomes visible, since
 * timers are delayed or paused while a phone sleeps. For labels counted from now, such as days left in the trash (REC-14, X-12).
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function tick() {
      setNow(new Date());
      clearTimeout(timer);
      timer = setTimeout(tick, MINUTE_MS);
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") tick();
    }
    timer = setTimeout(tick, MINUTE_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return now;
}
