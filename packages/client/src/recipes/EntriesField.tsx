import { useId } from "react";
import { type EntryField, entryLines } from "./recipe-form.js";

const TITLES: Record<EntryField, string> = { ingredients: "Ingredients", prep: "Prep", steps: "Steps" };

/** Never shorter than this many rows, so there is room to type on a phone (X-3). */
const MIN_ROWS = 5;

interface EntriesFieldProps {
  field: EntryField;
  value: string;
  onChange: (value: string) => void;
  /** The messages for this list, each naming its line when it is about one entry (recipe-form.ts, formErrors). */
  errors: readonly string[] | undefined;
}

/**
 * Ingredients, prep or steps typed in one box, one entry per line (REC-21). Enter starts a new line, so a new entry. The box
 * grows with its text: by `field-sizing: content` (styles.css) where the browser has it, and by rows otherwise. The length of
 * each entry is the server's to check: a browser's maxlength counts UTF-16 units, not characters as a person sees them (X-13).
 */
export function EntriesField({ field, value, onChange, errors }: EntriesFieldProps) {
  const id = useId();
  const rows = Math.max(MIN_ROWS, entryLines(value).length + 1);
  return (
    <div className="field">
      <label htmlFor={`${id}-${field}`} className="field-title">
        {TITLES[field]}
      </label>
      <textarea
        id={`${id}-${field}`}
        className="text-input text-area entries-input"
        rows={rows}
        enterKeyHint="enter"
        value={value}
        aria-invalid={errors !== undefined || undefined}
        aria-describedby={errors !== undefined ? `${id}-${field}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {errors !== undefined && (
        <p id={`${id}-${field}-error`} className="field-error">
          {errors.join(" ")}
        </p>
      )}
    </div>
  );
}
