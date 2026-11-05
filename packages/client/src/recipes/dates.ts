// Stored times (ISO 8601, UTC, written by the server) shown in the device's time zone, and the device's own "today" (X-12).

/** The local calendar day of `date` in the device's time zone, as "2026-11-04", for comparing days. */
export function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Whether the stored time `iso` falls on the device's current local day `today` (a `localDayKey`). */
export function isOnLocalDay(iso: string, today: string): boolean {
  return localDayKey(new Date(iso)) === today;
}

/** Milliseconds from `now` until the next local midnight, which a daylight saving change can make shorter or longer than 24 h. */
export function msUntilNextLocalDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

// English, like the rest of the app's text; the time zone is the device's (X-12).
const SHORT_DATE = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const FULL_DATE = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

/** A cooking date in the history list: "Nov 4, 2026" (COOK-5). */
export function formatDate(iso: string): string {
  return FULL_DATE.format(new Date(iso));
}

/** The last-cooked date in the recipe's summary line (COOK-5): "today", "Aug 2" this year, "Aug 2, 2025" before. */
export function formatLastCooked(iso: string, today: string): string {
  const date = new Date(iso);
  if (localDayKey(date) === today) return "today";
  return localDayKey(date).slice(0, 4) === today.slice(0, 4) ? SHORT_DATE.format(date) : FULL_DATE.format(date);
}
