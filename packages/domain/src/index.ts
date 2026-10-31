// Public exports of the domain package. See docs/domain-model.md for the design.
export type { DomainError } from "./errors.js";
export { fail, ok, type Result } from "./result.js";
export { Instant } from "./instant.js";
export { Minutes, MAX_MINUTES, MIN_MINUTES } from "./minutes.js";
export { PhotoRef } from "./photo-ref.js";
export { RecipeContent, MAX_TAGS, type RecipeContentInput } from "./recipe-content.js";
export { Recipe, TRASH_RETENTION_DAYS, type RecipeSnapshot } from "./recipe.js";
export { RecipeId } from "./recipe-id.js";
export { RecipeName, MAX_NAME_LENGTH } from "./recipe-name.js";
export { Tag, MAX_TAG_LENGTH } from "./tag.js";
export { TextEntry, MAX_ENTRY_LENGTH } from "./text-entry.js";
export { findRecipes, suggestTags, tagsInUse, toMakeList, trashContents } from "./finding.js";
export { orderForRediscovery } from "./rediscovery.js";
