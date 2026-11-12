// The REC-26 time stopwatches as numbers: how many full ones, how far the last is filled. Drawing is TimeStopwatches.tsx.

/** Above this many minutes (4 h) a single full stopwatch stands in for all of them (REC-26). */
const MOST_MINUTES_DRAWN = 240;

export interface Stopwatches {
  /** Full stopwatches, one per whole hour. */
  readonly full: number;
  /** The last stopwatch's share of its hour (0 < partial < 1); absent on an exact hour. */
  readonly partial?: number;
  /** Over 4 h: the number of started hours, shown beside the single full stopwatch on recipe cards ("×8"). */
  readonly more?: number;
}

/**
 * The stopwatches for a total time in whole minutes (REC-26): one full stopwatch per whole hour, then one partly filled for
 * the rest. An exact hour is a full stopwatch, not an empty extra one. Over 4 h, a single full stopwatch and the number of
 * started hours. None without a total time.
 */
export function stopwatches(minutes: number | undefined): Stopwatches | undefined {
  if (minutes === undefined || minutes <= 0) return undefined;
  if (minutes > MOST_MINUTES_DRAWN) return { full: 1, more: Math.ceil(minutes / 60) };
  const rest = minutes % 60;
  return { full: Math.floor(minutes / 60), ...(rest > 0 ? { partial: rest / 60 } : {}) };
}

/**
 * An SVG path for a pie slice of a circle at (cx, cy) with radius r, from 12 o'clock clockwise through `fraction` of a turn
 * (0 < fraction < 1). Coordinates are rounded to keep the markup short.
 */
export function pieSlicePath(cx: number, cy: number, r: number, fraction: number): string {
  const angle = fraction * 2 * Math.PI;
  const x = round(cx + r * Math.sin(angle));
  const y = round(cy - r * Math.cos(angle));
  const largeArc = fraction > 0.5 ? 1 : 0;
  return `M${cx} ${cy}V${cy - r}A${r} ${r} 0 ${largeArc} 1 ${x} ${y}Z`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
