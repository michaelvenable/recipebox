// HTTP contract shared by the server and the client (docs/architecture.md, "Decisions"; docs/api.md, "Shapes").
import { z } from "zod";

export const HealthResponse = z.strictObject({
  status: z.literal("ok"),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export { Me } from "./account.js";
export { ErrorItem, ErrorResponse } from "./errors.js";
export {
  RediscoverEntry,
  SharedShoppingList,
  ShoppingItem,
  ShoppingListLink,
  Tag,
  TagCount,
  ToMakeEntry,
  TrashEntry,
} from "./lists.js";
export {
  EditorRecipe,
  EditorRecipeSummary,
  EmptyRequest,
  PublicRecipe,
  RecipeContentInput,
  RecipeSummary,
  TagRequest,
} from "./recipes.js";
export { ImportStatus, PhotoRotation, PhotoRotations } from "./imports.js";
