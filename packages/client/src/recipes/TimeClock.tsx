import { clockFace, pieSlicePath } from "./time-clock.js";

const C = 12;
const R = 10;

/**
 * The time clock (REC-26): a small face filled like a pie, one turn per hour, each later hour a darker shade (styles.css,
 * --clock-lap-1 to 4). A picture only, hidden from screen readers: whoever shows it also shows or reads the time in words.
 * Nothing without a total time.
 */
export function TimeClock({ minutes, size }: { minutes: number | undefined; size: number }) {
  const face = clockFace(minutes);
  if (face === undefined) return null;
  return (
    <svg className="time-clock" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle className="time-clock-face" cx={C} cy={C} r={R} />
      {face.full !== undefined && <circle className={`time-clock-lap-${face.full}`} cx={C} cy={C} r={R} />}
      {face.partial !== undefined && (
        <path className={`time-clock-lap-${face.partial.shade}`} d={pieSlicePath(C, C, R, face.partial.fraction)} />
      )}
      {/* The rim goes on top so the face reads as a clock whatever is filled. */}
      <circle className="time-clock-rim" cx={C} cy={C} r={R} />
    </svg>
  );
}
