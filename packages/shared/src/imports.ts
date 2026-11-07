// Importing a recipe from a photo (IMP-1 to IMP-12; docs/api.md, "Import from a photo"). Strict like every response shape.
import { z } from "zod";

/**
 * POST /imports, and each item of GET /imports (IMP-4, IMP-5, IMP-10). `recipeId` and `recipeName` are present exactly when
 * the import is done. There is no start time, failure reason or photo: the reason is only in the server log (IMP-11).
 */
export const ImportStatus = z.discriminatedUnion("status", [
  z.strictObject({ importId: z.string(), status: z.literal("reading") }),
  z.strictObject({ importId: z.string(), status: z.literal("failed") }),
  z.strictObject({
    importId: z.string(),
    status: z.literal("done"),
    recipeId: z.string(),
    recipeName: z.string(),
  }),
]);
export type ImportStatus = z.infer<typeof ImportStatus>;
