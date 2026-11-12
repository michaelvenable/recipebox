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
  /** Optional, so a client from before prep existed keeps working; absent means none (REC-20). */
  prep: z.array(z.string()).optional(),
  steps: z.array(z.string()),
  totalTimeMinutes: z.number().optional(),
  /** How many people it serves (REC-24); absent means none, so a client from before servings keeps working. */
  servings: z.number().optional(),
  tags: z.array(z.string()).optional(),
});
export type RecipeContentInput = z.infer<typeof RecipeContentInput>;

/**
 * Body of a change that has no input, e.g. DELETE /recipes/{id} or POST /trash/{id}/restore: an empty `{}` (docs/api.md,
 * "Conventions"). Strict, so a time sent along (X-12) or any other field is refused rather than ignored.
 */
export const EmptyRequest = z.strictObject({});
export type EmptyRequest = z.infer<typeof EmptyRequest>;

/**
 * Body of POST and DELETE /recipes/{id}/tags (REC-10, REC-11): the tag as typed; reading it (trim, lowercase) is the domain's
 * job. The tag travels in the body because browsers rewrite tags such as "." or ".." in an address (docs/api.md).
 */
export const TagRequest = z.strictObject({
  tag: z.string(),
});
export type TagRequest = z.infer<typeof TagRequest>;

/** A recipe in the list, as a visitor sees it (X-1). */
export const RecipeSummary = z.strictObject({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  totalTimeMinutes: z.number().optional(),
  hasPhoto: z.boolean(),
  /**
   * When the recipe was added, for "Recently added" (REC-22); public, like the recipe (X-1). Absent for recipes stored before
   * added times were recorded. Named `createdAt` because `addedAt` on the to-make list's entries (PLAN-3) is another time.
   */
  createdAt: z.string().optional(),
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
  /**
   * Absent when the recipe has no prep (REC-20). Optional, not an empty list, because clients from before prep parse this shape
   * strictly and would refuse a response with the key.
   */
  prep: z.array(z.string()).optional(),
  steps: z.array(z.string()),
  totalTimeMinutes: z.number().optional(),
  /** How many people it serves (REC-24): public content. Absent when not known, like `prep`. */
  servings: z.number().optional(),
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
