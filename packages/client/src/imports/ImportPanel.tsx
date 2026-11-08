import { useId, useState } from "react";
import { PHOTO_ACCEPT, photoProblem } from "../recipes/recipe-form.js";

interface ImportPanelProps {
  /** The photo is being uploaded: the button says so and can't be pressed again (IMP-4). */
  uploading: boolean;
  /** Why the last upload failed, already worded for the editor, or undefined. */
  error: string | undefined;
  /** A photo that passed the client's checks, to upload. */
  onPick: (file: File) => void;
}

function CameraIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

/**
 * "Have it on paper?" at the top of the New recipe form (IMP-1, docs/mockups/ImportNewRecipe.dc.html), then "or type it in".
 * One photo per upload (IMP-3): a single-file picker, with no `multiple`. It asks for the same types as the photo field and
 * refuses other files with the same messages, before anything is sent, so no import starts (IMP-2, REC-7).
 */
export function ImportPanel({ uploading, error, onPick }: ImportPanelProps) {
  const id = useId();
  const [pickProblem, setPickProblem] = useState<string>();
  const message = pickProblem ?? error;

  function pick(input: HTMLInputElement) {
    const file = input.files?.[0];
    // So that picking the same file again still counts.
    input.value = "";
    if (file === undefined) return;
    const problem = photoProblem(file);
    setPickProblem(problem);
    if (problem === undefined) onPick(file);
  }

  return (
    <>
      <section className="import-panel" aria-labelledby={`${id}-title`}>
        <div className="import-panel-head">
          <span className="import-panel-icon">
            <CameraIcon size={22} />
          </span>
          <h2 id={`${id}-title`}>Have it on paper?</h2>
        </div>
        <p>Upload a photo of the recipe to begin.</p>
        <label className="button import-button file-button" aria-disabled={uploading || undefined}>
          <CameraIcon size={20} />
          {uploading ? "Uploading photo…" : "Import from a photo"}
          <input
            className="visually-hidden"
            type="file"
            accept={PHOTO_ACCEPT}
            disabled={uploading}
            aria-describedby={message !== undefined ? `${id}-error` : undefined}
            onChange={(event) => pick(event.currentTarget)}
          />
        </label>
        {message !== undefined && (
          <p id={`${id}-error`} className="field-error" role="alert">
            {message}
          </p>
        )}
      </section>
      <div className="form-divider">or type it in</div>
    </>
  );
}
