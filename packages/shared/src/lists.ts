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

/** GET /plan (PLAN-3). */
export const ToMakeEntry = RecipeSummary.extend({
  addedAt: z.string(),
});
export type ToMakeEntry = z.infer<typeof ToMakeEntry>;

/** GET /plan/shopping-list returns ShoppingItem[] (PLAN-8): one ingredient as entered, with the recipe it comes from. */
export const ShoppingItem = z.strictObject({
  text: z.string(),
  recipeId: z.string(),
  recipeName: z.string(),
});
export type ShoppingItem = z.infer<typeof ShoppingItem>;

/** GET /recommendations (COOK-6). */
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

/**
 * POST /plan/shopping-list/shares returns ShoppingListLink (PLAN-9): the new link's random code, the app's path for it
 * (`/list/{token}`, joined to the app's origin by the client) and when it stops working, by the server's clock (X-12).
 */
export const ShoppingListLink = z.strictObject({
  token: z.string(),
  path: z.string(),
  expiresAt: z.string(),
});
export type ShoppingListLink = z.infer<typeof ShoppingListLink>;

/**
 * GET /shopping-lists/{token} returns SharedShoppingList (PLAN-9), to anyone with the link: the shopping list as it was when
 * sent, in the same order, and when the link stops working. Nothing else; in particular no to-make dates (X-1).
 */
export const SharedShoppingList = z.strictObject({
  items: ShoppingItem.array(),
  expiresAt: z.string(),
});
export type SharedShoppingList = z.infer<typeof SharedShoppingList>;
