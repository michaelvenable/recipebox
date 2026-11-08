// Importing a recipe from a photo (docs/api.md, "Import from a photo"). Editors only (X-1, X-6).
import { ImportStatus } from "@recipebox/shared";
import { apiGet, apiUpload } from "./client.js";

/**
 * POST /imports: 1 to 4 photos of one recipe, in the order added, one import (IMP-1, IMP-3). Answers 202 with the import,
 * `reading`.
 */
export function startImport(files: readonly File[]): Promise<ImportStatus> {
  return apiUpload("/imports", ImportStatus, files, "POST");
}

/** GET /imports: the imports of the last day, newest first (IMP-5, IMP-10). */
export function fetchImports(signal?: AbortSignal): Promise<ImportStatus[]> {
  return apiGet("/imports", ImportStatus.array(), signal);
}
