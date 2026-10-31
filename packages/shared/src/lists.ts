// Tag and editor-only list shapes (docs/api.md, "Shapes"). Strict like every response shape; see recipes.ts.
import { z } from "zod";
import { RecipeSummary } from "./recipes.js";

/** GET /tags (REC-13). */
export const TagCount = z.strictObject({
  tag: z.string(),
  count: z.number(),
});
export type TagCount = z.infer<typeof TagCount>;

/** GET /tag-suggestions returns Tag[] (REC-12). */
export const Tag = z.string();
export type Tag = z.infer<typeof Tag>;

/** GET /to-make (PLAN-3). */
export const ToMakeEntry = RecipeSummary.extend({
  addedAt: z.string(),
});
export type ToMakeEntry = z.infer<typeof ToMakeEntry>;

/** GET /rediscover (COOK-6). */
export const RediscoverEntry = RecipeSummary.extend({
  lastCookedAt: z.string().optional(),
});
export type RediscoverEntry = z.infer<typeof RediscoverEntry>;

/** GET /trash (REC-14). */
export const TrashEntry = RecipeSummary.extend({
  deletedAt: z.string(),
  removalDueAt: z.string(),
});
export type TrashEntry = z.infer<typeof TrashEntry>;
