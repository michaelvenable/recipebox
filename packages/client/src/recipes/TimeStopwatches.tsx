import { pieSlicePath, stopwatches } from "./time-stopwatches.js";

const CX = 12;
const CY = 14;
const R = 7.5;

/** Quarter-hour marks as [x1, y1, x2, y2] at 12, 3, 6 and 9 o'clock, from radius `outer` in to `inner`. */
function quarterMarks(outer: number, inner: number): [number, number, number, number][] {
  return [
    [CX, CY - outer, CX, CY - inner],
    [CX + outer, CY, CX + inner, CY],
    [CX, CY + outer, CX, CY + inner],
    [CX - outer, CY, CX - inner, CY],
  ];
}

// REC-26: a partly filled stopwatch has the usual dark marks; a full one short, light marks that show on the fill.
const DARK_MARKS = quarterMarks(6.4, 4.8);
const LIGHT_MARKS = quarterMarks(6.1, 5.3);

/** One stopwatch, filled clockwise from 12 by `fraction` of its hour (1 for full). */
function Stopwatch({ fraction, size }: { fraction: number; size: number }) {
  const full = fraction >= 1;
  return (
    <svg className="stopwatch" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect className="stopwatch-case" x={10} y={1.6} width={4} height={2.4} rx={0.8} />
      <rect className="stopwatch-case" x={11.2} y={3.6} width={1.6} height={2} />
      <rect className="stopwatch-case" x={18.2} y={5.2} width={2.6} height={1.8} rx={0.6} transform="rotate(45 19.5 6.1)" />
      <circle className="stopwatch-face" cx={CX} cy={CY} r={R} />
      {full ? (
        <circle className="stopwatch-fill" cx={CX} cy={CY} r={R} />
      ) : (
        <path className="stopwatch-fill" d={pieSlicePath(CX, CY, R, fraction)} />
      )}
      {(full ? LIGHT_MARKS : DARK_MARKS).map(([x1, y1, x2, y2]) => (
        <line key={`${x1} ${y1}`} className={full ? "stopwatch-mark-light" : "stopwatch-mark"} x1={x1} y1={y1} x2={x2} y2={y2} />
      ))}
      <circle className="stopwatch-rim" cx={CX} cy={CY} r={8.4} />
    </svg>
  );
}

/**
 * The time stopwatches (REC-26): one per hour, full ones then one partly filled, all in the accent color (styles.css). Over
 * 4 h a single full one, with the started hours beside it ("×8") where `showMore` is set (recipe cards). A picture only,
 * hidden from screen readers: whoever shows it also shows or reads the time in words. Nothing without a total time.
 */
export function TimeStopwatches({ minutes, size, showMore = false }: { minutes: number | undefined; size: number; showMore?: boolean }) {
  const shown = stopwatches(minutes);
  if (shown === undefined) return null;
  const fractions = [...Array<number>(shown.full).fill(1), ...(shown.partial !== undefined ? [shown.partial] : [])];
  return (
    <span className="time-stopwatches" aria-hidden="true">
      {fractions.map((fraction, i) => (
        <Stopwatch key={i} fraction={fraction} size={size} />
      ))}
      {showMore && shown.more !== undefined && <span className="time-stopwatches-more">×{shown.more}</span>}
    </span>
  );
}
