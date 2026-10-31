// Recipe request and response shapes (docs/api.md, "Shapes").
//
// Shape only: business rules (name length, tag format, 1-1440 minutes, ...) are checked by packages/domain, not here
// (docs/architecture.md, "Decisions"). Times are ISO 8601 strings and ids are strings; both are plain z.string().
//
// Optional fields use .optional(), so they accept both an absent key and `undefined` (inferred as `field?: T | undefined`).
// That lets the server write `totalTimeMinutes: snapshot.totalTimeMinutes` under exactOptionalPropertyTypes; JSON drops
// undefined, so on the wire the key is simply absent.
//
// Every object is strict: unknown keys are rejected, not stripped. For the public shapes this is what makes a leak of
// private fields fail parsing (X-1); .extend() keeps strictness, so editor shapes are strict too.
import { z } from "zod";

/** Body of POST /recipes and PUT /recipes/{id}/content (REC-1, REC-5). */
export const RecipeContentInput = z.strictObject({
  name: z.string(),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
  totalTimeMinutes: z.number().optional(),
  tags: z.array(z.string()).optional(),
});
export type RecipeContentInput = z.infer<typeof RecipeContentInput>;

/**
 * Body of a change that has no input, e.g. DELETE /recipes/{id} or POST /trash/{id}/restore: an empty `{}` (docs/api.md,
 * "Conventions"). Strict, so a time sent along (X-12) or any other field is refused rather than ignored.
 */
export const EmptyRequest = z.strictObject({});
export type EmptyRequest = z.infer<typeof EmptyRequest>;

/** A recipe in the list, as a visitor sees it (X-1). */
export const RecipeSummary = z.strictObject({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  totalTimeMinutes: z.number().optional(),
  hasPhoto: z.boolean(),
});
export type RecipeSummary = z.infer<typeof RecipeSummary>;

/** A recipe in the list, as an editor sees it (PLAN-7). */
export const EditorRecipeSummary = RecipeSummary.extend({
  onToMakeList: z.boolean(),
});
export type EditorRecipeSummary = z.infer<typeof EditorRecipeSummary>;

/** One recipe, as a visitor sees it: content, tags and whether it has a photo (X-1). */
export const PublicRecipe = z.strictObject({
  id: z.string(),
  name: z.string(),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
  totalTimeMinutes: z.number().optional(),
  tags: z.array(z.string()),
  hasPhoto: z.boolean(),
});
export type PublicRecipe = z.infer<typeof PublicRecipe>;

/** One recipe, as an editor sees it: adds to-make status and cooking history (X-1). */
export const EditorRecipe = PublicRecipe.extend({
  toMake: z.strictObject({ addedAt: z.string() }).optional(),
  /** Newest first. */
  cookedAt: z.array(z.string()),
  lastCookedAt: z.string().optional(),
  timesCooked: z.number(),
});
export type EditorRecipe = z.infer<typeof EditorRecipe>;
