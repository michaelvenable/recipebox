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

/**
 * A recent date in a summary line, such as when a recipe was last cooked (COOK-5) or deleted (REC-14): "today", "Aug 2" this
 * year, "Aug 2, 2025" before.
 */
export function formatRecentDay(iso: string, today: string): string {
  const date = new Date(iso);
  if (localDayKey(date) === today) return "today";
  return localDayKey(date).slice(0, 4) === today.slice(0, 4) ? SHORT_DATE.format(date) : FULL_DATE.format(date);
}

const DAY_MS = 86_400_000;

/** Whole local calendar days from `from` to `to`; a daylight saving day of 23 or 25 hours still counts as one. */
function localDaysBetween(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

/**
 * Whole calendar months from `from` to `to`, in local time. A month is complete on the same day of the month, or on the last
 * day of a shorter month: Jan 31 to Feb 28 is one month, and so is Aug 2 to Sep 2.
 */
function localMonthsBetween(from: Date, to: Date): number {
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  const lastDayOfMonth = new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate();
  return to.getDate() < Math.min(from.getDate(), lastDayOfMonth) ? months - 1 : months;
}

/**
 * How long ago a recipe was last cooked, for "Haven't made in a while" (COOK-6), counted on the device in its time zone (X-12):
 * "New" if it was never cooked; "today" and "yesterday" by local calendar day; "N days ago" until a whole calendar month has
 * passed; then whole months ("1 month ago", "11 months ago"); then whole years. Each unit is rounded down, so "3 months ago"
 * means at least three months. A cooking time ahead of the device's clock reads "today".
 */
export function cookedAgo(lastCookedAt: string | undefined, now: Date): string {
  if (lastCookedAt === undefined) return "New";
  const cooked = new Date(lastCookedAt);
  const days = localDaysBetween(cooked, now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  const months = localMonthsBetween(cooked, now);
  if (months < 1) return `${days} days ago`;
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

/** The trash period, for the label only (docs/mockups/Trash.dc.html); the deadline itself is the server's `removalDueAt`. */
const TRASH_DAYS = 30;

/**
 * How long a trashed recipe can still be restored, for the trash (REC-14), from the server's times (REC-16) and the device's
 * clock (X-12). Counted as 30 minus the local calendar days since the day it was deleted, so the label changes at local
 * midnight: a recipe deleted on Oct 1 shows "10 days left" all through Oct 21, whatever the time of day, and a daylight saving
 * change between the deletion and its 720-hour deadline can't make it 29 or 31. Between 1 and 30 while more than a day is
 * left, even if the device's clock disagrees with the server's. In the last 24 hours before `removalDueAt`, "less than a day
 * left", and from then on "removed soon": never a negative count. The server alone decides whether a restore is still allowed.
 */
export function trashTimeLeft({ deletedAt, removalDueAt }: { deletedAt: string; removalDueAt: string }, now: Date): string {
  const remaining = new Date(removalDueAt).getTime() - now.getTime();
  if (remaining <= 0) return "removed soon";
  if (remaining < DAY_MS) return "less than a day left";
  const days = Math.min(TRASH_DAYS, Math.max(1, TRASH_DAYS - localDaysBetween(new Date(deletedAt), now)));
  return days === 1 ? "1 day left" : `${days} days left`;
}
