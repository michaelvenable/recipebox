import { useEffect, useState } from "react";
import { localDayKey, msUntilNextLocalDay } from "./dates.js";

/**
 * The device's current local day (a `localDayKey`), kept up to date while the page is open: a timer fires at local midnight, and
 * the day is checked again whenever the page becomes visible, since timers are delayed or paused while a phone sleeps (COOK-8).
 */
export function useLocalDay(): string {
  const [day, setDay] = useState(() => localDayKey(new Date()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function check() {
      setDay(localDayKey(new Date()));
      clearTimeout(timer);
      // A timer that fires a little early finds the same day and simply waits for the rest.
      timer = setTimeout(check, msUntilNextLocalDay(new Date()));
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") check();
    }
    check();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return day;
}
