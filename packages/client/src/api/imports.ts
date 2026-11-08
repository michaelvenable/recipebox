// Importing a recipe from a photo (docs/api.md, "Import from a photo"). Editors only (X-1, X-6).
import { ImportStatus, type PhotoRotation } from "@recipebox/shared";
import { apiGet, apiUpload } from "./client.js";

/** One photo to import, and how far the editor turned it clockwise with Rotate (IMP-1). */
export interface ImportPhoto {
  file: File;
  rotation: PhotoRotation;
}

/**
 * POST /imports: 1 to 4 photos of one recipe, in the order added, one import (IMP-1, IMP-3). Answers 202 with the import,
 * `reading`. The `rotations` part is always sent, one turn per photo in the same order, so the server turns each photo as it
 * was shown; it never has to guess what a missing part meant.
 */
export function startImport(photos: readonly ImportPhoto[]): Promise<ImportStatus> {
  const rotations = JSON.stringify(photos.map((photo) => photo.rotation));
  return apiUpload(
    "/imports",
    ImportStatus,
    photos.map((photo) => photo.file),
    "POST",
    { rotations },
  );
}

/** GET /imports: the imports of the last day, newest first (IMP-5, IMP-10). */
export function fetchImports(signal?: AbortSignal): Promise<ImportStatus[]> {
  return apiGet("/imports", ImportStatus.array(), signal);
}
