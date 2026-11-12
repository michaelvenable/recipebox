// The REC-26 time clock as numbers: which laps a total time fills and how far. Drawing is TimeClock.tsx.

/** A lap's shade: 1 for the first hour, each later hour darker, 4 (darkest) from the fourth lap on (REC-26). */
export type ClockShade = 1 | 2 | 3 | 4;

export interface ClockFace {
  /** The shade of the last full lap, covering the whole face; absent under an hour. */
  readonly full?: ClockShade;
  /** The lap still filling, drawn on top: its share of the hour (0 < fraction < 1) and its shade. Absent on an exact hour. */
  readonly partial?: { readonly fraction: number; readonly shade: ClockShade };
}

function shadeOfLap(lap: number): ClockShade {
  return Math.min(lap, 4) as ClockShade;
}

/**
 * The clock for a total time in whole minutes (REC-26): one turn per hour, filling clockwise from 12. Only the top two laps
 * show, since each covers the ones below. An exact hour is a full lap, not an empty next one: 60 min is full in the first
 * shade, 120 min full in the second. No clock without a total time.
 */
export function clockFace(minutes: number | undefined): ClockFace | undefined {
  if (minutes === undefined || minutes <= 0) return undefined;
  const fullLaps = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return {
    ...(fullLaps > 0 ? { full: shadeOfLap(fullLaps) } : {}),
    ...(rest > 0 ? { partial: { fraction: rest / 60, shade: shadeOfLap(fullLaps + 1) } } : {}),
  };
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
