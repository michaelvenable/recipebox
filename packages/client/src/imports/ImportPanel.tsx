import { type ReactNode, useId, useRef, useState } from "react";
import type { PhotoRotation } from "@recipebox/shared";
import { ApiError } from "../api/client.js";
import type { ImportPhoto } from "../api/imports.js";
import { useObjectUrl } from "../recipes/PhotoField.js";
import { changeErrorMessage } from "../recipes/recipe-changes.js";
import { PHOTO_ACCEPT, photoProblem } from "../recipes/recipe-form.js";

/** IMP-1, IMP-2: an import is 1 to 4 photos of one recipe; the server refuses more (docs/api.md, "Import from a photo"). */
export const MAX_IMPORT_PHOTOS = 4;

interface ImportPanelProps {
  /** The photos are being uploaded: "Import recipe" says so and can't be pressed again (IMP-4). */
  uploading: boolean;
  /** Why the last upload failed, already worded for the editor, or undefined. */
  error: string | undefined;
  /** Upload these photos, in the order they were added, each turned as shown, as one import (IMP-1, IMP-3). */
  onImport: (photos: readonly ImportPhoto[]) => void;
  /** A photo was added or removed, so a message about the last upload is out of date. */
  onPhotosChange: () => void;
}

interface PickedPhoto {
  /** Stays with the photo when others are removed, so its preview isn't made again. */
  key: number;
  file: File;
  /** How far Rotate has turned it clockwise (IMP-1). Only the preview shows it; the file itself is never changed. */
  rotation: PhotoRotation;
}

/** IMP-1: each press of Rotate turns a photo a quarter turn clockwise, and the fourth brings it back. */
function nextRotation(rotation: PhotoRotation): PhotoRotation {
  return ((rotation + 90) % 360) as PhotoRotation;
}

/** How a photo's preview is turned, for a screen reader (docs/mockups/ImportPhotos.dc.html). */
const TURN_LABELS: Record<PhotoRotation, string> = {
  0: "not turned",
  90: "turned a quarter turn",
  180: "turned a half turn",
  270: "turned three quarter turns",
};

/**
 * Why an upload of `count` photos failed, for the panel (IMP-4): the server's photo.* message, naming the photo it is about
 * when there are several (its `field` is `photos[i]`, from 0), or why the upload didn't get through.
 */
export function importUploadProblem(error: unknown, count: number): string {
  const lead = count === 1 ? "The photo wasn't uploaded." : "The photos weren't uploaded.";
  if (error instanceof ApiError && error.errors.length > 0 && count > 1) {
    const messages = error.errors.map((item) => {
      const index = /^photos\[(\d+)\]$/.exec(item.field ?? "")?.[1];
      return index === undefined ? item.message : `Photo ${Number(index) + 1}: ${item.message}`;
    });
    return `${lead} ${messages.join(" ")}`;
  }
  return `${lead} ${changeErrorMessage(error)}`;
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

function PlusIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

interface PhotoPreviewProps {
  photo: PickedPhoto;
  label: string;
  onRotate: () => void;
  onRemove: () => void;
}

/**
 * A picked photo as a small preview, from an object URL released when it is removed or the form goes (IMP-12, X-15). Rotate
 * turns only the preview, with a CSS rotation inside a square tile, so the turned preview still fits (IMP-1).
 */
function PhotoPreview({ photo, label, onRotate, onRemove }: PhotoPreviewProps) {
  const url = useObjectUrl(photo.file);
  const turned = `${label}, ${TURN_LABELS[photo.rotation]}`;
  // A quarter turn makes the portrait preview landscape; slightly smaller, it keeps clear of the tile's edges.
  const style = { transform: `rotate(${photo.rotation}deg)${photo.rotation % 180 === 0 ? "" : " scale(0.9)"}` };
  return (
    <li className="import-photo">
      <div className="import-photo-tile">
        {url === undefined ? (
          <span className="import-photo-image" role="img" aria-label={turned} style={style} />
        ) : (
          <img className="import-photo-image" src={url} alt={turned} style={style} />
        )}
      </div>
      <span className="import-photo-label" aria-hidden="true">
        {label}
      </span>
      <button type="button" className="import-photo-rotate" aria-label={`Rotate ${label}`} onClick={onRotate}>
        <RotateIcon />
        Rotate
      </button>
      <button type="button" className="import-photo-remove" aria-label={`Remove ${label}`} onClick={onRemove}>
        <span aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </span>
      </button>
    </li>
  );
}

/**
 * "Have it on paper?" at the top of the New recipe form (IMP-1; docs/mockups/ImportNewRecipe.dc.html, ImportPhotos.dc.html),
 * then "or type it in". "Import from a photo" adds the first photo, "Add another photo" the next side or page of the same
 * recipe, one at a time, up to MAX_IMPORT_PHOTOS; each can be turned with Rotate or removed, and "Import recipe" uploads them
 * all in the order added, each with its turn, which the server applies (IMP-1).
 * Each picker takes one file and asks for the same types as the photo field; another file is refused with the same messages
 * and isn't added, and the photos already added stay (IMP-2, REC-7). The photos stay here if the upload fails, to try again
 * (IMP-4). They are kept in memory only, never stored on the device (X-15).
 */
export function ImportPanel({ uploading, error, onImport, onPhotosChange }: ImportPanelProps) {
  const id = useId();
  const [photos, setPhotos] = useState<readonly PickedPhoto[]>([]);
  const [pickProblem, setPickProblem] = useState<string>();
  const nextKey = useRef(0);
  const message = pickProblem ?? error;
  const full = photos.length >= MAX_IMPORT_PHOTOS;

  function pick(input: HTMLInputElement) {
    const file = input.files?.[0];
    // So that picking the same file again still counts.
    input.value = "";
    if (file === undefined || full) return;
    const problem = photoProblem(file);
    setPickProblem(problem);
    if (problem !== undefined) return;
    setPhotos((current) =>
      current.length >= MAX_IMPORT_PHOTOS ? current : [...current, { key: nextKey.current++, file, rotation: 0 }],
    );
    onPhotosChange();
  }

  function rotate(key: number) {
    setPhotos((current) =>
      current.map((photo) => (photo.key === key ? { ...photo, rotation: nextRotation(photo.rotation) } : photo)),
    );
  }

  // A photo's turn goes with it when it is removed.
  function remove(key: number) {
    setPickProblem(undefined);
    setPhotos((current) => current.filter((photo) => photo.key !== key));
    onPhotosChange();
  }

  const picker = (label: string, icon: ReactNode) => (
    <label className="button import-button file-button" aria-disabled={uploading || undefined}>
      {icon}
      {label}
      <input
        className="visually-hidden"
        type="file"
        accept={PHOTO_ACCEPT}
        disabled={uploading}
        aria-describedby={message !== undefined ? `${id}-error` : undefined}
        onChange={(event) => pick(event.currentTarget)}
      />
    </label>
  );

  return (
    <>
      <section className="import-panel" aria-labelledby={`${id}-title`}>
        <div className="import-panel-head">
          <span className="import-panel-icon">
            <CameraIcon size={22} />
          </span>
          <h2 id={`${id}-title`}>Have it on paper?</h2>
        </div>
        {photos.length === 0 ? (
          <>
            <p>Upload a photo of the recipe to begin.</p>
            {picker("Import from a photo", <CameraIcon size={20} />)}
          </>
        ) : (
          <>
            <p>
              Add each side or page of this recipe, in order. Up to {MAX_IMPORT_PHOTOS} photos. Turn each one so the writing reads
              the right way up.
            </p>
            <ol className="import-photos" aria-label="Photos of this recipe">
              {photos.map((photo, index) => (
                <PhotoPreview
                  key={photo.key}
                  photo={photo}
                  label={`Photo ${index + 1}`}
                  onRotate={() => rotate(photo.key)}
                  onRemove={() => remove(photo.key)}
                />
              ))}
            </ol>
            {!full && picker("Add another photo", <PlusIcon />)}
            <button
              type="button"
              className="button button-primary"
              disabled={uploading}
              onClick={() => onImport(photos.map(({ file, rotation }) => ({ file, rotation })))}
            >
              {uploading ? "Uploading photos…" : "Import recipe"}
            </button>
          </>
        )}
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
