import { useEffect, useId, useState } from "react";
import { photoUrl } from "../api/recipes.js";
import { usePhotoVersion } from "./photo-version.js";
import { PHOTO_ACCEPT, photoProblem } from "./recipe-form.js";

/** What Save does with the photo: nothing, upload a picked file, or remove the saved photo (REC-7). */
export type PhotoChange = { kind: "keep" } | { kind: "new"; file: File } | { kind: "remove" };

export const KEEP_PHOTO: PhotoChange = { kind: "keep" };

interface PhotoFieldProps {
  /** The saved recipe, if there is one yet, and whether it has a photo. */
  recipeId: string | undefined;
  hasPhoto: boolean;
  change: PhotoChange;
  onChange: (change: PhotoChange) => void;
  /** Why the last upload or removal failed, from the server, or undefined. */
  error: readonly string[] | undefined;
}

/** A temporary address for previewing a picked file, released when the file changes or the field goes. */
export function useObjectUrl(file: File | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (file === undefined) {
      setUrl(undefined);
      return;
    }
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);
  return url;
}

/**
 * Picking, previewing and removing the photo (REC-7). Nothing is sent until Save; Cancel leaves the saved photo as it was. The
 * picker asks only for JPEG, PNG and WebP, so an iPhone converts a HEIC photo from its library to JPEG (docs/architecture.md,
 * "Photos"); a file that is obviously not one of them, or over 15 MB, is refused here before uploading it for nothing.
 */
export function PhotoField({ recipeId, hasPhoto, change, onChange, error }: PhotoFieldProps) {
  const id = useId();
  const [pickProblem, setPickProblem] = useState<string>();
  const preview = useObjectUrl(change.kind === "new" ? change.file : undefined);
  const version = usePhotoVersion(recipeId ?? "");
  const saved = change.kind === "keep" && hasPhoto && recipeId !== undefined ? photoUrl(recipeId, version) : undefined;
  const shown = change.kind === "new" ? preview : saved;
  const showsPhoto = change.kind === "new" || saved !== undefined;
  const messages = pickProblem !== undefined ? [pickProblem] : error;

  function pick(input: HTMLInputElement) {
    const file = input.files?.[0];
    // So that picking the same file again, say after fixing it, still counts as a change.
    input.value = "";
    if (file === undefined) return;
    const problem = photoProblem(file);
    setPickProblem(problem);
    if (problem === undefined) onChange({ kind: "new", file });
  }

  function remove() {
    setPickProblem(undefined);
    onChange(hasPhoto ? { kind: "remove" } : KEEP_PHOTO);
  }

  return (
    <div className="field" role="group" aria-labelledby={`${id}-title`} aria-describedby={messages !== undefined ? `${id}-error` : undefined}>
      <span id={`${id}-title`} className="field-title">
        Photo
      </span>
      <div className="photo-field">
        {showsPhoto &&
          (shown === undefined ? (
            <span className="photo-preview" />
          ) : (
            <img className="photo-preview" src={shown} alt={change.kind === "new" ? "New photo" : "Current photo"} />
          ))}
        <label className="button button-small file-button">
          {showsPhoto ? "Replace photo" : "Add photo"}
          <input className="visually-hidden" type="file" accept={PHOTO_ACCEPT} onChange={(event) => pick(event.currentTarget)} />
        </label>
        {showsPhoto && (
          <button type="button" className="button button-small button-danger" onClick={remove}>
            Remove photo
          </button>
        )}
      </div>
      {change.kind === "remove" && (
        <p className="field-hint">
          The photo will be removed when you save.{" "}
          <button type="button" className="link-button" onClick={() => onChange(KEEP_PHOTO)}>
            Keep the photo
          </button>
        </p>
      )}
      {messages !== undefined && (
        <p id={`${id}-error`} className="field-error" role={pickProblem !== undefined ? "alert" : undefined}>
          {messages.join(" ")}
        </p>
      )}
    </div>
  );
}
